// 每天检查已到30天/90天的体验记录，并发送一次照片上传提醒。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DAY30_TEMPLATE_ID = 'nV6Oc0UnmsGkZbpcBXBcUPRpkRzR4B__uX5TU_M9xUo'
const DAY90_TEMPLATE_ID = 'j7okEfYaR9VoT0M3Lt2T79tUjWinkC_1CjEMmfCpkSw'
const ACTIVE_STATUSES = new Set(['visited', 'in_experience', 'completed'])
const DAY_MS = 24 * 60 * 60 * 1000
const REMINDER_RETRY_DAYS = 30

function clip(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength)
}

function chinaDateString(value) {
  const timestamp = value == null ? Date.now() : Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function serviceDate(booking) {
  return chinaDateString(booking.checkInAt) || clip(booking.visitDate, 10)
}

function daysSinceService(booking) {
  const base = Date.parse(serviceDate(booking) + 'T00:00:00+08:00')
  const today = Date.parse(chinaDateString() + 'T00:00:00+08:00')
  if (!Number.isFinite(base) || !Number.isFinite(today)) return -1
  return Math.floor((today - base) / DAY_MS)
}

function serviceTime(booking) {
  if (booking.checkInAt && Number.isFinite(Date.parse(booking.checkInAt))) {
    return new Date(Date.parse(booking.checkInAt) + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')
  }
  let start = clip(booking.visitTime, 20).split('-')[0].trim()
  if (/^\d{1,2}:\d{2}$/.test(start)) start += ':00'
  return `${clip(booking.visitDate, 10)} ${start || '09:00:00'}`
}

function reminderConfig(booking, stage) {
  const page = `pages/feedback/feedback?recordId=${encodeURIComponent(booking.id || '')}&mode=${stage}`
  if (stage === 30) {
    return {
      templateId: DAY30_TEMPLATE_ID,
      page,
      data: {
        thing1: { value: clip(booking.name || '体验客户', 20) },
        thing12: { value: clip('请上传体验后30天五角度照片', 20) },
        time13: { value: serviceTime(booking) }
      },
      sentField: '_reminder30SentAt',
      errorField: '_reminder30LastError'
    }
  }
  return {
    templateId: DAY90_TEMPLATE_ID,
    page,
    data: {
      thing1: { value: clip('冰美肌护理体验', 20) },
      thing2: { value: clip(booking.storeName || '冰美肌', 20) },
      thing4: { value: clip('请上传体验后90天五角度照片', 20) }
    },
    sentField: '_reminder90SentAt',
    errorField: '_reminder90LastError'
  }
}

async function loadAllBookings() {
  const output = []
  let lastId = ''
  while (true) {
    let query = db.collection('bookings')
    if (lastId) query = query.where({ _id: _.gt(lastId) })
    const res = await query.orderBy('_id', 'asc').limit(100).get()
    const rows = res.data || []
    output.push(...rows)
    if (rows.length < 100) break
    lastId = rows[rows.length - 1]._id
    if (!lastId) break
  }
  return output
}

async function sendOne(booking, stage) {
  const config = reminderConfig(booking, stage)
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: booking._openid || booking._creatorOpenId,
      templateId: config.templateId,
      page: config.page,
      miniprogramState: process.env.MINIPROGRAM_STATE || 'formal',
      lang: 'zh_CN',
      data: config.data
    })
    await db.collection('bookings').doc(booking._id).update({
      data: {
        [config.sentField]: new Date().toISOString(),
        [config.errorField]: ''
      }
    })
    return { sent: true }
  } catch (err) {
    const reason = clip(err.errMsg || err.message || '发送失败', 200)
    await db.collection('bookings').doc(booking._id).update({
      data: { [config.errorField]: reason }
    }).catch(() => {})
    return { sent: false, reason }
  }
}

exports.main = async () => {
  const bookings = await loadAllBookings()
  const summary = { checked: bookings.length, sent30: 0, sent90: 0, failed: 0 }

  for (const booking of bookings) {
    const recipient = booking._openid || booking._creatorOpenId
    // 工作人员本人也可能作为顾客预约，不能仅因其同时具备管理员身份就跳过提醒。
    if (!recipient || !ACTIVE_STATUSES.has(booking._status)) continue
    const days = daysSinceService(booking)
    const jobs = []
    // 到期后保留30天重试窗口，兼顾偶发失败和订阅授权补充，不无限重复请求。
    if (days >= 30 && days < 30 + REMINDER_RETRY_DAYS && !booking._reminder30SentAt) jobs.push(30)
    if (days >= 90 && days < 90 + REMINDER_RETRY_DAYS && !booking._reminder90SentAt) jobs.push(90)

    for (const stage of jobs) {
      const result = await sendOne(booking, stage)
      if (result.sent) summary[stage === 30 ? 'sent30' : 'sent90'] += 1
      else summary.failed += 1
    }
  }

  console.log('[回访提醒]', summary)
  return { success: true, ...summary }
}
