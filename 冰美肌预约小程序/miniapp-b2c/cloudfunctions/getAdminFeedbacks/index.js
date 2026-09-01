/** getAdminFeedbacks - 仅真实管理员可读取全部回访问卷 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function isAdmin(openId) {
  const res = await db.collection('admins')
    .where({ openId, active: true })
    .limit(1)
    .get()
  return !!(res.data && res.data[0])
}

exports.main = async (event) => {
  const openId = cloud.getWXContext().OPENID
  try {
    if (!openId || !(await isAdmin(openId))) {
      return { success: false, data: [], error: '无管理员权限' }
    }
    const limit = Math.min(Math.max(Number(event && event.limit) || 200, 1), 500)
    const res = await db.collection('feedbacks').limit(limit).get()
    return { success: true, data: res.data || [] }
  } catch (err) {
    console.error('[getAdminFeedbacks]', err)
    return { success: false, data: [], error: err.message || '查询失败' }
  }
}
