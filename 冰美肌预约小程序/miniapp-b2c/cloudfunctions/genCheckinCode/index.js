// 云函数：生成门店签到小程序码
// 部署后通过 dashboard 的「生成门店签到码」按钮触发
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function isAdmin(openId) {
  if (!openId) return false
  const res = await db.collection('admins')
    .where({ openId, active: true })
    .limit(1)
    .get()
  return !!(res.data && res.data[0])
}

exports.main = async (event, context) => {
  event = event || {}
  const openId = cloud.getWXContext().OPENID
  if (!(await isAdmin(openId))) {
    return { success: false, error: '无管理员权限' }
  }
  console.log('[genCheckinCode] 管理员请求生成签到码')

  try {
    const bookingId = String(event.bookingId || '').trim()
    const envVersion = ['develop', 'trial', 'release'].includes(event.envVersion)
      ? event.envVersion
      : 'release'
    if (bookingId && !/^[A-Za-z0-9_-]{1,24}$/.test(bookingId)) {
      return { success: false, error: '预约编号格式不正确' }
    }
    let booking = null
    if (bookingId) {
      const bookingRes = await db.collection('bookings').where({ id: bookingId }).limit(1).get()
      booking = bookingRes.data && bookingRes.data[0]
      if (!booking) return { success: false, error: '预约不存在' }
      if (booking._status !== 'confirmed') {
        return { success: false, error: '只有已确认的预约可以生成签到码' }
      }
    }

    const scene = bookingId ? 'id=' + bookingId : 'checkin=true'
    if (scene.length > 32) {
      return { success: false, error: '预约编号过长，无法生成签到码' }
    }

    // 调用微信获取无限制数量的小程序码。
    // 直接进入签到页，避免冷启动/后台唤醒时先进入首页再跳转造成 scene 丢失。
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page: 'pages/checkin/guest/guest',
      checkPath: false,
      envVersion,
      width: 430,
      autoColor: false,
      lineColor: { r: 59, g: 7, b: 100 },  // 主色 #3B0764
      isHyaline: false
    })

    console.log('[genCheckinCode] API返回:', JSON.stringify({
      errCode: result.errCode,
      errMsg: result.errMsg,
      contentType: result.contentType,
      hasBuffer: !!result.buffer,
      bufferLength: result.buffer ? result.buffer.length : 0
    }))

    // 检查是否返回了错误（getUnlimited 失败时不 throw，而是返回 errCode）
    if (result.errCode && result.errCode !== 0) {
      console.error('[genCheckinCode] API返回错误:', result.errCode, result.errMsg)
      return {
        success: false,
        error: `微信接口错误(${result.errCode}): ${result.errMsg || '生成失败'}`
      }
    }

    // 检查 buffer 是否存在
    if (!result.buffer || result.buffer.length === 0) {
      console.error('[genCheckinCode] buffer为空')
      return {
        success: false,
        error: '生成的小程序码数据为空，请确保小程序已注册并有有效AppID'
      }
    }

    // 上传到云存储
    const timestamp = Date.now()
    const codeName = bookingId ? `booking_${bookingId}` : 'store'
    const cloudPath = `checkin-code/${codeName}_${envVersion}_${timestamp}.png`
    console.log('[genCheckinCode] 上传到云存储:', cloudPath)

    const uploadResult = await cloud.uploadFile({
      cloudPath,
      fileContent: result.buffer
    })

    console.log('[genCheckinCode] 上传成功:', uploadResult.fileID)

    // 获取临时下载链接
    const fileResult = await cloud.getTempFileURL({
      fileList: [uploadResult.fileID]
    })

    const tempUrl = (fileResult.fileList && fileResult.fileList.length > 0) ? fileResult.fileList[0].tempFileURL : ''
    if (!tempUrl) {
      return { success: false, error: '获取下载链接失败' }
    }
    console.log('[genCheckinCode] 临时URL:', tempUrl)

    return {
      success: true,
      codeUrl: tempUrl,
      fileID: uploadResult.fileID,
      cloudPath,
      bookingId,
      envVersion
    }
  } catch (err) {
    console.error('[genCheckinCode] 异常:', err)
    return {
      success: false,
      error: err.errMsg || err.message || '生成失败，请检查云函数日志'
    }
  }
}
