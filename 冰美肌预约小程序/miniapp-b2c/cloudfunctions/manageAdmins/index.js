/**
 * manageAdmins - 仅超级管理员可调用的人员管理接口
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function requireSuperAdmin() {
  const openId = cloud.getWXContext().OPENID
  if (!openId) return null
  const res = await db.collection('admins')
    .where({ openId, active: true, role: 'superadmin' })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'staff'
}

function publicAdmin(doc) {
  return {
    phone: doc.phone || '',
    name: doc.name || '',
    role: doc.role || 'staff',
    openId: doc.openId || '',
    createdAt: doc.createdAt || ''
  }
}

async function overview() {
  const [adminRes, userRes] = await Promise.all([
    db.collection('admins').where({ active: db.command.neq(false) }).limit(100).get(),
    db.collection('users').orderBy('lastVisit', 'desc').limit(200).get()
  ])
  return {
    ok: true,
    admins: (adminRes.data || []).map(publicAdmin),
    users: (userRes.data || []).map(doc => ({
      openId: doc.openId || '',
      phone: doc.phone || '',
      firstVisit: doc.firstVisit || '',
      lastVisit: doc.lastVisit || ''
    }))
  }
}

async function addAdmin(event) {
  const phone = String(event.phone || '').trim()
  const openId = String(event.openId || '').trim()
  const name = String(event.name || '').trim()
  const role = normalizeRole(event.role)
  if (!name || (!phone && !openId)) return { ok: false, error: '姓名以及手机号或用户标识必填' }
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) return { ok: false, error: '手机号格式不正确' }

  let exist = { data: [] }
  if (phone) exist = await db.collection('admins').where({ phone }).limit(1).get()
  if ((!exist.data || !exist.data[0]) && openId) {
    exist = await db.collection('admins').where({ openId }).limit(1).get()
  }

  const now = new Date().toISOString()
  if (exist.data && exist.data[0]) {
    const doc = exist.data[0]
    if (doc.role === 'superadmin') return { ok: false, error: '不能通过人员管理修改超级管理员' }
    await db.collection('admins').doc(doc._id).update({
      data: {
        phone: phone || doc.phone || '',
        openId: openId || doc.openId || '',
        name,
        role,
        active: true,
        updatedAt: now
      }
    })
    return { ok: true, updated: true }
  }

  await db.collection('admins').add({
    data: {
      phone,
      openId,
      name,
      role,
      active: true,
      createdAt: now,
      updatedAt: now
    }
  })
  return { ok: true, added: true }
}

async function removeAdmin(event, caller) {
  const phone = String(event.phone || '').trim()
  const openId = String(event.openId || '').trim()
  if (!phone && !openId) return { ok: false, error: '缺少人员标识' }
  const res = phone
    ? await db.collection('admins').where({ phone }).limit(1).get()
    : await db.collection('admins').where({ openId }).limit(1).get()
  const doc = res.data && res.data[0]
  if (!doc) return { ok: false, error: '未找到该人员' }
  if (doc.role === 'superadmin' || doc.openId === caller.openId) {
    return { ok: false, error: '不能移除超级管理员本人' }
  }
  await db.collection('admins').doc(doc._id).update({
    data: {
      active: false,
      openId: '',
      updatedAt: new Date().toISOString()
    }
  })
  return { ok: true, removed: true }
}

exports.main = async (event) => {
  event = event || {}
  try {
    const caller = await requireSuperAdmin()
    if (!caller) return { ok: false, error: '无权限：仅超级管理员可操作' }
    switch (event.action) {
      case 'overview': return await overview()
      case 'add': return await addAdmin(event)
      case 'remove': return await removeAdmin(event, caller)
      default: return { ok: false, error: '不支持的操作' }
    }
  } catch (err) {
    console.error('[manageAdmins]', err)
    return { ok: false, error: err.message || '人员管理失败' }
  }
}
