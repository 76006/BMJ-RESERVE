const DEFAULT_LINE_COLOR = '#1F2937'

function canvasSize(page) {
  return {
    width: Number(page.data.signatureCanvasWidth) || 320,
    height: Number(page.data.signatureCanvasHeight) || 160
  }
}

function pointFromEvent(event) {
  const touch = event && event.touches && event.touches[0]
  if (!touch) return null
  const x = Number(touch.x != null ? touch.x : touch.clientX)
  const y = Number(touch.y != null ? touch.y : touch.clientY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function setup(page, canvasId) {
  if (!page || !canvasId) return
  const size = canvasSize(page)
  const context = wx.createCanvasContext(canvasId, page)
  page._signatureCanvasId = canvasId
  page._signatureContext = context
  page._signatureLastPoint = null
  page._signatureDistance = 0
  context.setFillStyle('#FFFFFF')
  context.fillRect(0, 0, size.width, size.height)
  context.draw(false)
  page.setData({ signatureHasInk: false })
}

function touchStart(page, event) {
  const point = pointFromEvent(event)
  if (!point) return
  if (!page._signatureContext) setup(page, page._signatureCanvasId || 'signatureCanvas')
  page._signatureLastPoint = point

  // 轻点也应留下笔迹，避免只点一下却被判定为空签名。
  const context = page._signatureContext
  context.beginPath()
  context.setStrokeStyle(DEFAULT_LINE_COLOR)
  context.setLineWidth(3)
  context.setLineCap('round')
  context.setLineJoin('round')
  context.moveTo(point.x, point.y)
  context.lineTo(point.x + 0.2, point.y + 0.2)
  context.stroke()
  context.draw(true)
}

function touchMove(page, event) {
  const point = pointFromEvent(event)
  const last = page._signatureLastPoint
  const context = page._signatureContext
  if (!point || !last || !context) return

  context.beginPath()
  context.setStrokeStyle(DEFAULT_LINE_COLOR)
  context.setLineWidth(3)
  context.setLineCap('round')
  context.setLineJoin('round')
  context.moveTo(last.x, last.y)
  context.lineTo(point.x, point.y)
  context.stroke()
  context.draw(true)
  const dx = point.x - last.x
  const dy = point.y - last.y
  page._signatureDistance = Number(page._signatureDistance || 0) + Math.sqrt(dx * dx + dy * dy)
  if (!page.data.signatureHasInk && page._signatureDistance >= 12) {
    page.setData({ signatureHasInk: true })
  }
  page._signatureLastPoint = point
}

function touchEnd(page) {
  page._signatureLastPoint = null
}

function clear(page) {
  setup(page, page._signatureCanvasId || 'signatureCanvas')
}

function toTempFilePath(page) {
  if (!page || !page.data.signatureHasInk) {
    return Promise.reject(new Error('请先在签名框内手写签名'))
  }
  const canvasId = page._signatureCanvasId || 'signatureCanvas'
  const size = canvasSize(page)
  let pixelRatio = 2
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    pixelRatio = Math.max(1, Math.min(Number(info.pixelRatio) || 2, 3))
  } catch (err) {
    // 无法取得设备像素比时使用2倍导出，仍能保证签名清晰。
  }

  return new Promise((resolve, reject) => {
    // 等待最后一次 draw 落盘，再导出完整笔迹。
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvasId,
        fileType: 'png',
        quality: 1,
        destWidth: Math.round(size.width * pixelRatio),
        destHeight: Math.round(size.height * pixelRatio),
        success: result => result && result.tempFilePath
          ? resolve(result.tempFilePath)
          : reject(new Error('签名图片生成失败')),
        fail: err => reject(new Error((err && err.errMsg) || '签名图片生成失败'))
      }, page)
    }, 80)
  })
}

module.exports = {
  setup,
  touchStart,
  touchMove,
  touchEnd,
  clear,
  toTempFilePath
}
