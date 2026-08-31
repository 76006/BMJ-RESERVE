/**
 * manageAdmins - 管理员增删查（供后台运维用）
 * 
 * 入参:
 *   action: 'add' | 'remove' | 'list'
 *   phone:  手机号 (add/remove 必传)
 *   name:   姓名 (add 必传)
 *   role:   'staff' | 'superadmin' (add 时默认 'staff')
 *   secret: 操作密钥 (必传，防滥用)
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 从环境变量读取操作密钥（在云开发控制台 → 云函数 → 环境变量 中配置）
const SECRET = process.env.ADMIN_SECRET || ''

exports.main = async (event) => {
  const { action, phone, name, role, secret } = event

  // 安全检查
  if (!SECRET) {
    return { ok: false, error: 'ADMIN_SECRET 未配置' }
  }
  if (secret !== SECRET) {
    return { ok: false, error: '密钥错误' }
  }

  try {
    switch (action) {
      case 'add':
        return await addAdmin(phone, name, role)
      case 'remove':
        return await removeAdmin(phone)
      case 'list':
        return await listAdmins()
      default:
        return { ok: false, error: `未知操作: ${action}，支持 add / remove / list` }
    }
  } catch (err) {
    console.error('[manageAdmins]', err)
    return { ok: false, error: err.message }
  }
}

// 添加管理员（按手机号，自动处理重复）
async function addAdmin(phone, name, role) {
  if (!phone || !name) {
    return { ok: false, error: '手机号和姓名必填' }
  }

  // 查是否已存在
  const exist = await db.collection('admins').where({ phone }).limit(1).get()
  if (exist.data && exist.data.length > 0) {
    const doc = exist.data[0]
    if (doc.active) {
      // 激活状态，更新姓名/角色
      await db.collection('admins').doc(doc._id).update({
        data: {
          name,
          role: role || 'staff',
          active: true,
          updatedAt: new Date().toISOString()
        }
      })
      console.log(`[manageAdmins] 已更新: ${name} (${role}) phone=${phone}`)
      return { ok: true, msg: `已更新 ${name}(${role}) 的权限`, existed: true }
    } else {
      // 之前被移除，重新激活
      await db.collection('admins').doc(doc._id).update({
        data: {
          name,
          role: role || 'staff',
          active: true,
          updatedAt: new Date().toISOString()
        }
      })
      console.log(`[manageAdmins] 已重新激活: ${name} (${role}) phone=${phone}`)
      return { ok: true, msg: `已重新激活 ${name}(${role})`, reactivated: true }
    }
  }

  // 新建
  await db.collection('admins').add({
    data: {
      phone,
      name,
      role: role || 'staff',
      openId: '',  // 首次登录时由 loginByPhone 自动绑定
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  })

  console.log(`[manageAdmins] 已添加: ${name} (${role}) phone=${phone}`)
  return { ok: true, msg: `已添加 ${name}(${role})`, added: true }
}

// 移除管理员（设 inactive，不删记录）
async function removeAdmin(phone) {
  if (!phone) {
    return { ok: false, error: '手机号必填' }
  }

  const res = await db.collection('admins').where({ phone }).limit(1).get()
  if (!res.data || res.data.length === 0) {
    return { ok: false, error: '未找到该手机号的管理员记录' }
  }

  const doc = res.data[0]
  if (doc.role === 'superadmin') {
    return { ok: false, error: '不允许移除超级管理员，请先在后台降级为操作师' }
  }

  await db.collection('admins').doc(doc._id).update({
    data: {
      active: false,
      updatedAt: new Date().toISOString()
    }
  })

  console.log(`[manageAdmins] 已移除: ${doc.name} phone=${phone}`)
  return { ok: true, msg: `已移除 ${doc.name}`, removed: true }
}

// 列出所有活跃管理员
async function listAdmins() {
  const res = await db.collection('admins')
    .where({ active: true })
    .field({ phone: true, name: true, role: true, createdAt: true })
    .limit(50)
    .get()

  const list = (res.data || []).map(doc => ({
    phone: doc.phone || '',
    name: doc.name || '',
    role: doc.role || 'staff',
    createdAt: (doc.createdAt || '').substring(0, 10)
  }))

  return { ok: true, list }
}
