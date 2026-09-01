/**
 * bookingService - 受控预约查询与更新
 *
 * listToday：仅返回当前微信本人/已验证手机号对应的当日预约。
 * update：管理员可更新业务字段；普通用户只能更新自己的预约或本人手机号预约。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
  '_status', '_cancelReason', 'checkInAt', 'deviceModel',
  'consentSignName', 'consentSignTime', 'consentSignImage',
  'consentPhotoAuth1', 'consentPhotoAuth2',
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

function mergeUnique(groups) {
  const map = {}
  groups.forEach(list => (list || []).forEach(item => {
    const key = item._id || item.id
    if (key) map[key] = item
  }))
  return Object.keys(map).map(key => map[key])
}

async function listToday(openId, visitDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate || '')) {
    return { success: false, data: [], error: '日期格式不正确' }
  }
  const phone = await getVerifiedPhone(openId)
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

  const phone = await getVerifiedPhone(openId)
  const owner = booking._openid === openId || booking._creatorOpenId === openId
  const phoneOwner = !!phone && phone === booking.phone
  if (!owner && !phoneOwner) return { success: false, error: '该预约不属于当前微信账号' }
  if (booking._status !== 'confirmed') return { success: false, error: '该预约当前不可签到' }
  if (booking.checkInAt) return { success: false, error: '该预约已经完成签到' }

  return { success: true, data: publicCheckinBooking(booking) }
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
  }

  if (Object.prototype.hasOwnProperty.call(data, '_status') && !validStatusChange(booking, data._status, data)) {
    return { success: false, error: `不允许从 ${booking._status} 变更为 ${data._status}` }
  }

  if (Object.keys(data).length <= 1) return { success: false, error: '没有可更新的字段' }
  await db.collection('bookings').doc(booking._id).update({ data })
  return { success: true }
}

exports.main = async (event) => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  if (!openId) return { success: false, error: '无法识别当前微信用户' }
  try {
    if (event.action === 'listToday') return await listToday(openId, event.visitDate)
    if (event.action === 'getForCheckin') return await getForCheckin(openId, String(event.bookingId || '').trim())
    if (event.action === 'update') return await updateBooking(openId, event)
    return { success: false, error: '不支持的操作' }
  } catch (err) {
    console.error('[bookingService]', err)
    return { success: false, error: err.message || '预约服务失败' }
  }
}
