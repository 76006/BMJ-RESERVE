/**
 * bookingService - 受控预约查询与更新
 *
 * listToday：仅在有效签到码下返回当前微信本人/已验证手机号对应的当日预约。
 * completeCheckin：校验签到码、预约归属和签署信息后，在事务中完成签到。
 * update：管理员可更新业务字段；普通用户不能通过通用更新写入签到凭证或到店状态。
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const TIME_SLOTS = new Set(['9:30-11:30', '13:00-15:00', '15:30-17:30'])
const TERMINAL_STATUSES = new Set(['cancelled', 'rejected', 'no_show'])

const ADMIN_FIELDS = new Set([
  '_status', '_confirmedAt', '_confirmedBy', '_rejectReason', '_cancelReason',
  'checkInAt', 'deviceModel', 'consentSignName', 'consentSignTime',
  'consentSignImage', 'consentPhotoAuth1', 'consentPhotoAuth2',
  'name', 'gender', 'age', 'idCard', 'phone', '_adminNote', '_followUpRecords',
  '_clientManager', '_totalEnergy', '_shotDistribution', '_maxLevel',
  '_immediateSatisfaction', '_comfortSatisfaction', '_productFeedback',
  '_day1FollowUp', '_day30FollowUp', '_day90FollowUp', '_photos',
  '_beforePhotos', '_halfPhotos', '_afterPhotos', '_feedback24',
  '_feedback30', '_feedback90', 'updatedAt'
])

const USER_FIELDS = new Set([
  '_status', '_cancelReason',
  'name', 'gender', 'age', 'idCard', 'phone',
  '_feedback24', '_feedback30', '_feedback90', 'updatedAt'
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

function todayInChina() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function hashCheckinToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex')
}

function validTokenFormat(token) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(token || ''))
}

function hashMatches(expected, token) {
  if (!expected || !validTokenFormat(token)) return false
  const actual = hashCheckinToken(token)
  const left = Buffer.from(String(expected), 'hex')
  const right = Buffer.from(actual, 'hex')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

async function validateStoreCheckinToken(token) {
  if (!validTokenFormat(token)) return false
  try {
    const res = await db.collection('store_config').doc('current').get()
    const config = (res && res.data) || {}
    return hashMatches(config.checkinQrTokenHash, token)
  } catch (err) {
    if (isMissingDocumentError(err)) return false
    throw err
  }
}

async function validateCheckinToken(booking, token) {
  if (!validTokenFormat(token)) return false
  if (hashMatches(booking && booking._checkinTokenHash, token)) {
    const expiresAt = Date.parse(booking._checkinTokenExpiresAt || '')
    return !Number.isFinite(expiresAt) || expiresAt >= Date.now()
  }
  return validateStoreCheckinToken(token)
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
  return linked && linked.openId ? linked.openId : openId
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
    _halfPhotos: [],
    _afterPhotos: [],
    _productFeedback: '',
    _day1FollowUp: '',
    _day30FollowUp: '',
    _day90FollowUp: '',
    _adminNote: '',
    _followUpRecords: [],
    _feedback24: false,
    _feedback30: false,
    _feedback90: false
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
    return { success: true, data: created || booking }
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

async function listToday(openId, visitDate, checkinToken) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate || '')) {
    return { success: false, data: [], error: '日期格式不正确' }
  }
  if (!(await validateStoreCheckinToken(checkinToken))) {
    return { success: false, data: [], invalidCode: true, error: '签到码无效或已更新，请重新扫描门店签到码' }
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
    return item._status === 'confirmed' || item._status === 'visited'
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

async function getForCheckin(openId, bookingId, checkinToken) {
  if (!bookingId) return { success: false, error: '缺少预约编号' }
  const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  const booking = res.data && res.data[0]
  if (!booking) return { success: false, error: '未找到该预约' }

  if (!(await validateCheckinToken(booking, checkinToken))) {
    return { success: false, invalidCode: true, error: '签到码无效或已失效，请让工作人员重新生成' }
  }
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
  if (!(await validateCheckinToken(booking, event.checkinToken))) {
    return { success: false, invalidCode: true, error: '签到码无效或已失效，请重新扫描' }
  }

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
      updatedAt: now,
      _checkinTokenHash: '',
      _checkinTokenExpiresAt: ''
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
  return { success: true }
}

exports.main = async (event) => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  if (!openId) return { success: false, error: '无法识别当前微信用户' }
  try {
    if (event.action === 'create') return await createBooking(openId, event)
    if (event.action === 'listToday') return await listToday(openId, event.visitDate, event.checkinToken)
    if (event.action === 'getForCheckin') {
      return await getForCheckin(openId, String(event.bookingId || '').trim(), event.checkinToken)
    }
    if (event.action === 'completeCheckin') return await completeCheckin(openId, event)
    if (event.action === 'startExperience') return await startExperience(openId, event)
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
    return { success: false, error: err.message || '预约服务失败' }
  }
}
