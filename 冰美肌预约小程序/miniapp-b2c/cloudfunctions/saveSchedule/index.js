/**
 * saveSchedule - 管理员保存时段开关（开放时段）
 * 以管理员权限运行，把时段开关写进云端集合 schedule（doc 'current'）。
 *
 * 入参: { schedule: { 'YYYY-MM-DD': ['9:30-11:30', ...] } }
 * 返回: { success: boolean, updated: number, error?: string }
 *
 * 安全说明：本函数以云函数身份写入，故集合 schedule 可读权限可保持
 * "所有用户可读"（供顾客端读取开放时段），写权限通过云函数绕过安全
 * 规则。管理员身份必须在云函数内按当前 OPENID 校验，不能信任前端缓存。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function isAdmin(openId) {
  if (!openId) return false
  const res = await db.collection('admins')
    .where({ openId, active: true })
    .limit(1)
    .get()
  return !!(res.data && res.data[0])
}

exports.main = async (event) => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  if (!(await isAdmin(openId))) {
    return { success: false, updated: 0, error: '无管理员权限' }
  }
  // 入参校验：schedule 必须是对象
  const schedule = event.schedule
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    return { success: false, updated: 0, error: 'schedule 参数格式不正确' }
  }

  try {
    // 统一存到 doc('current')，结构为 { schedule, updatedAt }
    const docRef = db.collection('schedule').doc('current')
    await docRef.set({
      data: {
        schedule: schedule,
        updatedAt: new Date().toISOString()
      }
    })
    console.log('[saveSchedule] 已保存时段开关, 日期数=' + Object.keys(schedule).length)
    return { success: true, updated: Object.keys(schedule).length }
  } catch (err) {
    console.error('[saveSchedule] 写入失败:', err)
    return { success: false, updated: 0, error: err.message }
  }
}
