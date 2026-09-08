const cloud = require('wx-server-sdk')
const archiver = require('archiver')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_BOOKINGS = 200
const MAX_PHOTOS = 600
const MAX_RAW_PHOTO_BYTES = 200 * 1024 * 1024
const DOWNLOAD_BATCH_SIZE = 5
const ANGLES = ['正脸', '左侧45度', '右侧45度', '左侧90度', '右侧90度']
const PHOTO_GROUPS = [
  { title: '体验前', field: '_beforePhotos' },
  { title: '体验后立即', field: '_immediatePhotos' },
  { title: '30天', field: '_day30Photos' },
  { title: '90天', field: '_day90Photos' }
]
const STATUS_MAP = {
  pending_confirm: '新预约',
  confirmed: '已预约',
  visited: '已到店',
  in_experience: '体验中',
  completed: '已体验',
  cancelled: '已取消',
  rejected: '已拒绝',
  expired: '已过期',
  no_show: '未到店'
}
const CHANNEL_MAP = { direct: '直接', medical: '医疗', beauty: '生美' }

function effectiveStatus(booking) {
  if (!booking || booking._status !== 'pending_confirm') return booking && booking._status
  const date = String(booking.visitDate || '')
  const match = String(booking.visitTime || '').match(/^(\d{1,2}):(\d{2})/)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match) return booking._status
  const startAt = Date.parse(`${date}T${match[1].padStart(2, '0')}:${match[2]}:00+08:00`)
  return Number.isFinite(startAt) && startAt <= Date.now() ? 'expired' : booking._status
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength)
}

function safePart(value, fallback) {
  const text = cleanText(value, 80)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
  return text || fallback
}

function csvCell(value) {
  const text = String(value == null ? '' : value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function makeCsv(headers, rows) {
  return '\uFEFF' + [headers, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n')
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

async function getAdmin(openId) {
  if (!openId) return null
  const res = await db.collection('admins')
    .where({ openId, active: true })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

function bookingIdOf(booking) {
  return cleanText(booking.id || booking._id, 50)
}

function photoValue(item) {
  if (!item) return ''
  return cleanText(typeof item === 'string' ? item : (item.fileID || item.path), 600)
}

function normalizedPhotoGroups(booking) {
  let before = Array.isArray(booking._beforePhotos) ? [...booking._beforePhotos] : []
  if (!before.some(Boolean)) {
    const legacy = Array.isArray(booking._photos) ? booking._photos : []
    const fronts = Array.isArray(booking._beforeFrontPhotos) ? booking._beforeFrontPhotos : []
    const sides = Array.isArray(booking._beforeSidePhotos) ? booking._beforeSidePhotos : []
    before = [fronts[0] || legacy[0], sides[0] || legacy[1], legacy[2], legacy[3], legacy[4]]
  }
  let immediate = Array.isArray(booking._immediatePhotos) ? [...booking._immediatePhotos] : []
  if (!immediate.some(Boolean) && Array.isArray(booking._afterPhotos)) immediate = [...booking._afterPhotos]

  return [
    { title: '体验前', photos: before },
    { title: '体验后立即', photos: immediate },
    { title: '30天', photos: Array.isArray(booking._day30Photos) ? booking._day30Photos : [] },
    { title: '90天', photos: Array.isArray(booking._day90Photos) ? booking._day90Photos : [] }
  ]
}

function extensionFor(fileID) {
  const clean = String(fileID || '').split('?')[0]
  const matched = clean.match(/\.([A-Za-z0-9]{2,5})$/)
  return matched ? matched[1].toLowerCase() : 'jpg'
}

function bookingFolder(booking) {
  return [
    safePart(booking.visitDate, '未填写日期'),
    safePart(booking.name, '未填写姓名'),
    safePart(bookingIdOf(booking), '无编号')
  ].join('_')
}

function collectPhotoJobs(bookings) {
  const jobs = []
  bookings.forEach(booking => {
    const root = `客户照片/${bookingFolder(booking)}`
    normalizedPhotoGroups(booking).forEach(group => {
      ANGLES.forEach((angle, index) => {
        const fileID = photoValue(group.photos[index])
        if (!fileID) return
        jobs.push({
          fileID,
          archivePath: `${root}/${group.title}/${index + 1}_${angle}.${extensionFor(fileID)}`,
          kind: 'photo'
        })
      })
    })
    const signatureImage = photoValue(booking.consentSignImage)
    if (signatureImage) {
      jobs.push({
        fileID: signatureImage,
        archivePath: `${root}/知情同意书/手写签名.${extensionFor(signatureImage)}`,
        kind: 'signature'
      })
    }
  })
  return jobs
}

function buildTable(bookings) {
  const photoHeaders = []
  PHOTO_GROUPS.forEach(group => ANGLES.forEach(angle => photoHeaders.push(`${group.title}-${angle}`)))
  const headers = [
    'ID', '姓名', '性别', '年龄', '身份证号', '手机号', '体验日期', '时间段',
    '过往美容护理经历', '重点改善需求', '来源渠道', '培训师', '状态', '确认人',
    '签到时间', '设备型号', '客户负责人', '累计能量', '发数分配', '最高档位',
    '产品优化意见', 'Day30回访', 'Day90回访', '内部备注', '签署人', '签署时间', '手写签名',
    '创建时间', '更新时间', ...photoHeaders
  ]
  const rows = bookings.map(booking => {
    const root = `客户照片/${bookingFolder(booking)}`
    const photoPaths = []
    normalizedPhotoGroups(booking).forEach(group => {
      ANGLES.forEach((angle, index) => {
        const fileID = photoValue(group.photos[index])
        photoPaths.push(fileID ? `${root}/${group.title}/${index + 1}_${angle}.${extensionFor(fileID)}` : '')
      })
    })
    return [
      bookingIdOf(booking), booking.name, booking.gender, booking.age, booking.idCard || '', booking.phone,
      booking.visitDate, booking.visitTime || '', booking.medicalHistory || '', booking.needs || '',
      CHANNEL_MAP[booking.channel] || booking.channel || '', booking.trainerName || '',
      STATUS_MAP[effectiveStatus(booking)] || effectiveStatus(booking) || '', booking._confirmedBy || '',
      booking.checkInAt || '', booking.deviceModel || '', booking._clientManager || '',
      booking._totalEnergy || '', booking._shotDistribution || '', booking._maxLevel || '',
      booking._productFeedback || '', booking._day30FollowUp || '', booking._day90FollowUp || '',
      booking._adminNote || '', booking.consentSignName || '', booking.consentSignTime || '',
      booking.consentSignImage ? `${root}/知情同意书/手写签名.${extensionFor(booking.consentSignImage)}` : '',
      booking.createdAt || '', booking.updatedAt || '', ...photoPaths
    ]
  })
  return { headers, rows }
}

async function findSingleBooking(bookingId) {
  const byId = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
  if (byId.data && byId.data[0]) return byId.data[0]
  try {
    const byDocId = await db.collection('bookings').doc(bookingId).get()
    return byDocId && byDocId.data ? byDocId.data : null
  } catch (err) {
    return null
  }
}

async function listBookings(startDate, endDate) {
  let query = db.collection('bookings')
  if (startDate || endDate) {
    let condition
    if (startDate && endDate) condition = _.gte(startDate).and(_.lte(endDate))
    else condition = startDate ? _.gte(startDate) : _.lte(endDate)
    query = query.where({ visitDate: condition })
  }

  const all = []
  while (all.length <= MAX_BOOKINGS) {
    const limit = Math.min(100, MAX_BOOKINGS + 1 - all.length)
    const res = await query.skip(all.length).limit(limit).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < limit) break
  }
  if (all.length > MAX_BOOKINGS) {
    throw new Error(`当前范围超过${MAX_BOOKINGS}位客户，请缩小日期范围后分批导出`)
  }
  return all.sort((a, b) => {
    const dateCompare = String(a.visitDate || '').localeCompare(String(b.visitDate || ''))
    if (dateCompare) return dateCompare
    return String(a.visitTime || '').localeCompare(String(b.visitTime || ''))
  })
}

async function loadBookings(event) {
  const bookingId = cleanText(event.bookingId, 50)
  if (bookingId) {
    const booking = await findSingleBooking(bookingId)
    if (!booking) throw new Error('客户预约记录不存在')
    return [booking]
  }

  const startDate = cleanText(event.startDate, 10)
  const endDate = cleanText(event.endDate, 10)
  if (startDate && !isValidDate(startDate)) throw new Error('开始日期格式不正确')
  if (endDate && !isValidDate(endDate)) throw new Error('结束日期格式不正确')
  if (startDate && endDate && startDate > endDate) throw new Error('开始日期不能晚于结束日期')
  return listBookings(startDate, endDate)
}

function chinaTimestamp() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
}

async function createArchive(bookings) {
  if (!bookings.length) throw new Error('所选日期范围内没有客户记录')
  const jobs = collectPhotoJobs(bookings)
  if (jobs.length > MAX_PHOTOS) {
    throw new Error(`当前范围共有${jobs.length}个图片文件，每次最多导出${MAX_PHOTOS}个，请缩小日期范围`)
  }

  const token = crypto.randomBytes(8).toString('hex')
  const tempPath = path.join(os.tmpdir(), `booking_export_${token}.zip`)
  const output = fs.createWriteStream(tempPath)
  // JPG/HEIC 等照片通常已经过相机编码；ZIP只负责归档，不改变原图内容。
  const archive = archiver('zip', { store: true })
  const completed = new Promise((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
  })
  archive.pipe(output)

  const table = buildTable(bookings)
  archive.append(Buffer.from(makeCsv(table.headers, table.rows), 'utf8'), { name: '客户预约明细.csv' })

  let addedPhotoCount = 0
  let addedSignatureCount = 0
  let rawBytes = 0
  const failed = []
  let failedPhotoCount = 0
  let failedSignatureCount = 0
  try {
    for (let offset = 0; offset < jobs.length; offset += DOWNLOAD_BATCH_SIZE) {
      const batch = jobs.slice(offset, offset + DOWNLOAD_BATCH_SIZE)
      const downloaded = await Promise.all(batch.map(async job => {
        if (!job.fileID.startsWith('cloud://')) {
          return { job, error: '不是云存储文件' }
        }
        try {
          const result = await cloud.downloadFile({ fileID: job.fileID })
          const content = result && result.fileContent
          if (!content || !content.length) throw new Error('文件内容为空')
          return { job, content }
        } catch (err) {
          return { job, error: cleanText(err.message || '下载失败', 120) }
        }
      }))

      const batchBytes = downloaded.reduce((sum, item) => sum + (item.content ? item.content.length : 0), 0)
      if (rawBytes + batchBytes > MAX_RAW_PHOTO_BYTES) {
        throw new Error('图片文件总大小超过200MB，请缩小日期范围后分批导出')
      }
      rawBytes += batchBytes
      downloaded.forEach(item => {
        if (item.error) {
          failed.push(`${item.job.archivePath}：${item.error}`)
          if (item.job.kind === 'signature') failedSignatureCount += 1
          else failedPhotoCount += 1
          return
        }
        archive.append(item.content, { name: item.job.archivePath })
        if (item.job.kind === 'signature') addedSignatureCount += 1
        else addedPhotoCount += 1
      })
    }

    if (failed.length) {
      archive.append(Buffer.from('\uFEFF' + failed.join('\r\n'), 'utf8'), { name: '未能导出的图片文件.txt' })
    }
    await archive.finalize()
    await completed

    const cloudPath = `exports/booking_export_${token}.zip`
    const uploaded = await cloud.uploadFile({
      cloudPath,
      fileContent: fs.createReadStream(tempPath)
    })
    const singleName = bookings.length === 1 ? `_${safePart(bookings[0].name, '客户')}` : ''
    return {
      fileID: uploaded.fileID,
      fileName: `冰美肌客户资料${singleName}_${chinaTimestamp()}.zip`,
      bookingCount: bookings.length,
      photoCount: addedPhotoCount,
      signatureCount: addedSignatureCount,
      failedPhotoCount,
      failedSignatureCount
    }
  } catch (err) {
    try { archive.abort() } catch (abortErr) { /* 忽略中止异常 */ }
    throw err
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch (err) { /* 临时文件由运行环境兜底清理 */ }
  }
}

function isExportArchive(fileID) {
  return /^cloud:\/\/[^/]+\/exports\/booking_export_[A-Za-z0-9_-]+\.zip$/.test(String(fileID || ''))
}

exports.main = async event => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  try {
    if (!(await getAdmin(openId))) return { success: false, error: '无管理员权限' }

    if (event.action === 'cleanup') {
      if (!isExportArchive(event.fileID)) return { success: false, error: '导出文件地址无效' }
      await cloud.deleteFile({ fileList: [event.fileID] })
      return { success: true }
    }

    if (event.action !== 'create') return { success: false, error: '不支持的操作' }
    const bookings = await loadBookings(event)
    const result = await createArchive(bookings)
    return { success: true, ...result }
  } catch (err) {
    console.error('[exportBookingArchive] 导出失败:', err)
    return { success: false, error: err.message || '资料包生成失败' }
  }
}
