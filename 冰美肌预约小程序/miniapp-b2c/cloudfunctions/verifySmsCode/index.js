// 云函数：校验短信验证码
// 正式与Mock模式都必须校验 sendSmsCode 写入数据库的有效验证码
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const phone = (event.phone || '').trim()
  const code = (event.code || '').trim()
  console.log('[verifySmsCode] 校验:', phone.substring(0, 3) + '****' + phone.substring(7), code.substring(0, 1) + '****')

  // 1. 格式校验
  if (!/^1\d{10}$/.test(phone)) {
    return { success: false, error: '手机号格式不正确' }
  }
  if (!/^\d{6}$/.test(code)) {
    return { success: false, error: '验证码为6位数字' }
  }

  // 2. 查询数据库中的有效验证码；Mock模式也不允许跳过校验
  // 注意：避免 orderBy（需要索引），在 JS 端按 createdAt 降序取第一条
  try {
    const now = new Date()
    const res = await db.collection('sms_codes')
      .where({
        phone: phone,
        code: code,
        used: false,
        expiresAt: db.command.gt(now)
      })
      .limit(50)
      .get()

    const list = (res.data || []).filter(r => r.createdAt)
    list.sort((a, b) => {
      const ta = a.createdAt || ''
      const tb = b.createdAt || ''
      return tb.localeCompare ? tb.localeCompare(ta) : (tb > ta ? -1 : 1)
    })
    const valid = list[0]

    if (!valid) {
      return { success: false, error: '验证码错误或已过期' }
    }

    // 3. 标记已使用（防止重复使用）
    await db.collection('sms_codes').doc(valid._id).update({
      data: { used: true, usedAt: now }
    })

    console.log('[verifySmsCode] 校验通过')
    return { success: true, mock: Boolean(valid.mock) }
  } catch (err) {
    console.error('[verifySmsCode] 数据库查询失败:', err)
    return { success: false, error: '系统错误，请稍后重试' }
  }
}
