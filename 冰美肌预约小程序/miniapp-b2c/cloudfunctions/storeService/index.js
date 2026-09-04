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

const DEFAULT_QUESTIONNAIRES = {
  day30: [
    { key: 'nasolabial', type: 'area', label: '法令纹淡化（1-5分）' },
    { key: 'forehead', type: 'area', label: '抬头纹淡化（1-5分）' },
    { key: 'marionette', type: 'area', label: '木偶纹淡化（1-5分）' },
    { key: 'skintone', type: 'area', label: '肤色改善（1-5分）' },
    { key: 'applemuscle', type: 'area', label: '苹果肌上移（1-5分）' },
    { key: 'jawline', type: 'area', label: '下颌线清晰（1-5分）' },
    { key: 'environment', type: 'experience', label: '环境舒适度（1-5分）' },
    { key: 'quiet', type: 'experience', label: '室内安静度（1-5分）' },
    { key: 'device', type: 'experience', label: '仪器舒适度（1-5分）' },
    { key: 'flow', type: 'experience', label: '流程便利性（1-5分）' },
    { key: 'recommend', type: 'experience', label: '愿意推荐度（1-5分）' },
    { key: 'text', type: 'text', label: '文字反馈（客户填写感受）' }
  ],
  day90: []
}
DEFAULT_QUESTIONNAIRES.day90 = DEFAULT_QUESTIONNAIRES.day30
  .map(item => Object.assign({}, item))
  .concat([{ key: 'revisit', type: 'revisit', label: '二次体验意愿（是/否）' }])

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

function normalizeQuestionnaire(input, defaults) {
  const incoming = Array.isArray(input) ? input : []
  const byKey = {}
  incoming.forEach(item => {
    if (item && item.key) byKey[String(item.key)] = item
  })
  return defaults.map(defaultItem => {
    const item = byKey[defaultItem.key] || {}
    return {
      key: defaultItem.key,
      type: defaultItem.type,
      label: cleanText(item.label || defaultItem.label, 60)
    }
  })
}

function publicQuestionnaireTemplates(doc) {
  const saved = doc && doc.questionnaireTemplates
  return {
    day30: normalizeQuestionnaire(saved && saved.day30, DEFAULT_QUESTIONNAIRES.day30),
    day90: normalizeQuestionnaire(saved && saved.day90, DEFAULT_QUESTIONNAIRES.day90),
    updatedAt: (doc && doc.questionnaireUpdatedAt) || ''
  }
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

async function getQuestionnaireTemplates() {
  try {
    const res = await db.collection('store_config').doc('current').get()
    return { success: true, data: publicQuestionnaireTemplates(res && res.data) }
  } catch (err) {
    if (isMissingDocumentError(err)) {
      return { success: true, data: publicQuestionnaireTemplates(null) }
    }
    throw err
  }
}

async function saveQuestionnaireTemplates(openId, input) {
  const admin = await getAdmin(openId)
  if (!admin || !['staff', 'admin', 'superadmin'].includes(admin.role)) {
    return { success: false, error: '仅操作师或管理员可以编辑回访问卷' }
  }
  const templates = {
    day30: normalizeQuestionnaire(input && input.day30, DEFAULT_QUESTIONNAIRES.day30),
    day90: normalizeQuestionnaire(input && input.day90, DEFAULT_QUESTIONNAIRES.day90)
  }
  const now = new Date().toISOString()
  const storeRef = db.collection('store_config').doc('current')
  const updateData = {
    questionnaireTemplates: templates,
    questionnaireUpdatedAt: now,
    questionnaireUpdatedByOpenId: openId,
    questionnaireUpdatedByName: admin.name || '管理员'
  }
  try {
    await storeRef.get()
    await storeRef.update({ data: updateData })
  } catch (err) {
    if (!isMissingDocumentError(err)) throw err
    await storeRef.set({ data: Object.assign({ createdAt: now }, updateData) })
  }
  return { success: true, data: Object.assign({}, templates, { updatedAt: now }) }
}

exports.main = async event => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  try {
    if (event.action === 'get') return { success: true, data: await getCurrent() }
    if (event.action === 'save') return await save(openId, event.data || {})
    if (event.action === 'getTrainers') return await getTrainers(openId)
    if (event.action === 'saveTrainers') return await saveTrainers(openId, event.data || [])
    if (event.action === 'getQuestionnaireTemplates') return await getQuestionnaireTemplates()
    if (event.action === 'saveQuestionnaireTemplates') return await saveQuestionnaireTemplates(openId, event.data || {})
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
