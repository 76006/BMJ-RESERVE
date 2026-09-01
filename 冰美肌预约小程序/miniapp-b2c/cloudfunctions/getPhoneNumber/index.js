/**
 * getPhoneNumber - 通过微信一次性 code 获取并记录已验证手机号
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function saveVerifiedPhone(openId, phone) {
  if (!openId || !phone) return
  const now = new Date().toISOString()
  const res = await db.collection('users').where({ openId }).limit(1).get()
  const data = {
    phone,
    phoneVerified: true,
    phoneVerifiedAt: now,
    lastVisit: now
  }
  if (res.data && res.data[0]) {
    await db.collection('users').doc(res.data[0]._id).update({ data })
  } else {
    await db.collection('users').add({
      data: Object.assign({ openId, firstVisit: now, visitCount: 1 }, data)
    })
  }
}

exports.main = async (event) => {
  const code = event && event.code
  const openId = cloud.getWXContext().OPENID
  if (!code || !openId) return { phone: '', error: 'missing code or user identity' }

  try {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    const phone = result && result.phoneInfo ? result.phoneInfo.phoneNumber || '' : ''
    if (!phone) return { phone: '', error: 'decrypt failed' }
    await saveVerifiedPhone(openId, phone)
    return { phone }
  } catch (err) {
    console.error('[getPhoneNumber]', err)
    return { phone: '', error: err.message || 'decrypt failed' }
  }
}
