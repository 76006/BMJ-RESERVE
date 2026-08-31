// 云函数：生成门店签到小程序码
// 部署后通过 dashboard 的「生成门店签到码」按钮触发
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  console.log('[genCheckinCode] 开始生成签到码, event:', JSON.stringify(event))

  try {
    // 调用微信获取无限制数量的小程序码
    // 注意：不传 page 参数，默认进入小程序首页（app.js 检测 scene 后跳转签到页）
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: 'checkin=true',
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
    const cloudPath = `checkin-code/checkin_${timestamp}.png`
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
      cloudPath
    }
  } catch (err) {
    console.error('[genCheckinCode] 异常:', err)
    return {
      success: false,
      error: err.errMsg || err.message || '生成失败，请检查云函数日志'
    }
  }
}
