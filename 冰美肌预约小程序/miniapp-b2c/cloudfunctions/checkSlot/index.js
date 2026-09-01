/**
 * checkSlot - 查询某日/某时段是否被占用
 * 只返回时段状态，不返回预约人的姓名、手机号等个人信息。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  event = event || {}
  const visitDate = String(event.visitDate || '').trim()
  const visitTime = String(event.visitTime || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
    return { success: false, occupied: false, occupiedSlots: [], error: '日期格式不正确' }
  }

  try {
    const where = {
      visitDate,
      _status: _.nin(['cancelled', 'no_show', 'rejected'])
    }
    if (visitTime) where.visitTime = visitTime

    const res = await db.collection('bookings')
      .where(where)
      .field({ visitTime: true })
      .limit(200)
      .get()
    const data = res.data || []

    if (visitTime) {
      return { success: true, occupied: data.length > 0, count: data.length }
    }
    const occupiedSlots = Array.from(new Set(data.map(item => item.visitTime).filter(Boolean)))
    return { success: true, occupiedSlots }
  } catch (err) {
    console.error('[checkSlot]', err)
    return { success: false, occupied: false, occupiedSlots: [], error: err.message || '查询失败' }
  }
}
