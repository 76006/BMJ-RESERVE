const ACTIVE_STATUSES = ['visited', 'in_experience', 'completed']

const DEFAULT_30 = [
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
const DEFAULT_90 = DEFAULT_30.map(item => ({ ...item }))
  .concat([{ key: 'revisit', type: 'revisit', label: '二次体验意愿（是/否）' }])

function serviceDate(booking) {
  const timestamp = Date.parse(booking.checkInAt || '')
  if (Number.isFinite(timestamp)) {
    return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }
  return booking.visitDate || ''
}

function todayString() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function daysSince(date) {
  const start = Date.parse(date + 'T00:00:00+08:00')
  const today = Date.parse(todayString() + 'T00:00:00+08:00')
  if (!Number.isFinite(start) || !Number.isFinite(today)) return -1
  return Math.floor((today - start) / 86400000)
}

function photoCount(value) {
  return Array.isArray(value) ? value.filter(item => {
    if (typeof item === 'string') return !!item
    return !!(item && (item.path || item.fileID))
  }).length : 0
}

function formatTime(value) {
  const timestamp = Date.parse(value || '')
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const pad = number => String(number).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function scoreAverage(feedback) {
  if (!feedback) return '-'
  if (feedback.overall) return Number(feedback.overall).toFixed(1)
  const values = []
  ;(feedback.areas || []).forEach(item => { if (Number(item.score) > 0) values.push(Number(item.score)) })
  ;(feedback.experience || []).forEach(item => { if (Number(item.score) > 0) values.push(Number(item.score)) })
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '-'
}

function makeRecord(booking, mode, feedback) {
  const field = mode === '30' ? '_day30Photos' : (mode === '90' ? '_day90Photos' : '_immediatePhotos')
  const note = mode === '30' ? booking._day30FollowUp : (mode === '90' ? booking._day90FollowUp : '')
  const reminderAt = mode === '30' ? booking._reminder30SentAt : (mode === '90' ? booking._reminder90SentAt : '')
  const reminderError = mode === '30' ? booking._reminder30LastError : (mode === '90' ? booking._reminder90LastError : '')
  let normalized = feedback
  if (mode === '24h') {
    normalized = {
      therapist: [
        { label: '技术专业度', score: feedback.professional },
        { label: '服务细致度', score: feedback.attentive },
        { label: '态度与沟通', score: feedback.communication }
      ],
      experience: [
        { label: '总体满意度', score: feedback.overall },
        { label: '环境舒适度', score: feedback.environment },
        { label: '仪器舒适度', score: feedback.device },
        { label: '流程便利性', score: feedback.flow },
        { label: '愿意推荐度', score: feedback.recommend }
      ],
      remark: feedback.comment || '',
      submittedAt: feedback.submittedAt,
      updatedAt: feedback.updatedAt,
      overall: feedback.overall
    }
  }
  return {
    recordKey: `${booking.id}_${mode}`,
    recordId: booking.id,
    mode,
    customerName: booking.name || '未知客户',
    phone: booking.phone || '',
    serviceDate: serviceDate(booking),
    submittedAt: formatTime(normalized.updatedAt || normalized.submittedAt),
    sortTime: normalized.updatedAt || normalized.submittedAt || '',
    avgScore: scoreAverage(normalized),
    areas: normalized.areas || [],
    experience: normalized.experience || [],
    therapist: normalized.therapist || [],
    remark: normalized.remark || '',
    retry: normalized.retry || '',
    retryReason: normalized.retryReason || '',
    photoCount: photoCount(booking[field]),
    followupNote: note || '',
    reminderText: reminderAt ? `提醒已发送：${formatTime(reminderAt)}` : (reminderError ? `提醒失败：${reminderError}` : '')
  }
}

Page({
  data: {
    loading: true,
    currentTab: 'list',
    filterMode: 'all',
    allFeedbacks: [],
    filteredFeedbacks: [],
    fb24Count: 0,
    fb30Count: 0,
    fb90Count: 0,
    avgScore: '--',
    pendingCount: 0,
    tmpl30: DEFAULT_30,
    tmpl90: DEFAULT_90,
    questionnaireUpdatedAt: '',
    savingTemplate: false
  },

  onShow() {
    const app = getApp()
    if (!app.globalData.isAdmin) {
      wx.showModal({
        title: '无权限',
        content: '仅操作师和管理员可以访问回访问卷管理。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
    this.setData({ loading: true })
    const bookingTask = app._loadAllBookingsAsAdmin
      ? app._loadAllBookingsAsAdmin().catch(err => {
        console.warn('[回访问卷] 预约刷新失败，使用当前数据:', err)
        return app.globalData.bookings || []
      })
      : Promise.resolve(app.globalData.bookings || [])
    const templateTask = this._loadTemplates()
    Promise.all([bookingTask, templateTask]).then(() => {
      this._processData(app.globalData.bookings || [])
    }).finally(() => this.setData({ loading: false }))
  },

  _loadTemplates() {
    return wx.cloud.callFunction({
      name: 'storeService',
      data: { action: 'getQuestionnaireTemplates' }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) throw new Error(result.error || '读取问卷模板失败')
      this.setData({
        tmpl30: result.data.day30 || DEFAULT_30,
        tmpl90: result.data.day90 || DEFAULT_90,
        questionnaireUpdatedAt: result.data.updatedAt ? formatTime(result.data.updatedAt) : ''
      })
    }).catch(err => {
      console.warn('[回访问卷] 读取模板失败，显示默认模板:', err)
      this.setData({ tmpl30: DEFAULT_30, tmpl90: DEFAULT_90 })
    })
  },

  _processData(bookings) {
    const list = []
    let pendingCount = 0
    bookings.forEach(booking => {
      if (booking._serviceFeedback && booking._serviceFeedback.submittedAt) {
        list.push(makeRecord(booking, '24h', booking._serviceFeedback))
      }
      if (booking._followupFeedback30 && booking._followupFeedback30.submittedAt) {
        list.push(makeRecord(booking, '30', booking._followupFeedback30))
      }
      if (booking._followupFeedback90 && booking._followupFeedback90.submittedAt) {
        list.push(makeRecord(booking, '90', booking._followupFeedback90))
      }
      if (!ACTIVE_STATUSES.includes(booking._status)) return
      const days = daysSince(serviceDate(booking))
      if (days >= 30 && !booking._followupFeedback30) pendingCount++
      if (days >= 90 && !booking._followupFeedback90) pendingCount++
    })
    list.sort((a, b) => String(b.sortTime).localeCompare(String(a.sortTime)))
    const rated = list.map(item => Number(item.avgScore)).filter(Number.isFinite)
    this.setData({
      allFeedbacks: list,
      fb24Count: list.filter(item => item.mode === '24h').length,
      fb30Count: list.filter(item => item.mode === '30').length,
      fb90Count: list.filter(item => item.mode === '90').length,
      avgScore: rated.length ? (rated.reduce((sum, value) => sum + value, 0) / rated.length).toFixed(1) : '--',
      pendingCount
    })
    this.applyFilter()
  },

  switchTab(e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab })
  },

  setFilter(e) {
    this.setData({ filterMode: e.currentTarget.dataset.mode })
    this.applyFilter()
  },

  applyFilter() {
    const mode = this.data.filterMode
    this.setData({
      filteredFeedbacks: mode === 'all'
        ? this.data.allFeedbacks
        : this.data.allFeedbacks.filter(item => item.mode === mode)
    })
  },

  viewDetail(e) {
    const recordKey = e.currentTarget.dataset.key
    const item = this.data.filteredFeedbacks.find(row => row.recordKey === recordKey)
    if (!item) return
    const lines = [
      `回访类型：${item.mode === '24h' ? '24小时服务评价' : item.mode + '天回访'}`,
      `客户：${item.customerName}`,
      `总体均分：${item.avgScore}/5`
    ]
    item.areas.forEach(row => { if (row.score > 0) lines.push(`${row.label}：${row.score}分`) })
    item.experience.forEach(row => { if (row.score > 0) lines.push(`${row.label}：${row.score}分`) })
    item.therapist.forEach(row => { if (row.score > 0) lines.push(`${row.label}：${row.score}分`) })
    if (item.photoCount) lines.push(`阶段照片：${item.photoCount}/5张`)
    if (item.remark) lines.push(`文字反馈：${item.remark}`)
    if (item.retry) lines.push(`二次体验：${item.retry === 'yes' ? '愿意' : '暂不考虑'}`)
    if (item.retryReason) lines.push(`意愿说明：${item.retryReason}`)
    if (item.followupNote) lines.push(`工作人员回访：${item.followupNote}`)
    if (item.reminderText) lines.push(item.reminderText)
    wx.showModal({
      title: '回访详情',
      content: lines.join('\n'),
      cancelText: '关闭',
      confirmText: '客户详情',
      success: res => {
        if (res.confirm) wx.navigateTo({ url: `/pages/admin/detail/detail?id=${item.recordId}` })
      }
    })
  },

  preview30() {
    wx.navigateTo({ url: '/pages/feedback/feedback?mode=30&preview=1' })
  },

  preview90() {
    wx.navigateTo({ url: '/pages/feedback/feedback?mode=90&preview=1' })
  },

  editQuestion(e) {
    if (this.data.savingTemplate) return
    const mode = String(e.currentTarget.dataset.mode)
    const index = Number(e.currentTarget.dataset.index)
    const key = mode === '90' ? 'tmpl90' : 'tmpl30'
    const current = this.data[key][index]
    if (!current) return
    wx.showModal({
      title: '编辑问题',
      editable: true,
      placeholderText: '输入问题内容',
      content: current.label,
      success: res => {
        const label = String(res.content || '').trim()
        if (!res.confirm || !label) return
        const next30 = this.data.tmpl30.map(item => ({ ...item }))
        const next90 = this.data.tmpl90.map(item => ({ ...item }))
        ;(mode === '90' ? next90 : next30)[index].label = label
        this._saveTemplates(next30, next90)
      }
    })
  },

  _saveTemplates(day30, day90) {
    this.setData({ savingTemplate: true })
    wx.showLoading({ title: '正在保存', mask: true })
    wx.cloud.callFunction({
      name: 'storeService',
      data: {
        action: 'saveQuestionnaireTemplates',
        data: { day30, day90 }
      }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) throw new Error(result.error || '问卷保存失败')
      this.setData({
        tmpl30: result.data.day30,
        tmpl90: result.data.day90,
        questionnaireUpdatedAt: formatTime(result.data.updatedAt)
      })
      wx.showToast({ title: '问卷已保存', icon: 'success' })
    }).catch(err => wx.showToast({ title: err.message || '保存失败', icon: 'none' }))
      .finally(() => {
        wx.hideLoading()
        this.setData({ savingTemplate: false })
      })
  }
})
