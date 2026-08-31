const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const results = {}
  const collections = ['bookings', 'admins', 'users', 'feedbacks']

  // 创建集合（幂等：已存在则跳过）
  for (const name of collections) {
    try {
      await db.collection(name).count()
      results[name] = 'exists'
    } catch (e) {
      try {
        await db.createCollection(name)
        results[name] = 'created'
      } catch (err) {
        results[name] = 'error: ' + err.message
      }
    }
  }

  return {
    success: true,
    env: cloud.DYNAMIC_CURRENT_ENV,
    collections: results,
    note: '请在云开发控制台→数据库→数据权限→自定义安全规则，填入：{"read":true,"write":true}'
  }
}
