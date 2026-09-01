/**
 * loginByPhone - 微信手机号登录与管理员身份校验
 *
 * action=check：只按当前调用者 OPENID 校验管理员身份。
 * 默认登录：仅接受微信 getPhoneNumber 返回的 code/cloudID，不接受明文手机号。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function userResult(extra) {
  return Object.assign({ ok: true, isAdmin: false, role: 'user', name: '', phone: '' }, extra || {})
}

async function findAdminByOpenId(openId) {
  if (!openId) return null
  const res = await db.collection('admins')
    .where({ openId, active: true })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

async function touchUser(openId, phone) {
  if (!openId) return
  const now = new Date().toISOString()
  const res = await db.collection('users').where({ openId }).limit(1).get()
  const data = { lastVisit: now }
  if (phone) {
    data.phone = phone
    data.phoneVerified = true
    data.phoneVerifiedAt = now
  }
  if (res.data && res.data[0]) {
    await db.collection('users').doc(res.data[0]._id).update({ data })
    return
  }
  await db.collection('users').add({
    data: Object.assign({
      openId,
      firstVisit: now,
      lastVisit: now,
      visitCount: 1
    }, phone ? {
      phone,
      phoneVerified: true,
      phoneVerifiedAt: now
    } : {})
  })
}

async function resolvePhone(event) {
  if (event.code) {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code: event.code })
    return result && result.phoneInfo ? result.phoneInfo.phoneNumber || '' : ''
  }
  if (event.cloudID) {
    const openData = await cloud.getOpenData({ list: [event.cloudID] })
    const item = openData && openData.list && openData.list[0]
    return item && item.data ? item.data.phoneNumber || '' : ''
  }
  return ''
}

function adminResult(admin, phone) {
  return {
    ok: true,
    isAdmin: true,
    role: admin.role || 'staff',
    name: admin.name || '管理员',
    phone: phone || admin.phone || ''
  }
}

exports.main = async (event) => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  if (!openId) return userResult({ ok: false, error: '无法识别当前微信用户' })

  try {
    if (event.action === 'check') {
      const admin = await findAdminByOpenId(openId)
      if (admin) return adminResult(admin)
      await touchUser(openId)
      return userResult()
    }

    const phone = await resolvePhone(event)
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return userResult({ ok: false, error: '手机号授权失败，请重新授权' })
    }

    await touchUser(openId, phone)
    const adminRes = await db.collection('admins')
      .where({ phone, active: true })
      .limit(1)
      .get()

    if (!adminRes.data || !adminRes.data[0]) {
      return userResult({ phone })
    }

    const admin = adminRes.data[0]
    if (admin.openId && admin.openId !== openId) {
      return userResult({
        ok: false,
        phone,
        error: '该工作人员账号已绑定其他微信，请联系超级管理员重置'
      })
    }

    const now = new Date().toISOString()
    await db.collection('admins').doc(admin._id).update({
      data: { openId, lastLoginAt: now, updatedAt: now }
    })
    return adminResult(admin, phone)
  } catch (err) {
    console.error('[loginByPhone]', err)
    return userResult({ ok: false, error: err.message || '登录失败' })
  }
}
