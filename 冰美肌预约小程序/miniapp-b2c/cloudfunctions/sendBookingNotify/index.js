// 云函数：预约确认/拒绝后向顾客推送微信订阅消息
// 触发：app.js confirmBooking / rejectBooking 中调用（wx.cloud.callFunction）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// ============ 配置区 ============
// 微信公众平台 → 订阅消息 → 我的模板 中的模板ID（已申请）
const TEMPLATE_ID = 'A09emeoi_5a_1s7UsMD7Twuj5cfYOC-Y1999bCtb-sI'

// 顾客点击通知后跳转的小程序页面（必须是已存在的页面路径）
const PAGE_PATH = '/pages/mine/mine'

// 注意事项（thing3，≤20字）
const NOTICE_TEXT = '请提前10分钟到店，素颜更佳'
// 门店地址（thing4，≤20字）—— TODO: 替换为真实门店地址（超长会被微信拒绝发送）
const STORE_ADDRESS = '冰美肌门店'
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

function buildData(b, status) {
  const ok = status === 'confirmed'
  return {
    thing3:   { value: clip(NOTICE_TEXT, 20) },                 // 注意事项
    thing4:   { value: clip(STORE_ADDRESS, 20) },               // 地址
    time10:   { value: fmtArrival(b) },                         // 到店时间
    phrase11: { value: clip(ok ? '预约成功' : '预约失败', 5) }   // 预约状态
  }
}

exports.main = async (event) => {
  const { bookingId, status } = event || {}
  if (!bookingId) return { ok: false, error: 'missing bookingId' }
  if (TEMPLATE_ID === 'REPLACE_WITH_YOUR_TEMPLATE_ID') {
    return { ok: false, error: 'TEMPLATE_ID 未配置' }
  }

  const db = cloud.database()
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

  // 收件人：自助下单时为顾客 openId；操作师代下场景下该字段是操作师，属已知限制
  const touser = b._openid || b._creatorOpenId
  if (!touser) {
    return { ok: false, error: 'booking missing recipient openid' }
  }

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: touser,
      templateId: TEMPLATE_ID,
      page: PAGE_PATH,
      data: buildData(b, status || 'confirmed')
    })
    return { ok: true }
  } catch (e) {
    // 常见失败：顾客未授权 / 授权过期 / 模板字段不匹配 / 云函数未声明 openapi 权限
    return { ok: false, error: e.errMsg || e.message }
  }
}
