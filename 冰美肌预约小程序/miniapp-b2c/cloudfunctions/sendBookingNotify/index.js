// 云函数：预约确认/拒绝后向顾客推送微信订阅消息
// 触发：app.js confirmBooking / rejectBooking 中调用（wx.cloud.callFunction）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// ============ 配置区 ============
// 微信公众平台 → 订阅消息 → 我的模板 中的模板ID（已申请）
const TEMPLATE_ID = 'A09emeoi_5a_1s7UsMD7Twuj5cfYOC-Y1999bCtb-sI'

// 顾客点击通知后跳转的小程序页面（必须是已存在的页面路径）
const PAGE_PATH = '/pages/mine/mine'

// ================================

const clip = (s, n) => {
  s = (s == null ? '' : String(s))
  return s.length > n ? s.slice(0, n) : s
}

// 到店时间（time10）：visitDate + 起始时间，格式化为 "2026-08-25 14:00:00"
function fmtArrival(b) {
  const date = (b.visitDate || '').trim()
  let t = (b.visitTime || '').trim()
  if (t.indexOf('-') > 0) t = t.split('-')[0].trim() // 取区间起始，如 "14:00-15:00" → "14:00"
  if (/^\d{1,2}:\d{2}$/.test(t)) t = t + ':00'        // 补秒，如 "14:00" → "14:00:00"
  if (!date) return t || ''
  return t ? date + ' ' + t : date
}

function buildData(b, status, storeConfig) {
  const ok = status === 'confirmed'
  const notice = b.storeAppointmentNotice || storeConfig.appointmentNotice || '请提前10分钟到店，素颜更佳'
  const address = b.storeAddress || storeConfig.address || '请联系门店确认地址'
  return {
    thing3:   { value: clip(notice, 20) },                       // 注意事项
    thing4:   { value: clip(address, 20) },                      // 地址
    time10:   { value: fmtArrival(b) },                         // 到店时间
    phrase11: { value: clip(ok ? '预约成功' : '预约失败', 5) }   // 预约状态
  }
}

exports.main = async (event) => {
  const { bookingId, status } = event || {}
  if (!bookingId) return { ok: false, error: 'missing bookingId' }
  if (status !== 'confirmed' && status !== 'rejected') {
    return { ok: false, error: 'invalid status' }
  }
  if (TEMPLATE_ID === 'REPLACE_WITH_YOUR_TEMPLATE_ID') {
    return { ok: false, error: 'TEMPLATE_ID 未配置' }
  }

  const db = cloud.database()
  const openId = cloud.getWXContext().OPENID
  const adminRes = await db.collection('admins')
    .where({ openId, active: true })
    .limit(1)
    .get()
  if (!adminRes.data || !adminRes.data[0]) {
    return { ok: false, error: '无管理员权限' }
  }
  let b
  try {
    // 业务主键是 booking.id，不是文档 _id，必须用 where 查询
    const res = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
    b = res.data && res.data[0]
  } catch (e) {
    return { ok: false, error: 'booking query failed: ' + (e.errMsg || e.message) }
  }
  if (!b) {
    return { ok: false, error: 'booking not found: ' + bookingId }
  }

  let storeConfig = {}
  try {
    const storeRes = await db.collection('store_config').doc('current').get()
    storeConfig = storeRes.data || {}
  } catch (e) {
    // 旧环境可能尚未建立门店配置，继续使用预约快照或安全兜底。
    storeConfig = {}
  }

  // 收件人使用预约归属 OpenID；操作师代预约时会优先关联已验证手机号对应的顾客。
  const touser = b._openid || b._creatorOpenId
  if (!touser) {
    return { ok: false, error: 'booking missing recipient openid' }
  }

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: touser,
      templateId: TEMPLATE_ID,
      page: PAGE_PATH,
      data: buildData(b, status || 'confirmed', storeConfig)
    })
    return { ok: true }
  } catch (e) {
    // 常见失败：顾客未授权 / 授权过期 / 模板字段不匹配 / 云函数未声明 openapi 权限
    return { ok: false, error: e.errMsg || e.message }
  }
}
