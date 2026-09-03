const ANGLES = ['正脸', '左侧45°', '右侧45°', '左侧90°', '右侧90°']

Page({
  data: {
    loading: true,
    busy: false,
    uploadingIndex: -1,
    bookingId: '',
    stage: '',
    stageTitle: '',
    booking: null,
    photos: ANGLES.map((angle, index) => ({ index, angle, path: '' }))
  },

  onLoad(options) {
    const bookingId = String((options && options.id) || '').trim()
    const stage = String((options && options.stage) || '').trim()
    if (!bookingId || (stage !== '30' && stage !== '90')) {
      wx.showModal({
        title: '无法打开',
        content: '照片上传链接不完整，请从“我的预约”重新进入。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
    const stageTitle = `体验后${stage}天照片`
    wx.setNavigationBarTitle({ title: stageTitle })
    this.setData({ bookingId, stage, stageTitle })
    this.loadBooking()
  },

  loadBooking() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'bookingService',
      data: {
        action: 'getFollowupPhotoBooking',
        bookingId: this.data.bookingId,
        stage: this.data.stage
      }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) throw new Error(result.error || '读取预约失败')
      this._applyBooking(result.data)
    }).catch(err => {
      wx.showModal({
        title: '暂时无法上传',
        content: err.message || '读取预约失败，请稍后重试',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }).finally(() => this.setData({ loading: false }))
  },

  _applyBooking(booking) {
    const source = Array.isArray(booking.photos) ? booking.photos : []
    const photos = ANGLES.map((angle, index) => {
      const item = source[index]
      return {
        index,
        angle,
        path: typeof item === 'string' ? item : ((item && (item.path || item.fileID)) || '')
      }
    })
    this.setData({ booking, photos })
  },

  choosePhoto(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0 || index >= ANGLES.length) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: res => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        this._uploadAndSave(index, file.tempFilePath)
      }
    })
  },

  _uploadAndSave(index, tempFilePath) {
    const app = getApp()
    this.setData({ busy: true, uploadingIndex: index })
    wx.showLoading({ title: '上传中', mask: true })
    app.uploadImage(
      tempFilePath,
      `booking/${this.data.bookingId}/day${this.data.stage}/customer`
    ).then(fileID => {
      const photos = this.data.photos.map(item => item.path || null)
      photos[index] = {
        path: fileID,
        fileID,
        name: `${this.data.stage}天-${ANGLES[index]}`
      }
      return this._savePhotos(photos)
    }).then(data => {
      wx.hideLoading()
      this._applyBooking(data)
      wx.showToast({ title: '照片已保存', icon: 'success' })
    }).catch(err => {
      wx.hideLoading()
      wx.showToast({ title: err.message || '上传失败，请重试', icon: 'none' })
    }).finally(() => this.setData({ busy: false, uploadingIndex: -1 }))
  },

  deletePhoto(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const oldPath = this.data.photos[index] && this.data.photos[index].path
    if (!oldPath) return
    wx.showModal({
      title: '删除照片',
      content: `确定删除“${ANGLES[index]}”照片吗？`,
      confirmText: '删除',
      confirmColor: '#C94B4B',
      success: res => {
        if (!res.confirm) return
        const photos = this.data.photos.map(item => item.path || null)
        photos[index] = null
        this.setData({ busy: true })
        wx.showLoading({ title: '删除中', mask: true })
        this._savePhotos(photos).then(data => {
          wx.hideLoading()
          this._applyBooking(data)
          wx.showToast({ title: '已删除', icon: 'success' })
          if (oldPath.indexOf('cloud://') === 0) {
            wx.cloud.deleteFile({ fileList: [oldPath] }).catch(() => {})
          }
        }).catch(err => {
          wx.hideLoading()
          wx.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
        }).finally(() => this.setData({ busy: false }))
      }
    })
  },

  _savePhotos(photos) {
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: {
        action: 'saveFollowupPhotos',
        bookingId: this.data.bookingId,
        stage: this.data.stage,
        photos
      }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) throw new Error(result.error || '保存失败')
      return result.data
    })
  },

  previewPhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const current = this.data.photos[index] && this.data.photos[index].path
    if (!current) return
    const urls = this.data.photos.map(item => item.path).filter(Boolean)
    wx.previewImage({ current, urls })
  }
})
