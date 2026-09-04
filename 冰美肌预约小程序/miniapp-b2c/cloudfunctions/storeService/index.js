/**
 * storeService - 唯一门店信息读取与维护
 * get：所有微信用户可调用，仅返回公开门店资料。
 * save：仅 admins 集合中 active=true 的操作师或管理员可调用。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_CONFIG = {
  storeName: '冰美肌',
  address: '',
  contactPhone: '',
  contactWechat: '',
  businessHours: '',
  appointmentNotice: '请提前10分钟到店，素颜更佳'
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength)
}

function publicConfig(doc) {
  doc = doc || {}
  return {
    storeName: cleanText(doc.storeName || DEFAULT_CONFIG.storeName, 40),
    address: cleanText(doc.address, 120),
    contactPhone: cleanText(doc.contactPhone, 30),
    contactWechat: cleanText(doc.contactWechat, 50),
    businessHours: cleanText(doc.businessHours, 80),
    appointmentNotice: cleanText(doc.appointmentNotice || DEFAULT_CONFIG.appointmentNotice, 80),
    configured: !!doc.configured,
    updatedAt: doc.updatedAt || ''
  }
}

function normalizeTrainers(input) {
  if (!Array.isArray(input)) return []
  if (input.length > 100) throw new Error('操作师配置最多保存100条')
  const ids = new Set()
  return input.map(item => {
    const id = cleanText(item && item.id, 24)
    const name = cleanText(item && item.name, 40)
    const channel = item && item.channel === 'medical' ? 'medical' : 'beauty'
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('操作师ID只能包含字母、数字、下划线和短横线')
    if (!name) throw new Error('操作师姓名不能为空')
    if (ids.has(id)) throw new Error(`操作师ID重复：${id}`)
    ids.add(id)
    return {
      id,
      name,
      channel,
      sceneParam: `channel=${channel}&trainer=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`
    }
  })
}

function isMissingDocumentError(err) {
  const message = String((err && (err.errMsg || err.message)) || '').toLowerCase()
  return message.includes('not exist') || message.includes('not found') ||
    message.includes('not_exist') || message.includes('document_not_found') || message.includes('-502001')
}

async function getCurrent() {
  try {
    const res = await db.collection('store_config').doc('current').get()
    return publicConfig(res && res.data)
  } catch (err) {
    if (isMissingDocumentError(err)) return publicConfig(DEFAULT_CONFIG)
    throw err
  }
}

async function getAdmin(openId) {
  if (!openId) return null
  const res = await db.collection('admins')
    .where({ openId, active: true })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

async function save(openId, input) {
  const admin = await getAdmin(openId)
  if (!admin || !['staff', 'admin', 'superadmin'].includes(admin.role)) {
    return { success: false, error: '仅操作师或管理员可以修改门店信息' }
  }

  const data = {
    storeName: cleanText(input.storeName, 40),
    address: cleanText(input.address, 120),
    contactPhone: cleanText(input.contactPhone, 30),
    contactWechat: cleanText(input.contactWechat, 50),
    businessHours: cleanText(input.businessHours, 80),
    appointmentNotice: cleanText(input.appointmentNotice, 80)
  }
  if (!data.storeName) return { success: false, error: '请填写门店名称' }
  if (!data.address) return { success: false, error: '请填写门店地址' }
  if (!data.contactPhone) return { success: false, error: '请填写联系电话' }
  if (!/^[0-9+\-\s()]{6,30}$/.test(data.contactPhone)) {
    return { success: false, error: '联系电话格式不正确' }
  }
  if (!data.appointmentNotice) data.appointmentNotice = DEFAULT_CONFIG.appointmentNotice

  const now = new Date().toISOString()
  const storeRef = db.collection('store_config').doc('current')
  const updateData = Object.assign({}, data, {
    configured: true,
    updatedAt: now,
    updatedByOpenId: openId,
    updatedByName: admin.name || '管理员'
  })
  try {
    await storeRef.get()
    // 使用 update 保留文档中的其他内部字段，门店资料保存只修改门店配置。
    await storeRef.update({ data: updateData })
  } catch (err) {
    if (!isMissingDocumentError(err)) throw err
    await storeRef.set({ data: Object.assign({ createdAt: now }, updateData) })
  }
  return { success: true, data: publicConfig(Object.assign({}, data, { configured: true, updatedAt: now })) }
}

async function getTrainers(openId) {
  const admin = await getAdmin(openId)
  if (!admin || !['staff', 'admin', 'superadmin'].includes(admin.role)) {
    return { success: false, data: [], error: '仅操作师或管理员可以读取二维码配置' }
  }
  try {
    const res = await db.collection('store_config').doc('current').get()
    return { success: true, data: normalizeTrainers(res && res.data && res.data.trainers) }
  } catch (err) {
    if (isMissingDocumentError(err)) return { success: true, data: [] }
    throw err
  }
}

async function saveTrainers(openId, input) {
  const admin = await getAdmin(openId)
  if (!admin || !['staff', 'admin', 'superadmin'].includes(admin.role)) {
    return { success: false, data: [], error: '仅操作师或管理员可以修改二维码配置' }
  }
  const trainers = normalizeTrainers(input)
  const now = new Date().toISOString()
  const storeRef = db.collection('store_config').doc('current')
  const updateData = {
    trainers,
    qrConfigUpdatedAt: now,
    qrConfigUpdatedByOpenId: openId,
    qrConfigUpdatedByName: admin.name || '管理员'
  }
  try {
    await storeRef.get()
    await storeRef.update({ data: updateData })
  } catch (err) {
    if (!isMissingDocumentError(err)) throw err
    await storeRef.set({ data: Object.assign({ createdAt: now }, updateData) })
  }
  return { success: true, data: trainers }
}

exports.main = async event => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  try {
    if (event.action === 'get') return { success: true, data: await getCurrent() }
    if (event.action === 'save') return await save(openId, event.data || {})
    if (event.action === 'getTrainers') return await getTrainers(openId)
    if (event.action === 'saveTrainers') return await saveTrainers(openId, event.data || [])
    return { success: false, error: '不支持的操作' }
  } catch (err) {
    console.error('[storeService]', err)
    const message = String((err && (err.errMsg || err.message)) || '')
    if (message.includes('store_config')) {
      return { success: false, error: '请先在云数据库创建 store_config 集合' }
    }
    return { success: false, error: err.message || '门店配置服务失败' }
  }
}
