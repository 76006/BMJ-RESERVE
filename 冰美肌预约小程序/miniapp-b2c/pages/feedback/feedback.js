const ANGLES = ['正脸', '左侧45°', '右侧45°', '左侧90°', '右侧90°']

const DEFAULT_TEMPLATES = {
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
  ]
}
DEFAULT_TEMPLATES.day90 = DEFAULT_TEMPLATES.day30
  .map(item => Object.assign({}, item))
  .concat([{ key: 'revisit', type: 'revisit', label: '二次体验意愿（是/否）' }])

const SERVICE_GROUP_CONFIG = [
  {
    title: '总体评价',
    items: [
      { key: 'overall', label: '本次服务总体满意度' },
      { key: 'recommend', label: '愿意推荐给朋友' }
    ]
  },
  {
    title: '操作师服务',
    items: [
      { key: 'professional', label: '专业程度' },
      { key: 'attentive', label: '服务细致度' },
      { key: 'communication', label: '态度与沟通' }
    ]
  },
  {
    title: '体验过程',
    items: [
      { key: 'environment', label: '环境舒适度' },
      { key: 'flow', label: '流程便利度' },
      { key: 'device', label: '仪器舒适度' }
    ]
  }
]

function buildServiceGroups(feedback) {
  const source = feedback || {}
  return SERVICE_GROUP_CONFIG.map(group => ({
    title: group.title,
    items: group.items.map(item => ({ ...item, score: Number(source[item.key]) || 0 }))
  }))
}

function deleteCloudFile(fileID) {
  const value = String(fileID || '')
  if (!value.startsWith('cloud://')) return
  wx.cloud.deleteFile({ fileList: [value] }).catch(err => {
    console.warn('[回访问卷] 云文件删除失败:', err)
  })
}

Page({
  data: {
    loading: true,
    submitting: false,
    uploadingIndex: -1,
    recordId: '',
    mode: 'service',
    modeLabel: '体验后服务评价',
    isPreview: false,
    booking: null,
    serviceGroups: buildServiceGroups(null),
    areas: [],
    experience: [],
    photos: ANGLES.map((angle, index) => ({ index, angle, path: '' })),
    remark: '',
    retry: '',
    retryReason: '',
    textLabel: '文字反馈（客户填写感受）',
    retryLabel: '二次体验意愿（是/否）',
    hasSubmitted: false
  },

  onLoad(options) {
    options = options || {}
    const requestedMode = String(options.mode || '')
    const mode = requestedMode === '30' || requestedMode === '90' ? requestedMode : 'service'
    const recordId = String(options.recordId || options.id || '').trim()
    const isPreview = options.preview === '1'
    this.setData({
      recordId,
      mode,
      isPreview,
      modeLabel: mode === 'service' ? '体验后服务评价' : `体验后${mode}天回访`
    })
    if (!recordId && !isPreview) {
      wx.showModal({
        title: '无法打开',
        content: '问卷链接不完整，请从“我的预约”重新进入。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
    if (mode === 'service') this._loadServiceFeedback()
    else this._loadFollowupFeedback()
  },

  _loadTemplates() {
    return wx.cloud.callFunction({
      name: 'storeService',
      data: { action: 'getQuestionnaireTemplates' }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) throw new Error(result.error || '读取问卷模板失败')
      return result.data
    }).catch(err => {
      console.warn('[回访问卷] 云端模板读取失败，使用默认模板:', err)
      return DEFAULT_TEMPLATES
    })
  },

  _loadServiceFeedback() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'getServiceFeedback', bookingId: this.data.recordId }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) throw new Error(result.error || '读取评价失败')
      const feedback = result.data.feedback || null
      this.setData({
        booking: result.data,
        serviceGroups: buildServiceGroups(feedback),
        remark: feedback ? feedback.comment || '' : '',
        hasSubmitted: !!(feedback && feedback.submittedAt)
      })
    }).catch(err => this._showLoadError(err))
      .finally(() => this.setData({ loading: false }))
  },

  _loadFollowupFeedback() {
    this.setData({ loading: true })
    const bookingTask = this.data.isPreview
      ? Promise.resolve({ feedback: null, photos: [] })
      : wx.cloud.callFunction({
        name: 'bookingService',
        data: {
          action: 'getFollowupQuestionnaire',
          bookingId: this.data.recordId,
          mode: this.data.mode
        }
      }).then(res => {
        const result = res.result || {}
        if (!result.success || !result.data) throw new Error(result.error || '读取回访问卷失败')
        return result.data
      })

    Promise.all([this._loadTemplates(), bookingTask]).then(([templates, booking]) => {
      const template = this.data.mode === '90' ? templates.day90 : templates.day30
      const feedback = booking.feedback || null
      const savedAreas = {}
      const savedExperience = {}
      ;((feedback && feedback.areas) || []).forEach(item => { savedAreas[item.key] = item.score })
      ;((feedback && feedback.experience) || []).forEach(item => { savedExperience[item.key] = item.score })
      const areas = template.filter(item => item.type === 'area').map(item => ({
        key: item.key, label: item.label, score: Number(savedAreas[item.key]) || 0
      }))
      const experience = template.filter(item => item.type === 'experience').map(item => ({
        key: item.key, label: item.label, score: Number(savedExperience[item.key]) || 0
      }))
      const textItem = template.find(item => item.type === 'text')
      const revisitItem = template.find(item => item.type === 'revisit')
      const sourcePhotos = Array.isArray(booking.photos) ? booking.photos : []
      const photos = ANGLES.map((angle, index) => {
        const item = sourcePhotos[index]
        return {
          index,
          angle,
          path: typeof item === 'string' ? item : ((item && (item.path || item.fileID)) || '')
        }
      })
      this.setData({
        booking,
        areas,
        experience,
        photos,
        remark: feedback ? feedback.remark || '' : '',
        retry: feedback ? feedback.retry || '' : '',
        retryReason: feedback ? feedback.retryReason || '' : '',
        textLabel: textItem ? textItem.label : '文字反馈（客户填写感受）',
        retryLabel: revisitItem ? revisitItem.label : '二次体验意愿（是/否）',
        hasSubmitted: !!(feedback && feedback.submittedAt)
      })
    }).catch(err => this._showLoadError(err))
      .finally(() => this.setData({ loading: false }))
  },

  _showLoadError(err) {
    wx.showModal({
      title: '暂时无法打开',
      content: err.message || '读取问卷失败，请稍后重试',
      showCancel: false,
      success: () => wx.navigateBack()
    })
  },

  onServiceRate(e) {
    const key = String(e.currentTarget.dataset.key || '')
    const score = Number(e.currentTarget.dataset.score)
    this.setData({
      serviceGroups: this.data.serviceGroups.map(group => ({
        ...group,
        items: group.items.map(item => item.key === key ? { ...item, score } : item)
      }))
    })
  },

  onRate(e) {
    const key = String(e.currentTarget.dataset.key || '')
    const score = Number(e.currentTarget.dataset.score)
    this.setData({ areas: this.data.areas.map(item => item.key === key ? { ...item, score } : item) })
  },

  onExperienceRate(e) {
    const key = String(e.currentTarget.dataset.key || '')
    const score = Number(e.currentTarget.dataset.score)
    this.setData({ experience: this.data.experience.map(item => item.key === key ? { ...item, score } : item) })
  },

  onRemark(e) { this.setData({ remark: e.detail.value }) },
  onRetry(e) { this.setData({ retry: e.currentTarget.dataset.value }) },
  onRetryReason(e) { this.setData({ retryReason: e.detail.value }) },

  choosePhoto(e) {
    if (this.data.isPreview) {
      wx.showToast({ title: '预览模式不上传照片', icon: 'none' })
      return
    }
    if (this.data.uploadingIndex >= 0) return
    const index = Number(e.currentTarget.dataset.index)
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: res => {
        const file = res.tempFiles && res.tempFiles[0]
        if (file && file.tempFilePath) this._uploadPhoto(index, file.tempFilePath)
      }
    })
  },

  _uploadPhoto(index, tempFilePath) {
    const app = getApp()
    let uploadedFileID = ''
    let saved = false
    this.setData({ uploadingIndex: index })
    wx.showLoading({ title: '上传中', mask: true })
    app.uploadImage(tempFilePath, `booking/${this.data.recordId}/day${this.data.mode}/customer`)
      .then(fileID => {
        uploadedFileID = fileID
        const photos = this.data.photos.map(item => item.path || null)
        photos[index] = { path: fileID, fileID, name: `${this.data.mode}天-${ANGLES[index]}` }
        return this._savePhotos(photos)
      })
      .then(data => {
        saved = true
        this._applySavedPhotos(data.photos)
        wx.showToast({ title: '照片已保存', icon: 'success' })
      })
      .catch(err => {
        if (!saved && uploadedFileID) deleteCloudFile(uploadedFileID)
        wx.showToast({ title: err.message || '上传失败，请重试', icon: 'none' })
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ uploadingIndex: -1 })
      })
  },

  deletePhoto(e) {
    if (this.data.isPreview || this.data.uploadingIndex >= 0) return
    const index = Number(e.currentTarget.dataset.index)
    const current = this.data.photos[index]
    if (!current || !current.path) return
    wx.showModal({
      title: '删除照片',
      content: `确定删除“${ANGLES[index]}”照片吗？`,
      confirmText: '删除',
      confirmColor: '#C94B4B',
      success: res => {
        if (!res.confirm) return
        const photos = this.data.photos.map(item => item.path || null)
        photos[index] = null
        this.setData({ uploadingIndex: index })
        wx.showLoading({ title: '删除中', mask: true })
        this._savePhotos(photos)
          .then(data => {
            this._applySavedPhotos(data.photos)
            wx.showToast({ title: '已删除', icon: 'success' })
          })
          .catch(err => wx.showToast({ title: err.message || '删除失败', icon: 'none' }))
          .finally(() => {
            wx.hideLoading()
            this.setData({ uploadingIndex: -1 })
          })
      }
    })
  },

  previewPhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const current = this.data.photos[index] && this.data.photos[index].path
    if (!current) return
    wx.previewImage({ current, urls: this.data.photos.map(item => item.path).filter(Boolean) })
  },

  _savePhotos(photos) {
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: {
        action: 'saveFollowupPhotos',
        bookingId: this.data.recordId,
        stage: this.data.mode,
        photos
      }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) throw new Error(result.error || '保存照片失败')
      return result.data
    })
  },

  _applySavedPhotos(source) {
    const rows = Array.isArray(source) ? source : []
    this.setData({
      photos: ANGLES.map((angle, index) => {
        const item = rows[index]
        return { index, angle, path: typeof item === 'string' ? item : ((item && (item.path || item.fileID)) || '') }
      })
    })
  },

  submitFeedback() {
    if (this.data.isPreview) {
      wx.showToast({ title: '预览模式，不会真正提交', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    if (this.data.mode === 'service') this._submitServiceFeedback()
    else this._submitFollowupFeedback()
  },

  _submitServiceFeedback() {
    const feedback = { comment: this.data.remark }
    let missing = false
    this.data.serviceGroups.forEach(group => group.items.forEach(item => {
      feedback[item.key] = Number(item.score) || 0
      if (!item.score) missing = true
    }))
    if (missing) {
      wx.showToast({ title: '请完成所有评分', icon: 'none' })
      return
    }
    this._sendFeedback('saveServiceFeedback', feedback)
  },

  _submitFollowupFeedback() {
    if (!this.data.areas.some(item => item.score > 0)) {
      wx.showToast({ title: '请至少评价一个改善部位', icon: 'none' })
      return
    }
    if (this.data.mode === '90' && !this.data.retry) {
      wx.showToast({ title: '请选择二次体验意愿', icon: 'none' })
      return
    }
    this._sendFeedback('saveFollowupQuestionnaire', {
      areas: this.data.areas,
      experience: this.data.experience,
      remark: this.data.remark,
      retry: this.data.retry,
      retryReason: this.data.retryReason
    })
  },

  _sendFeedback(action, feedback) {
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在提交', mask: true })
    wx.cloud.callFunction({
      name: 'bookingService',
      data: {
        action,
        bookingId: this.data.recordId,
        mode: this.data.mode,
        feedback
      }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) throw new Error(result.error || '提交失败')
      const saved = result.data.feedback
      const app = getApp()
      const local = app.getBookingById && app.getBookingById(this.data.recordId)
      if (local) {
        if (this.data.mode === 'service') local._serviceFeedback = saved
        else local[this.data.mode === '90' ? '_followupFeedback90' : '_followupFeedback30'] = saved
        if (app._saveLocal) app._saveLocal()
      }
      this.setData({ hasSubmitted: true })
      wx.showModal({
        title: '感谢您的反馈',
        content: '问卷已提交，之后仍可以进入本页修改。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }).catch(err => wx.showToast({ title: err.message || '提交失败，请重试', icon: 'none' }))
      .finally(() => {
        wx.hideLoading()
        this.setData({ submitting: false })
      })
  }
})
