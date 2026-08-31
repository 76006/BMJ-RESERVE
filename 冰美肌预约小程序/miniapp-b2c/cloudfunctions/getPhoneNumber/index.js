/**
 * getPhoneNumber - 通过 code 获取手机号（新 API）
 *
 * 入参: { code: string }
 * 返回: { phone: string }
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { code } = event
  if (!code) {
    return { phone: '', error: 'missing code' }
  }
  try {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    if (result && result.phoneInfo && result.phoneInfo.phoneNumber) {
      return { phone: result.phoneInfo.phoneNumber }
    }
    return { phone: '', error: 'decrypt failed' }
  } catch (err) {
    console.error('[getPhoneNumber]', err)
    return { phone: '', error: err.message }
  }
}
