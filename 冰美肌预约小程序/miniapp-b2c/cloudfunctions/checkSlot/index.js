/**
 * checkSlot - 服务端权威判断某 (visitDate, visitTime) 时段是否已被占用
 * 用于普通用户提交预约前的最后一道校验，避免两个用户并发抢同一时段。
 *
 * 占用定义：bookings 集合中存在该 (visitDate, visitTime) 且 _status
 *   不属于 {cancelled} 的记录即视为占用（pending_confirm/confirmed/
 *   visited/in_experience/completed 都占；取消后自动释放）。
 *
 * 入参: { visitDate: 'YYYY-MM-DD', visitTime: '9:30-11:30' }
 * 返回: { success: boolean, occupied: boolean, count: number,
 *         occupant?: { name, phone }, error?: string }
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { visitDate, visitTime } = event
  if (!visitDate || !visitTime) {
    return { success: false, occupied: false, count: 0, error: '缺少 visitDate 或 visitTime' }
  }

  try {
    // 排除已取消的记录（取消后时段释放）
    const res = await db.collection('bookings')
      .where({
        visitDate: visitDate,
        visitTime: visitTime,
        _status: _.nin(['cancelled'])
      })
      .field({ name: true, phone: true, _status: true })
      .limit(10)
      .get()

    const data = res.data || []
    const occupied = data.length > 0
    // 脱敏占用人信息（仅返回姓名末字 + 手机号前3后4，避免泄露隐私）
    let occupant = null
    if (occupied) {
      const o = data[0]
      const phone = (o.phone || '').replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
      occupant = {
        name: (o.name || '').slice(-1) ? (o.name.slice(0, 1) + '**') : '',
        phone: phone
      }
    }

    console.log('[checkSlot]', visitDate, visitTime, 'occupied=' + occupied, 'count=' + data.length)
    return { success: true, occupied, count: data.length, occupant }
  } catch (err) {
    console.error('[checkSlot] 查询失败:', err)
    return { success: false, occupied: false, count: 0, error: err.message }
  }
}
