function safeFileName(name) {
  return String(name || 'export')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 120)
}

function csvCell(value) {
  const text = String(value == null ? '' : value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function buildCsv(headers, rows) {
  const lines = [headers, ...(rows || [])].map(row => (row || []).map(csvCell).join(','))
  // BOM 让 Windows Excel 直接打开时正确识别中文。
  return '\uFEFF' + lines.join('\r\n')
}

function writeTextFile(fileName, content) {
  const name = safeFileName(fileName)
  const filePath = `${wx.env.USER_DATA_PATH}/${name}`
  const fs = wx.getFileSystemManager()
  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: String(content || ''),
      encoding: 'utf8',
      success: () => resolve({ filePath, fileName: name }),
      fail: reject
    })
  })
}

function downloadCloudFile(fileID, fileName) {
  return wx.cloud.downloadFile({ fileID }).then(res => {
    if (!res || !res.tempFilePath) throw new Error('导出文件下载失败')
    return { filePath: res.tempFilePath, fileName: safeFileName(fileName) }
  })
}

function shareFile(filePath, fileName) {
  if (typeof wx.shareFileMessage !== 'function') {
    return Promise.reject(new Error('当前微信版本不支持发送文件，请升级微信后重试'))
  }
  return new Promise((resolve, reject) => {
    wx.shareFileMessage({
      filePath,
      fileName: safeFileName(fileName),
      success: resolve,
      fail: reject
    })
  })
}

function isCancelled(error) {
  const message = String((error && (error.errMsg || error.message)) || '').toLowerCase()
  return message.includes('cancel')
}

function friendlyError(error, fallback) {
  const message = String((error && (error.errMsg || error.message)) || '')
  if (/user TAP gesture|only be invoked by user/i.test(message)) {
    return '文件已经生成，请直接点击页面上的“发送已生成文件”按钮。'
  }
  if (/-504003|FUNCTIONS_TIME_LIMIT_EXCEEDED|timed out/i.test(message)) {
    return '照片资料整理超时。请确认 exportBookingArchive 云函数的超时时间已设置为60秒，然后缩小日期范围重试。'
  }
  if (/FUNCTION_NOT_FOUND|not found|不存在/i.test(message) && /function|云函数/i.test(message)) {
    return '照片导出云函数尚未部署，请先部署 exportBookingArchive。'
  }
  return message || fallback || '导出失败，请重试'
}

function removeLocalFile(filePath) {
  const value = String(filePath || '')
  if (!value || !value.startsWith(wx.env.USER_DATA_PATH + '/')) return
  wx.getFileSystemManager().unlink({
    filePath: value,
    fail: () => {}
  })
}

module.exports = {
  buildCsv,
  writeTextFile,
  downloadCloudFile,
  shareFile,
  isCancelled,
  friendlyError,
  removeLocalFile,
  safeFileName
}
