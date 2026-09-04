/**
 * bookingService - 受控预约查询与更新
 *
 * listToday：返回当前微信本人/已验证手机号对应的当日预约。
 * completeCheckin：校验预约归属、日期、状态和签署信息后，在事务中完成签到。
 * update：管理员可更新业务字段；普通用户不能通过通用更新写入签到凭证或到店状态。
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const TIME_SLOTS = new Set(['9:30-11:30', '13:00-15:00', '15:30-17:30'])
const TERMINAL_STATUSES = new Set(['cancelled', 'rejected', 'no_show'])
const WECOM_BOOKING_WEBHOOK = process.env.WECOM_BOOKING_WEBHOOK || ''
const PHOTO_FIELDS = [
  '_photos', '_beforePhotos', '_beforeFrontPhotos', '_beforeSidePhotos',
  '_immediatePhotos', '_day30Photos', '_day90Photos'
]

const ADMIN_FIELDS = new Set([
  '_status', '_confirmedAt', '_confirmedBy', '_rejectReason', '_cancelReason',
  'checkInAt', 'deviceModel', 'consentSignName', 'consentSignTime',
  'consentSignImage', 'consentPhotoAuth1', 'consentPhotoAuth2',
  'name', 'gender', 'age', 'idCard', 'phone', '_adminNote', '_followUpRecords',
  '_clientManager', '_totalEnergy', '_shotDistribution', '_maxLevel',
  '_immediateSatisfaction', '_comfortSatisfaction', '_productFeedback',
  '_day30FollowUp', '_day90FollowUp', '_photos',
  '_beforePhotos', '_beforeFrontPhotos', '_beforeSidePhotos',
  '_immediatePhotos', '_day30Photos', '_day90Photos', 'updatedAt'
])

const USER_FIELDS = new Set([
  '_status', '_cancelReason',
  'name', 'gender', 'age', 'idCard', 'phone',
  'updatedAt'
])

async function getAdmin(openId) {
  if (!openId) return null
  const res = await db.collection('admins')
    .where({ openId, active: true })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

async function getVerifiedPhone(openId) {
  if (!openId) return ''
  const res = await db.collection('users')
    .where({ openId, phoneVerified: true })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0].phone || '' : ''
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength)
}

function collectCloudFileIDs(booking) {
  const ids = new Set()
  PHOTO_FIELDS.forEach(field => {
    const photos = Array.isArray(booking && booking[field]) ? booking[field] : []
    photos.forEach(photo => {
      const value = typeof photo === 'string' ? photo : (photo && (photo.fileID || photo.path))
      if (String(value || '').startsWith('cloud://')) ids.add(String(value))
    })
  })
  return ids
}

async function cleanupRemovedPhotoFiles(before, updates) {
  if (!PHOTO_FIELDS.some(field => Object.prototype.hasOwnProperty.call(updates || {}, field))) return
  const beforeIDs = collectCloudFileIDs(before)
  const afterIDs = collectCloudFileIDs(Object.assign({}, before, updates))
  const removed = [...beforeIDs].filter(fileID => !afterIDs.has(fileID))
  if (!removed.length) return
  try {
    await cloud.deleteFile({ fileList: removed })
  } catch (err) {
    // 数据引用已经正确更新，文件清理失败不能回滚业务操作；保留日志供后台排查。
    console.warn('[照片清理] 云文件删除失败:', err)
  }
}

function todayInChina() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function getBookingAccess(openId, booking) {
  const phone = await getVerifiedPhone(openId)
  const owner = booking._openid === openId || booking._creatorOpenId === openId
  const phoneOwner = !!phone && phone === booking.phone
  return { phone, owner, phoneOwner, allowed: owner || phoneOwner }
}

function validateFutureTime(visitDate, visitTime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return '日期格式不正确'
  if (!TIME_SLOTS.has(visitTime)) return '预约时段不正确'
  const match = visitTime.match(/^(\d{1,2}):(\d{2})-/)
  const startAt = Date.parse(
    visitDate + 'T' + match[1].padStart(2, '0') + ':' + match[2] + ':00+08:00'
  )
  if (!Number.isFinite(startAt) || startAt < Date.now()) {
    return '不能预约已经开始或过去的时段'
  }
  return ''
}

function slotLockId(visitDate, visitTime) {
  return ('slot_' + visitDate + '_' + visitTime).replace(/[^A-Za-z0-9_-]/g, '_')
}

function businessError(code, message) {
  const err = new Error(code + ':' + message)
  err.businessCode = code
  return err
}

function isMissingDocumentError(err) {
  const message = String((err && (err.errMsg || err.message)) || '').toLowerCase()
  return message.includes('not exist') || message.includes('not found') ||
    message.includes('not_exist') || message.includes('document_not_found') || message.includes('-502001')
}

async function getCurrentStoreConfig() {
  try {
    const res = await db.collection('store_config').doc('current').get()
    const doc = (res && res.data) || {}
    return {
      storeName: cleanText(doc.storeName || '冰美肌', 40),
      storeAddress: cleanText(doc.address, 120),
      storePhone: cleanText(doc.contactPhone, 30),
      storeWechat: cleanText(doc.contactWechat, 50),
      storeBusinessHours: cleanText(doc.businessHours, 80),
      storeAppointmentNotice: cleanText(doc.appointmentNotice || '请提前10分钟到店，素颜更佳', 80)
    }
  } catch (err) {
    // 兼容首次部署、尚未创建门店配置文档的情况。
    if (isMissingDocumentError(err)) {
      return {
        storeName: '冰美肌', storeAddress: '', storePhone: '', storeWechat: '',
        storeBusinessHours: '', storeAppointmentNotice: '请提前10分钟到店，素颜更佳'
      }
    }
    throw err
  }
}

async function resolveBookingOwner(openId, phone, admin) {
  if (!admin) return openId
  const res = await db.collection('users')
    .where({ phone, phoneVerified: true })
    .limit(1)
    .get()
  const linked = res.data && res.data[0]
  // 操作师代客预约时，如果客户尚未授权过手机号，先保持客户归属为空。
  // 不能把操作师的 openId 当成客户，否则客户看不到预约、通知也会发错人。
  return linked && linked.openId ? linked.openId : ''
}

// 新预约写入成功后通知企业微信内部群。Webhook 只从云函数环境变量读取，绝不写入代码。
function notifyWecomNewBooking(booking) {
  if (!WECOM_BOOKING_WEBHOOK) {
    return Promise.resolve({ sent: false, reason: 'WECOM_BOOKING_WEBHOOK 未配置' })
  }

  let endpoint
  try {
    endpoint = new URL(WECOM_BOOKING_WEBHOOK)
  } catch (err) {
    return Promise.resolve({ sent: false, reason: '企业微信机器人地址格式不正确' })
  }

  const source = booking.trainerName || ({ medical: '医疗渠道', beauty: '生美渠道', direct: '直接访问' }[booking.channel] || '直接访问')
  const content = [
    '【冰美肌新预约】',
    `顾客：${booking.name || '-'}`,
    `手机：${booking.phone || '-'}`,
    `时间：${booking.visitDate || '-'} ${booking.visitTime || '-'}`,
    `需求：${cleanText(booking.needs || '未填写', 100)}`,
    `来源：${source}`,
    '',
    '请操作师及时打开小程序，在“我的 → 待处理”中确认预约。'
  ].join('\n')
  const body = JSON.stringify({
    msgtype: 'text',
    text: {
      content,
      mentioned_list: ['@all']
    }
  })

  return new Promise(resolve => {
    const request = https.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: endpoint.pathname + endpoint.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 5000
    }, response => {
      let responseBody = ''
      response.on('data', chunk => { responseBody += chunk })
      response.on('end', () => {
        try {
          const result = JSON.parse(responseBody || '{}')
          resolve(result.errcode === 0
            ? { sent: true }
            : { sent: false, reason: result.errmsg || `企业微信错误 ${result.errcode}` })
        } catch (err) {
          resolve({ sent: false, reason: '企业微信返回内容无法解析' })
        }
      })
    })
    request.on('timeout', () => {
      request.destroy()
      resolve({ sent: false, reason: '企业微信通知超时' })
    })
    request.on('error', err => resolve({ sent: false, reason: err.message || '企业微信通知失败' }))
    request.write(body)
    request.end()
  })
}

async function runWecomBookingNotify(booking) {
  try {
    return await notifyWecomNewBooking(booking)
  } catch (err) {
    return { sent: false, reason: err.message || '企业微信通知失败' }
  }
}

function buildStaffNotifyState(booking, notifyResult) {
  const sent = notifyResult && notifyResult.sent === true
  const now = new Date().toISOString()
  return {
    _staffNotifyStatus: sent ? 'sent' : (WECOM_BOOKING_WEBHOOK ? 'failed' : 'not_configured'),
    _staffNotifyError: sent ? '' : cleanText((notifyResult && notifyResult.reason) || '企业微信通知失败', 300),
    _staffNotifiedAt: sent ? now : (booking._staffNotifiedAt || ''),
    _staffNotifyUpdatedAt: now,
    _staffNotifyAttempts: Number(booking._staffNotifyAttempts || 0) + 1
  }
}

async function persistStaffNotifyState(docId, booking, notifyResult) {
  const state = buildStaffNotifyState(booking, notifyResult)
  Object.assign(booking, state)
  try {
    await db.collection('bookings').doc(docId).update({ data: state })
  } catch (err) {
    // 通知结果写回失败不影响已经创建成功的预约；管理员仍可在详情页再次发送。
    console.error('[企业微信] 通知状态写回失败:', err)
  }
  return state
}

async function getStaffNotifyConfig(openId) {
  const admin = await getAdmin(openId)
  if (!admin) return { success: false, error: '无管理员权限' }
  return { success: true, configured: !!WECOM_BOOKING_WEBHOOK }
}

async function retryStaffNotify(openId, event) {
  const admin = await getAdmin(openId)
  if (!admin) return { success: false, error: '无管理员权限' }
  const bookingId = cleanText(event.bookingId, 40)
  if (!bookingId) return { success: false, error: '缺少预约编号' }

  const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  const booking = res.data && res.data[0]
  if (!booking) return { success: false, error: '预约不存在' }

  const notifyResult = await runWecomBookingNotify(booking)
  const state = await persistStaffNotifyState(booking._id, booking, notifyResult)
  if (!notifyResult.sent) {
    console.warn('[企业微信] 预约通知重试失败:', notifyResult.reason)
  }
  return {
    success: true,
    sent: notifyResult.sent === true,
    error: notifyResult.sent ? '' : state._staffNotifyError,
    data: state
  }
}

async function createBooking(openId, event) {
  const input = (event && event.data) || {}
  if (input.agreedPrivacy !== true) {
    return { success: false, error: '请先阅读并同意隐私协议' }
  }

  const admin = await getAdmin(openId)
  const verifiedPhone = await getVerifiedPhone(openId)
  const requestedPhone = cleanText(input.phone, 20)
  const phone = admin ? requestedPhone : verifiedPhone
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return { success: false, error: admin ? '客户手机号格式不正确' : '请重新授权微信手机号' }
  }
  if (!admin && requestedPhone && requestedPhone !== verifiedPhone) {
    return { success: false, error: '预约手机号必须与微信授权号码一致' }
  }

  const name = cleanText(input.name, 40)
  const gender = cleanText(input.gender, 10)
  const age = cleanText(input.age, 3)
  const idCard = cleanText(input.idCard, 18)
  const visitDate = cleanText(input.visitDate, 10)
  const visitTime = cleanText(input.visitTime, 20)
  if (!name) return { success: false, error: '请填写姓名' }
  if (idCard && !/^\d{17}[\dXx]$/.test(idCard)) {
    return { success: false, error: '身份证号码格式不正确' }
  }
  const timeError = validateFutureTime(visitDate, visitTime)
  if (timeError) return { success: false, error: timeError }

  // 兼容改造前已经存在但没有锁记录的预约。
  const occupied = await db.collection('bookings')
    .where({
      visitDate,
      visitTime,
      _status: _.nin(['cancelled', 'rejected', 'no_show'])
    })
    .limit(1)
    .get()
  if (occupied.data && occupied.data.length) {
    return { success: false, occupied: true, error: '该时段已被预约，请另选时间' }
  }

  const ownerOpenId = await resolveBookingOwner(openId, phone, admin)
  const store = await getCurrentStoreConfig()
  const bookingId = Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
  const bookingDocId = 'booking_' + bookingId
  const lockId = slotLockId(visitDate, visitTime)
  const now = new Date().toISOString()
  const channel = ['medical', 'beauty', 'direct'].includes(input.channel) ? input.channel : 'direct'
  const booking = {
    id: bookingId,
    name,
    gender,
    age,
    idCard,
    visitDate,
    visitTime,
    medicalHistory: cleanText(input.medicalHistory, 1000),
    needs: cleanText(input.needs, 1000),
    phone,
    channel,
    trainerId: cleanText(input.trainerId, 80),
    trainerName: cleanText(input.trainerName, 80),
    storeName: store.storeName,
    storeAddress: store.storeAddress,
    storePhone: store.storePhone,
    storeWechat: store.storeWechat,
    storeBusinessHours: store.storeBusinessHours,
    storeAppointmentNotice: store.storeAppointmentNotice,
    consentSignName: '',
    consentSignTime: '',
    consentSignImage: '',
    createdAt: now,
    updatedAt: now,
    _openid: ownerOpenId,
    _creatorOpenId: ownerOpenId,
    _createdByOpenId: openId,
    _status: 'pending_confirm',
    _confirmedAt: '',
    _confirmedBy: '',
    deviceModel: '',
    checkInAt: '',
    _clientManager: '',
    _totalEnergy: '',
    _shotDistribution: '',
    _maxLevel: '',
    _immediateSatisfaction: 0,
    _comfortSatisfaction: 0,
    _photos: [],
    _beforePhotos: [],
    _beforeFrontPhotos: [],
    _beforeSidePhotos: [],
    _immediatePhotos: [],
    _day30Photos: [],
    _day90Photos: [],
    _productFeedback: '',
    _day30FollowUp: '',
    _day90FollowUp: '',
    _adminNote: '',
    _followUpRecords: [],
    _reminder30SentAt: '',
    _reminder90SentAt: '',
    _staffNotifyStatus: 'pending',
    _staffNotifyError: '',
    _staffNotifiedAt: '',
    _staffNotifyUpdatedAt: '',
    _staffNotifyAttempts: 0
  }

  try {
    const txResult = await db.runTransaction(async transaction => {
      const scheduleRes = await transaction.collection('schedule').doc('current').get()
      const scheduleDoc = scheduleRes && scheduleRes.data
      const openSlots = scheduleDoc && scheduleDoc.schedule && scheduleDoc.schedule[visitDate]
      if (!Array.isArray(openSlots) || openSlots.indexOf(visitTime) === -1) {
        throw businessError('SLOT_CLOSED', '该时段未开放，请另选时间')
      }

      let existingLock = null
      try {
        const lockRes = await transaction.collection('booking_slots').doc(lockId).get()
        existingLock = lockRes && lockRes.data
      } catch (err) {
        if (!isMissingDocumentError(err)) throw err
      }
      if (existingLock && existingLock.active !== false) {
        throw businessError('SLOT_OCCUPIED', '该时段刚刚被预约，请另选时间')
      }

      await transaction.collection('booking_slots').doc(lockId).set({
        data: {
          active: true,
          bookingId,
          visitDate,
          visitTime,
          createdAt: now,
          updatedAt: now
        }
      })
      await transaction.collection('bookings').doc(bookingDocId).set({ data: booking })
      return booking
    }, 5)
    const created = txResult && txResult.result ? txResult.result : txResult
    const createdBooking = created || booking
    const notifyResult = await runWecomBookingNotify(createdBooking)
    const notifyState = await persistStaffNotifyState(bookingDocId, createdBooking, notifyResult)
    if (!notifyResult.sent) {
      console.warn('[企业微信] 新预约通知未发送:', notifyResult.reason)
    }
    return {
      success: true,
      data: createdBooking,
      staffNotified: notifyResult.sent === true,
      staffNotifyStatus: notifyState._staffNotifyStatus
    }
  } catch (err) {
    const message = String((err && (err.errMsg || err.message)) || '')
    if (message.includes('SLOT_OCCUPIED')) {
      return { success: false, occupied: true, error: '该时段刚刚被预约，请另选时间' }
    }
    if (message.includes('SLOT_CLOSED')) {
      return { success: false, error: '该时段未开放，请另选时间' }
    }
    if (message.includes('booking_slots')) {
      return { success: false, error: '预约锁集合尚未创建，请联系管理员完成部署' }
    }
    throw err
  }
}

function mergeUnique(groups) {
  const map = {}
  groups.forEach(list => (list || []).forEach(item => {
    const key = item._id || item.id
    if (key) map[key] = item
  }))
  return Object.keys(map).map(key => map[key])
}

async function loadAllBookingsByCondition(condition) {
  const output = []
  for (let offset = 0; ; offset += 100) {
    const res = await db.collection('bookings')
      .where(condition)
      .skip(offset)
      .limit(100)
      .get()
    const rows = res.data || []
    output.push(...rows)
    if (rows.length < 100) break
  }
  return output
}

async function listMine(openId) {
  const phone = await getVerifiedPhone(openId)
  const tasks = [
    loadAllBookingsByCondition({ _openid: openId }),
    loadAllBookingsByCondition({ _creatorOpenId: openId })
  ]
  if (phone) tasks.push(loadAllBookingsByCondition({ phone }))

  const results = await Promise.all(tasks)
  const bookings = mergeUnique(results)
  const adminCache = {}
  const now = new Date().toISOString()

  // 已验证手机号与代预约手机号一致时，把尚未绑定或误绑定到操作师的旧预约纠正到客户微信。
  if (phone) {
    for (const booking of bookings) {
      if (booking.phone !== phone || booking._openid === openId) continue
      const currentOwner = booking._openid || booking._creatorOpenId || ''
      let ownerIsStaff = false
      if (currentOwner && currentOwner === booking._createdByOpenId) {
        if (adminCache[currentOwner] === undefined) {
          adminCache[currentOwner] = !!(await getAdmin(currentOwner))
        }
        ownerIsStaff = adminCache[currentOwner]
      }
      if (!currentOwner || ownerIsStaff) {
        await db.collection('bookings').doc(booking._id).update({
          data: {
            _openid: openId,
            _creatorOpenId: openId,
            _customerBoundAt: now,
            updatedAt: now
          }
        })
        booking._openid = openId
        booking._creatorOpenId = openId
        booking._customerBoundAt = now
        booking.updatedAt = now
      }
    }
  }

  const mine = bookings.filter(booking => {
    return booking._openid === openId || booking._creatorOpenId === openId
  })
  mine.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return { success: true, data: mine }
}

async function listToday(openId, visitDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate || '')) {
    return { success: false, data: [], error: '日期格式不正确' }
  }
  const phone = await getVerifiedPhone(openId)
  if (!phone) {
    return { success: false, data: [], requiresPhoneAuth: true, error: '请先授权预约手机号，以便识别您的预约' }
  }
  const tasks = [
    db.collection('bookings').where({ _creatorOpenId: openId, visitDate }).limit(50).get(),
    db.collection('bookings').where({ _openid: openId, visitDate }).limit(50).get()
  ]
  if (phone) tasks.push(db.collection('bookings').where({ phone, visitDate }).limit(50).get())
  const results = await Promise.all(tasks)
  const data = mergeUnique(results.map(item => item.data)).filter(item => {
    if (item.checkInAt) return false
    return item._status === 'confirmed'
  })
  return { success: true, data }
}

function publicCheckinBooking(booking) {
  return {
    id: booking.id || '',
    name: booking.name || '',
    gender: booking.gender || '',
    age: booking.age || '',
    idCard: booking.idCard || '',
    phone: booking.phone || '',
    visitDate: booking.visitDate || '',
    visitTime: booking.visitTime || '',
    storeName: booking.storeName || '',
    storeAddress: booking.storeAddress || '',
    storePhone: booking.storePhone || '',
    storeWechat: booking.storeWechat || '',
    storeBusinessHours: booking.storeBusinessHours || '',
    storeAppointmentNotice: booking.storeAppointmentNotice || '',
    medicalHistory: booking.medicalHistory || '',
    needs: booking.needs || '',
    _status: booking._status || '',
    checkInAt: booking.checkInAt || '',
    createdAt: booking.createdAt || ''
  }
}

async function getForCheckin(openId, bookingId) {
  if (!bookingId) return { success: false, error: '缺少预约编号' }
  const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  const booking = res.data && res.data[0]
  if (!booking) return { success: false, error: '未找到该预约' }

  const access = await getBookingAccess(openId, booking)
  if (!access.allowed && !access.phone) {
    return { success: false, requiresPhoneAuth: true, error: '请先授权预约手机号，以便确认预约归属' }
  }
  if (!access.allowed) return { success: false, error: '该预约不属于当前微信账号' }
  if (booking.visitDate !== todayInChina()) return { success: false, error: '只能在预约当天到店签到' }
  if (booking._status !== 'confirmed') return { success: false, error: '该预约当前不可签到' }
  if (booking.checkInAt) return { success: false, error: '该预约已经完成签到' }

  // 操作师代下单时预约最初可能归属于操作师；顾客授权同一手机号后在这里安全绑定。
  if (!access.owner && access.phoneOwner) {
    await db.collection('bookings').doc(booking._id).update({
      data: { _openid: openId, updatedAt: new Date().toISOString() }
    })
    booking._openid = openId
  }

  return { success: true, data: publicCheckinBooking(booking) }
}

async function completeCheckin(openId, event) {
  const bookingId = cleanText(event.bookingId, 40)
  if (!bookingId) return { success: false, error: '缺少预约编号' }
  if (event.consentAccepted !== true) return { success: false, error: '请先完整阅读并同意知情同意书' }

  const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  const booking = res.data && res.data[0]
  if (!booking) return { success: false, error: '预约不存在' }
  const access = await getBookingAccess(openId, booking)
  if (!access.allowed && !access.phone) {
    return { success: false, requiresPhoneAuth: true, error: '请先授权预约手机号' }
  }
  if (!access.allowed) return { success: false, error: '该预约不属于当前微信账号' }

  const input = event.data || {}
  const signName = cleanText(input.name || booking.name, 40)
  const gender = cleanText(input.gender || booking.gender, 10)
  const age = cleanText(input.age || booking.age, 3)
  const idCard = cleanText(input.idCard || booking.idCard, 18)
  if (!signName) return { success: false, error: '签署人姓名不能为空' }
  if (idCard && !/^\d{17}[\dXx]$/.test(idCard)) return { success: false, error: '身份证号码格式不正确' }

  const now = new Date().toISOString()
  const updated = await db.runTransaction(async transaction => {
    const bookingRef = transaction.collection('bookings').doc(booking._id)
    const freshRes = await bookingRef.get()
    const fresh = freshRes && freshRes.data
    if (!fresh) throw businessError('BOOKING_NOT_FOUND', '预约不存在')
    if (fresh.visitDate !== todayInChina()) throw businessError('CHECKIN_NOT_TODAY', '只能在预约当天到店签到')
    if (fresh._status !== 'confirmed') throw businessError('INVALID_STATUS', '该预约当前不可签到')
    if (fresh.checkInAt) throw businessError('ALREADY_CHECKED_IN', '该预约已经完成签到')

    const data = {
      _status: 'visited',
      checkInAt: now,
      consentSignName: signName,
      consentSignTime: now,
      consentSignImage: '',
      consentPhotoAuth1: input.photoAuth1 === true,
      consentPhotoAuth2: input.photoAuth2 === true,
      name: signName,
      gender,
      age,
      idCard,
      updatedAt: now
    }
    if (!access.owner && access.phoneOwner) data._openid = openId
    await bookingRef.update({ data })
    return Object.assign({}, fresh, data)
  }, 5)

  const saved = updated && updated.result ? updated.result : updated
  return {
    success: true,
    data: Object.assign(publicCheckinBooking(saved || booking), {
      consentSignName: signName,
      consentSignTime: now,
      consentPhotoAuth1: input.photoAuth1 === true,
      consentPhotoAuth2: input.photoAuth2 === true
    })
  }
}

async function startExperience(openId, event) {
  const bookingId = cleanText(event.bookingId, 40)
  if (!bookingId) return { success: false, error: '缺少预约编号' }
  const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  const booking = res.data && res.data[0]
  if (!booking) return { success: false, error: '预约不存在' }
  const access = await getBookingAccess(openId, booking)
  if (!access.allowed) return { success: false, error: '该预约不属于当前微信账号' }

  const now = new Date().toISOString()
  await db.runTransaction(async transaction => {
    const bookingRef = transaction.collection('bookings').doc(booking._id)
    const freshRes = await bookingRef.get()
    const fresh = freshRes && freshRes.data
    if (!fresh) throw businessError('BOOKING_NOT_FOUND', '预约不存在')
    if (fresh._status !== 'visited' || !fresh.checkInAt || !fresh.consentSignTime) {
      throw businessError('INVALID_STATUS', '请先完成到店签到')
    }
    await bookingRef.update({ data: { _status: 'in_experience', updatedAt: now } })
  }, 5)
  return { success: true, data: { _status: 'in_experience', updatedAt: now } }
}

function followupPhotoField(stage) {
  if (String(stage) === '30') return '_day30Photos'
  if (String(stage) === '90') return '_day90Photos'
  return ''
}

function bookingServiceDate(booking) {
  const checkedIn = Date.parse(booking.checkInAt || '')
  if (Number.isFinite(checkedIn)) {
    return new Date(checkedIn + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }
  return cleanText(booking.visitDate, 10)
}

function daysSinceService(booking) {
  const serviceDate = bookingServiceDate(booking)
  const start = Date.parse(serviceDate + 'T00:00:00+08:00')
  const today = Date.parse(todayInChina() + 'T00:00:00+08:00')
  if (!Number.isFinite(start) || !Number.isFinite(today)) return -1
  return Math.floor((today - start) / (24 * 60 * 60 * 1000))
}

function publicFollowupPhotoBooking(booking, stage) {
  const field = followupPhotoField(stage)
  const source = Array.isArray(booking[field]) ? booking[field] : []
  return {
    id: booking.id || '',
    name: booking.name || '',
    visitDate: booking.visitDate || '',
    visitTime: booking.visitTime || '',
    stage: String(stage),
    photos: Array.from({ length: 5 }, (_, index) => source[index] || null)
  }
}

function normalizeFollowupPhotos(input) {
  if (!Array.isArray(input)) throw businessError('INVALID_PHOTOS', '照片数据格式不正确')
  return Array.from({ length: 5 }, (_, index) => {
    const item = input[index]
    if (!item) return null
    const path = cleanText(typeof item === 'string' ? item : (item.path || item.fileID), 500)
    if (!path || !/^(cloud:\/\/|https:\/\/)/.test(path)) {
      throw businessError('INVALID_PHOTOS', '照片上传结果无效，请重新上传')
    }
    return {
      path,
      fileID: path.indexOf('cloud://') === 0 ? path : '',
      name: cleanText(typeof item === 'object' ? item.name : '', 100)
    }
  })
}

async function getFollowupPhotoBooking(openId, event) {
  const bookingId = cleanText(event.bookingId, 40)
  const stage = String(event.stage || '')
  const field = followupPhotoField(stage)
  if (!bookingId) return { success: false, error: '缺少预约编号' }
  if (!field) return { success: false, error: '照片阶段不正确' }

  const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  const booking = res.data && res.data[0]
  if (!booking) return { success: false, error: '预约不存在' }
  const access = await getBookingAccess(openId, booking)
  if (!access.allowed && !access.phone) {
    return { success: false, requiresPhoneAuth: true, error: '请先在“我的”页面授权预约手机号' }
  }
  if (!access.allowed) return { success: false, error: '该预约不属于当前微信账号' }
  if (!['visited', 'in_experience', 'completed'].includes(booking._status)) {
    return { success: false, error: '完成到店签到后才能上传体验后照片' }
  }
  if (daysSinceService(booking) < Number(stage)) {
    return { success: false, error: `体验后${stage}天才可上传本阶段照片` }
  }

  // 操作师代预约的顾客首次用本人手机号进入时，把预约归属绑定到当前微信。
  if (!access.owner && access.phoneOwner) {
    await db.collection('bookings').doc(booking._id).update({
      data: { _openid: openId, updatedAt: new Date().toISOString() }
    })
    booking._openid = openId
  }
  return { success: true, data: publicFollowupPhotoBooking(booking, stage) }
}

async function saveFollowupPhotos(openId, event) {
  const bookingId = cleanText(event.bookingId, 40)
  const stage = String(event.stage || '')
  const field = followupPhotoField(stage)
  if (!bookingId) return { success: false, error: '缺少预约编号' }
  if (!field) return { success: false, error: '照片阶段不正确' }

  const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  const booking = res.data && res.data[0]
  if (!booking) return { success: false, error: '预约不存在' }
  const access = await getBookingAccess(openId, booking)
  if (!access.allowed) return { success: false, error: '无权修改该预约的照片' }
  if (!['visited', 'in_experience', 'completed'].includes(booking._status)) {
    return { success: false, error: '完成到店签到后才能上传体验后照片' }
  }
  if (daysSinceService(booking) < Number(stage)) {
    return { success: false, error: `体验后${stage}天才可上传本阶段照片` }
  }

  const photos = normalizeFollowupPhotos(event.photos)
  const data = { [field]: photos, updatedAt: new Date().toISOString() }
  if (!access.owner && access.phoneOwner) data._openid = openId
  await db.collection('bookings').doc(booking._id).update({ data })
  await cleanupRemovedPhotoFiles(booking, data)
  booking[field] = photos
  return { success: true, data: publicFollowupPhotoBooking(booking, stage) }
}

function pickFields(input, allowed) {
  const output = {}
  Object.keys(input || {}).forEach(key => {
    if (allowed.has(key)) output[key] = input[key]
  })
  output.updatedAt = new Date().toISOString()
  return output
}

function validStatusChange(booking, next, pendingData) {
  if (!next || next === booking._status) return true
  const transitions = {
    pending_confirm: ['confirmed', 'rejected'],
    confirmed: ['visited', 'in_experience', 'cancelled'],
    visited: ['in_experience'],
    in_experience: ['completed'],
    completed: [],
    cancelled: [],
    rejected: []
  }
  const allowed = transitions[booking._status] || []
  if (allowed.indexOf(next) === -1) return false
  if (booking._status === 'confirmed' && (next === 'visited' || next === 'in_experience')) {
    const checkedIn = booking.checkInAt || (pendingData && pendingData.checkInAt)
    const consentSigned = booking.consentSignTime || (pendingData && pendingData.consentSignTime)
    return !!checkedIn && !!consentSigned
  }
  return true
}

async function updateBooking(openId, event) {
  const bookingId = String(event.bookingId || '').trim()
  if (!bookingId) return { success: false, error: '缺少预约编号' }
  const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  const booking = res.data && res.data[0]
  if (!booking) return { success: false, error: '预约不存在' }

  const admin = await getAdmin(openId)
  let data
  if (admin) {
    data = pickFields(event.data, ADMIN_FIELDS)
  } else {
    const verifiedPhone = await getVerifiedPhone(openId)
    const owner = booking._openid === openId || booking._creatorOpenId === openId
    const phoneOwner = verifiedPhone && verifiedPhone === booking.phone
    if (!owner && !phoneOwner) return { success: false, error: '无权修改该预约' }
    data = pickFields(event.data, USER_FIELDS)
    if (data.phone && verifiedPhone && data.phone !== verifiedPhone) {
      return { success: false, error: '手机号必须与微信授权号码一致' }
    }
    if (Object.prototype.hasOwnProperty.call(data, '_status')) {
      const userStatuses = booking._status === 'confirmed'
        ? ['cancelled']
        : []
      if (userStatuses.indexOf(data._status) === -1) {
        return { success: false, error: '当前用户无权执行该状态变更' }
      }
    }
  }

  if (Object.keys(data).length <= 1) return { success: false, error: '没有可更新的字段' }

  if (Object.prototype.hasOwnProperty.call(data, '_status')) {
    await db.runTransaction(async transaction => {
      const bookingRef = transaction.collection('bookings').doc(booking._id)
      const freshRes = await bookingRef.get()
      const freshBooking = freshRes && freshRes.data
      if (!freshBooking) throw businessError('BOOKING_NOT_FOUND', '预约不存在')
      if (
        freshBooking._status === 'confirmed' &&
        (data._status === 'visited' || data._status === 'in_experience') &&
        freshBooking.visitDate !== todayInChina()
      ) {
        throw businessError('CHECKIN_NOT_TODAY', '只能在预约当天到店签到')
      }
      if (!validStatusChange(freshBooking, data._status, data)) {
        throw businessError(
          'INVALID_STATUS',
          `不允许从 ${freshBooking._status} 变更为 ${data._status}`
        )
      }

      await bookingRef.update({ data })
      if (TERMINAL_STATUSES.has(data._status)) {
        const lockId = slotLockId(freshBooking.visitDate || '', freshBooking.visitTime || '')
        try {
          const lockRef = transaction.collection('booking_slots').doc(lockId)
          const lockRes = await lockRef.get()
          const lock = lockRes && lockRes.data
          if (lock && lock.bookingId === freshBooking.id) await lockRef.remove()
        } catch (err) {
          // 兼容上线前没有 booking_slots 锁记录的旧预约。
          if (!isMissingDocumentError(err)) throw err
        }
      }
    }, 5)
  } else {
    await db.collection('bookings').doc(booking._id).update({ data })
  }
  await cleanupRemovedPhotoFiles(booking, data)
  return { success: true }
}

exports.main = async (event) => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  if (!openId) return { success: false, error: '无法识别当前微信用户' }
  try {
    if (event.action === 'create') return await createBooking(openId, event)
    if (event.action === 'listMine') return await listMine(openId)
    if (event.action === 'listToday') return await listToday(openId, event.visitDate)
    if (event.action === 'getForCheckin') {
      return await getForCheckin(openId, String(event.bookingId || '').trim())
    }
    if (event.action === 'completeCheckin') return await completeCheckin(openId, event)
    if (event.action === 'startExperience') return await startExperience(openId, event)
    if (event.action === 'getFollowupPhotoBooking') return await getFollowupPhotoBooking(openId, event)
    if (event.action === 'saveFollowupPhotos') return await saveFollowupPhotos(openId, event)
    if (event.action === 'getStaffNotifyConfig') return await getStaffNotifyConfig(openId)
    if (event.action === 'retryStaffNotify') return await retryStaffNotify(openId, event)
    if (event.action === 'update') return await updateBooking(openId, event)
    return { success: false, error: '不支持的操作' }
  } catch (err) {
    console.error('[bookingService]', err)
    const message = String((err && (err.errMsg || err.message)) || '')
    if (message.includes('INVALID_STATUS:')) {
      return { success: false, error: message.split('INVALID_STATUS:').pop() }
    }
    if (message.includes('BOOKING_NOT_FOUND:')) {
      return { success: false, error: '预约不存在' }
    }
    if (message.includes('CHECKIN_NOT_TODAY:')) {
      return { success: false, error: '只能在预约当天到店签到' }
    }
    if (message.includes('ALREADY_CHECKED_IN:')) {
      return { success: false, error: '该预约已经完成签到' }
    }
    if (message.includes('INVALID_PHOTOS:')) {
      return { success: false, error: message.split('INVALID_PHOTOS:').pop() }
    }
    return { success: false, error: err.message || '预约服务失败' }
  }
}
