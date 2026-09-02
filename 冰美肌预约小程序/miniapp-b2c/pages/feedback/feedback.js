const AREA_CONFIG = [
  { key: 'nasolabial', label: '法令纹淡化' },
  { key: 'forehead', label: '抬头纹淡化' },
  { key: 'marionette', label: '木偶纹淡化' },
  { key: 'skintone', label: '肤色改善' },
  { key: 'applemuscle', label: '苹果肌上移' },
  { key: 'jawline', label: '下颌线清晰' }
]

const EXPERIENCE_CONFIG = [
  { key: 'environment', label: '环境舒适度' },
  { key: 'quiet', label: '室内安静度' },
  { key: 'device', label: '仪器舒适度' },
  { key: 'flow', label: '流程便利性' },
  { key: 'recommend', label: '愿意推荐度' }
]

const THERAPIST_CONFIG = [
  { key: 'professional', label: '技术专业度' },
  { key: 'attentive', label: '服务细致度' },
  { key: 'communication', label: '态度与沟通' }
]

Page({
  data: {
    recordId: '',
    mode: '30',
    modeLabel: '体验后30天回访',
    areas: AREA_CONFIG.map(a => ({ ...a, score: 0 })),
    experience: EXPERIENCE_CONFIG.map(e => ({ ...e, score: 0 })),
    therapist: THERAPIST_CONFIG.map(t => ({ ...t, score: 0 })),
    photos: [],
    remark: '',
    retry: '',
    retryReason: '',
    isPreview: false
  },

  onLoad(options) {
    const mode = options.mode || '30'
    const isPreview = options.preview === '1'
    const list = wx.getStorageSync('feedbacks') || []
    const existing = list.find(f => f.recordId === options.recordId && f.mode === mode)

    const modeLabelMap = {
      '24h': '体验后24小时回访',
      '30': '体验后30天回访',
      '90': '体验后90天回访'
    }

    this.setData({
      recordId: options.recordId || '',
      mode,
      modeLabel: modeLabelMap[mode] || '回访问卷',
      areas: existing ? existing.areas : AREA_CONFIG.map(a => ({ ...a, score: 0 })),
      experience: existing ? existing.experience : EXPERIENCE_CONFIG.map(e => ({ ...e, score: 0 })),
      therapist: existing ? existing.therapist : THERAPIST_CONFIG.map(t => ({ ...t, score: 0 })),
      photos: existing ? existing.photos : [],
      remark: existing ? existing.remark : '',
      retry: existing ? existing.retry : '',
      retryReason: existing ? existing.retryReason : '',
      isPreview: isPreview
    })
  },

  onRate(e) {
    const { key, score } = e.currentTarget.dataset
    const areas = this.data.areas.map(a => a.key === key ? { ...a, score } : a)
    this.setData({ areas })
  },

  onTherapistRate(e) {
    const { key, score } = e.currentTarget.dataset
    const therapist = this.data.therapist.map(t => t.key === key ? { ...t, score } : t)
    this.setData({ therapist })
  },

  onExperienceRate(e) {
    const { key, score } = e.currentTarget.dataset
    const experience = this.data.experience.map(item => item.key === key ? { ...item, score } : item)
    this.setData({ experience })
  },

  addPhoto() {
    const remaining = 3 - this.data.photos.length
    if (remaining <= 0) return
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const newPaths = res.tempFiles.map(f => f.tempFilePath)
        this.setData({ photos: [...this.data.photos, ...newPaths] })
      }
    })
  },

  delPhoto(e) {
    const idx = e.currentTarget.dataset.idx
    const photos = this.data.photos.filter((_, i) => i !== idx)
    this.setData({ photos })
  },

  onRemark(e) { this.setData({ remark: e.detail.value }) },
  onRetry(e) { this.setData({ retry: e.currentTarget.dataset.v }) },
  onRetryReason(e) { this.setData({ retryReason: e.detail.value }) },

  _getOpenId(app) {
    return new Promise(resolve => app.getOpenId(openid => resolve(openid || '')))
  },

  _saveCloudFeedback(feedback) {
    const db = wx.cloud.database()
    if (!db) return Promise.reject(new Error('云数据库未初始化'))
    return db.collection('feedbacks')
      .where({
        recordId: feedback.recordId,
        mode: feedback.mode,
        _creatorOpenId: feedback._creatorOpenId
      })
      .limit(1)
      .get()
      .then(res => {
        const existing = res.data && res.data[0]
        if (existing && existing._id) {
          return db.collection('feedbacks').doc(existing._id).update({ data: feedback })
        }
        return db.collection('feedbacks').add({ data: feedback })
      })
  },

  submitFeedback() {
    if (this.data.isPreview) {
      wx.showToast({ title: '预览模式，不会真正提交', icon: 'none' })
      return
    }
    const rated = this.data.areas.filter(a => a.score > 0).length
    if (rated === 0) {
      wx.showToast({ title: '请至少评价一个部位', icon: 'none' })
      return
    }
    if (this.data.mode === '90' && !this.data.retry) {
      wx.showToast({ title: '请选择二次体验意愿', icon: 'none' })
      return
    }
    const app = getApp()
    if (this._submitting) return
    this._submitting = true
    wx.showLoading({ title: '正在提交', mask: true })
    const photoFolder = `feedback/${this.data.recordId}/${this.data.mode}`

    Promise.all(this.data.photos.map(path => app.uploadImage(path, photoFolder)))
      .then(photos => this._getOpenId(app).then(openid => ({ photos, openid })))
      .then(({ photos, openid }) => {
        if (!openid) throw new Error('无法识别当前微信用户')
        const feedback = {
          recordId: this.data.recordId,
          mode: this.data.mode,
          areas: this.data.areas,
          experience: this.data.experience,
          therapist: this.data.therapist,
          photos,
          remark: this.data.remark,
          retry: this.data.retry,
          retryReason: this.data.retryReason,
          submittedAt: new Date().toISOString(),
          _creatorOpenId: openid
        }
        return this._saveCloudFeedback(feedback)
          .then(() => app.markFeedbackDone(this.data.recordId, this.data.mode))
          .then(() => feedback)
      })
      .then(feedback => {
        const list = wx.getStorageSync('feedbacks') || []
        const idx = list.findIndex(f => f.recordId === feedback.recordId && f.mode === feedback.mode)
        if (idx >= 0) list[idx] = feedback
        else list.push(feedback)
        wx.setStorageSync('feedbacks', list)
        this.setData({ photos: feedback.photos })
        wx.showToast({ title: '感谢反馈！', icon: 'success', duration: 1500 })
        setTimeout(() => wx.navigateBack(), 1500)
      })
      .catch(err => {
        console.error('[回访问卷] 提交失败:', err)
        wx.showToast({ title: err.message || '提交失败，请重试', icon: 'none' })
      })
      .finally(() => {
        this._submitting = false
        wx.hideLoading()
      })
  }
})
