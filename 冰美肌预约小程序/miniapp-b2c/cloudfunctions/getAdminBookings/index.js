/**
 * getAdminBookings - 管理员获取所有预约记录
 * 云函数以管理员权限运行，绕过数据库安全规则
 *
 * 入参: { limit: number } 默认200
 * 返回: { success: boolean, data: array }
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const limit = Math.min(event.limit || 200, 500)

  try {
    const res = await db.collection('bookings').limit(limit).get()
    const data = res.data || []

    // 按 createdAt 降序排序
    data.sort((a, b) => {
      const ta = (a.createdAt || '').toString()
      const tb = (b.createdAt || '').toString()
      return tb.localeCompare(ta)
    })

    console.log('[getAdminBookings] 返回 ' + data.length + ' 条记录')
    return { success: true, data }
  } catch (err) {
    console.error('[getAdminBookings] 查询失败:', err)
    return { success: false, data: [], error: err.message }
  }
}
