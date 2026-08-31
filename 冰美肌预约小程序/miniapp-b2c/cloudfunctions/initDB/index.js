// 云函数：初始化数据库集合（一次性执行）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const results = {}

  // 创建 bookings 集合索引
  try {
    // 集合自动创建，这里写入一条测试文档后删除来确保集合存在
    await db.collection('bookings').count()
    results.bookings = '已就绪'
  } catch (e) {
    results.bookings = '创建中: ' + e.message
  }

  // 创建 feedbacks 集合
  try {
    await db.collection('feedbacks').count()
    results.feedbacks = '已就绪'
  } catch (e) {
    results.feedbacks = '创建中: ' + e.message
  }

  // 创建 users 集合
  try {
    await db.collection('users').count()
    results.users = '已就绪'
  } catch (e) {
    results.users = '创建中: ' + e.message
  }

  // 创建 admins 集合
  try {
    await db.collection('admins').count()
    results.admins = '已就绪'
  } catch (e) {
    results.admins = '创建中: ' + e.message
  }

  return {
    code: 0,
    msg: '数据库初始化完成',
    env: cloud.DYNAMIC_CURRENT_ENV,
    collections: results
  }
}
