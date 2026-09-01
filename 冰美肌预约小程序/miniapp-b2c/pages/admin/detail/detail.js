Page({
  data: {
    booking: null,
    isEditingNote: false,
    editNote: '',
    isEditingFollowUp: false,
    newFollowUp: '',
    showStatusPicker: false,
    statusOptions: [],
    showCancelModal: false,
    cancelReason: '',
    isEditingStaff: false,
    editStaff: {},
    scoreRange: [1, 2, 3, 4, 5],
    // 二维码
    showQRModal: false,
    qrCodeUrl: '',
    qrCodeFileID: '',
    qrSize: 240
  },

  onLoad(options) {
    const app = getApp()
    if (!app.globalData.isAdmin) {
      wx.navigateBack()
      return
    }
    this._bookingId = options.id
    this._refreshBooking()
  },

  onShow() {
    // 从checkin/consent返回后刷新数据
    if (this._bookingId) this._refreshBooking()
  },

  _refreshBooking() {
    const app = getApp()
    const booking = app.getBookingById(this._bookingId)
    if (!booking) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      wx.navigateBack()
      return
    }
    // 兼容旧数据：补初始化黄色字段
    const defaults = {
      _clientManager: '', _totalEnergy: '', _shotDistribution: '', _maxLevel: '',
      _immediateSatisfaction: 0, _comfortSatisfaction: 0,
      _photos: [], _beforePhotos: [], _halfPhotos: [], _afterPhotos: [],
      _productFeedback: '',
      _day1FollowUp: '', _day30FollowUp: '', _day90FollowUp: '',
      _followUpRecords: []
    }
    Object.keys(defaults).forEach(k => {
      if (!(k in booking)) booking[k] = defaults[k]
    })
    // 预格式化日期（WXML 无法直接调用 Page 方法）
    booking._createdAtDisplay = this._fmtTime(booking.createdAt)
    booking.consentSignTimeDisplay = booking.consentSignTime ? this._fmtTime(booking.consentSignTime) : ''
    booking._checkInDisplay = booking.checkInAt ? this._fmtTime(booking.checkInAt) : ''
    booking._followUpRecordsDisplay = (booking._followUpRecords || []).map(r => ({
      ...r,
      dateDisplay: this._fmtTime(r.date)
    }))
    this.setData({
      booking,
      editNote: booking._adminNote || '',
      statusOptions: this._getStatusOptions(booking._status)
    })
    this.loadFeedback()
  },

  _getStatusOptions(status) {
    const options = {
      // 新预约使用“确认/拒绝”专用按钮，确保通知和操作记录完整。
      pending_confirm: [],
      // 已预约只能取消；到店状态必须由签到流程产生。
      confirmed: ['cancelled'],
      visited: ['in_experience'],
      in_experience: ['completed'],
      completed: [],
      cancelled: [],
      rejected: []
    }
    return options[status] || []
  },

  loadFeedback() {
    const feedbacks = wx.getStorageSync('feedbacks') || []
    const f30 = feedbacks.find(f => f.recordId === this.data.booking.id && f.mode === '30')
    const f90 = feedbacks.find(f => f.recordId === this.data.booking.id && f.mode === '90')
    const f24 = feedbacks.find(f => f.recordId === this.data.booking.id && f.mode === '24h')
    const data = {}
    if (f30) {
      data.feedback30 = {
        ...f30,
        areaList: f30.areas || [],
        experienceList: f30.experience || [],
        submittedAtDisplay: this._fmtTime(f30.submittedAt)
      }
    }
    if (f90) {
      data.feedback90 = {
        ...f90,
        areaList: f90.areas || [],
        experienceList: f90.experience || [],
        submittedAtDisplay: this._fmtTime(f90.submittedAt)
      }
    }
    if (f24) {
      data.feedback24 = {
        ...f24,
        areaList: f24.areas || [],
        experienceList: f24.experience || [],
        therapistList: f24.therapist || [],
        submittedAtDisplay: this._fmtTime(f24.submittedAt)
      }
    }
    if (f30 || f90 || f24) this.setData(data)
  },

  previewCompPhoto(e) {
    const { idx, type } = e.currentTarget.dataset
    const key = type === 'before' ? '_beforePhotos' : type === 'half' ? '_halfPhotos' : '_afterPhotos'
    const photos = this.data.booking[key] || []
    if (photos[idx]) {
      wx.previewImage({ current: photos[idx].path, urls: photos.map(p => p.path) })
    }
  },

  previewFbPhoto(e) {
    const { type, idx } = e.currentTarget.dataset
    const fb = type === 'feedback30' ? this.data.feedback30 : this.data.feedback90
    if (fb && fb.photos) {
      wx.previewImage({ current: fb.photos[idx], urls: fb.photos })
    }
  },

  // ===== 状态操作 =====
  openStatusPicker() {
    if (!this.data.statusOptions.length) {
      wx.showToast({ title: '请使用当前页面的流程按钮操作', icon: 'none' })
      return
    }
    this.setData({ showStatusPicker: true })
  },
  closeStatusPicker() { this.setData({ showStatusPicker: false }) },

  changeStatus(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'cancelled') {
      // 取消预约：弹窗输入原因
      this.setData({ showStatusPicker: false, showCancelModal: true, cancelReason: '' })
      return
    }
    const app = getApp()
    const ok = app.updateBookingStatus(this.data.booking.id, key)
    if (!ok) {
      wx.showToast({ title: '不允许跳过或回退状态', icon: 'none' })
      this.setData({ showStatusPicker: false })
      return
    }
    this._refreshBooking()
    this.setData({ showStatusPicker: false })
  },

  onCancelReasonInput(e) { this.setData({ cancelReason: e.detail.value }) },

  confirmCancel() {
    const reason = (this.data.cancelReason || '').trim()
    if (!reason) { wx.showToast({ title: '请填写取消原因', icon: 'none' }); return }
    if (this._submitting) return
    this._submitting = true
    const app = getApp()
    const ok = app.cancelBooking(this.data.booking.id, reason)
    if (!ok) {
      wx.showToast({ title: '当前状态不可取消', icon: 'none' })
      this.setData({ showCancelModal: false, cancelReason: '' })
      this._submitting = false
      return
    }
    this.setData({
      booking: app.getBookingById(this.data.booking.id),
      showCancelModal: false,
      cancelReason: ''
    })
    wx.showToast({ title: '已取消', icon: 'success' })
    this._submitting = false
  },

  closeCancelModal() { this.setData({ showCancelModal: false, cancelReason: '' }) },

  // ===== 内部备注 =====
  startEditNote() { this.setData({ isEditingNote: true }) },
  cancelEditNote() { this.setData({ isEditingNote: false, editNote: this.data.booking._adminNote || '' }) },
  saveNote() {
    const app = getApp()
    app.updateAdminNote(this.data.booking.id, this.data.editNote)
    this.setData({ booking: app.getBookingById(this.data.booking.id), isEditingNote: false })
    wx.showToast({ title: '已保存', icon: 'success' })
  },
  onNoteInput(e) { this.setData({ editNote: e.detail.value }) },

  // ===== 跟进记录 =====
  startEditFollowUp() { this.setData({ isEditingFollowUp: true, newFollowUp: '' }) },
  cancelEditFollowUp() { this.setData({ isEditingFollowUp: false }) },
  saveFollowUp() {
    if (!this.data.newFollowUp.trim()) return
    const app = getApp()
    app.addFollowUpRecord(this.data.booking.id, this.data.newFollowUp.trim())
    this.setData({ booking: app.getBookingById(this.data.booking.id), isEditingFollowUp: false, newFollowUp: '' })
    wx.showToast({ title: '已添加', icon: 'success' })
  },
  onFollowUpInput(e) { this.setData({ newFollowUp: e.detail.value }) },

  // ===== 工作人员补录（黄色字段） =====
  startEditStaff() {
    const b = this.data.booking
    this.setData({
      isEditingStaff: true,
      editStaff: {
        _clientManager: b._clientManager || '',
        _totalEnergy: b._totalEnergy || '',
        _shotDistribution: b._shotDistribution || '',
        _maxLevel: b._maxLevel || '',
        deviceModel: b.deviceModel || '',
        _immediateSatisfaction: b._immediateSatisfaction || 0,
        _comfortSatisfaction: b._comfortSatisfaction || 0,
        _productFeedback: b._productFeedback || '',
        _day1FollowUp: b._day1FollowUp || '',
        _day30FollowUp: b._day30FollowUp || '',
        _day90FollowUp: b._day90FollowUp || '',
        _photos: [...(b._photos || [])],
        _beforePhotos: [...(b._beforePhotos || [])],
        _halfPhotos: [...(b._halfPhotos || [])],
        _afterPhotos: [...(b._afterPhotos || [])]
      }
    })
  },
  cancelEditStaff() { this.setData({ isEditingStaff: false }) },
  saveStaff() {
    if (this._submitting) return
    this._submitting = true
    const app = getApp()
    const ed = this.data.editStaff
    const booking = this.data.booking
    // 检查体验参数是否为空
    const hasData = ed._clientManager || ed._totalEnergy || ed._shotDistribution || ed._maxLevel || ed.deviceModel || ed._productFeedback
    if (!hasData && booking._status === 'visited') {
      wx.showModal({
        title: '提醒',
        content: '体验参数尚未填写，确认保存吗？',
        confirmText: '确认保存',
        cancelText: '继续填写',
        success: (res) => {
          if (res.confirm) {
            this._doSaveStaff(app, ed, booking)
          } else {
            this._submitting = false
          }
        }
      })
      return
    }
    this._doSaveStaff(app, ed, booking)
  },

  _doSaveStaff(app, ed, booking) {
    app.updateStaffData(this.data.booking.id, {
      _clientManager: ed._clientManager,
      _totalEnergy: ed._totalEnergy,
      _shotDistribution: ed._shotDistribution,
      _maxLevel: ed._maxLevel,
      deviceModel: ed.deviceModel,
      _immediateSatisfaction: ed._immediateSatisfaction,
      _comfortSatisfaction: ed._comfortSatisfaction,
      _productFeedback: ed._productFeedback,
      _day1FollowUp: ed._day1FollowUp,
      _day30FollowUp: ed._day30FollowUp,
      _day90FollowUp: ed._day90FollowUp,
      _photos: ed._photos,
      _beforePhotos: ed._beforePhotos,
      _halfPhotos: ed._halfPhotos,
      _afterPhotos: ed._afterPhotos
    })
    // 自动切换状态：体验中 → 已体验
    if (booking._status === 'in_experience') {
      app.updateBookingStatus(booking.id, 'completed')
    }
    this.setData({
      booking: app.getBookingById(this.data.booking.id),
      isEditingStaff: false
    })
    wx.showToast({ title: '已保存', icon: 'success' })
    this._submitting = false
  },
  onStaffField(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`editStaff.${key}`]: e.detail.value })
  },
  onStaffSatisfaction(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`editStaff.${key}`]: Number(e.detail.value) + 1 })
  },

  // ===== 三栏分类照片上传 =====
  chooseCompPhoto(e) {
    const type = e.currentTarget.dataset.type
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const photo = { path: res.tempFiles[0].tempFilePath, name: `photo_${Date.now()}.jpg` }
        this.setData({ [`editStaff._${type}Photos`]: [photo] })
      }
    })
  },

  delCompPhoto(e) {
    const type = e.currentTarget.dataset.type
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这张照片吗？',
      success: (res) => {
        if (res.confirm) this.setData({ [`editStaff._${type}Photos`]: [] })
      }
    })
  },

  // ===== 照片上传 =====
  startUploadPhoto() {
    const booking = this.data.booking
    // 体验中：仅体验前+半侧脸；已体验：全部三种
    const isInExp = booking._status === 'in_experience'
    const itemList = isInExp ? ['体验前', '半侧脸对比'] : ['体验前', '半侧脸对比', '体验后']
    wx.showActionSheet({
      itemList: itemList,
      success: (res) => {
        const types = isInExp ? ['before', 'half'] : ['before', 'half', 'after']
        const type = types[res.tapIndex]
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: (res) => {
            const photo = { path: res.tempFiles[0].tempFilePath, name: `photo_${Date.now()}.jpg` }
            const app = getApp()
            const key = `_${type}Photos`
            const currentPhotos = booking[key] || []
            app.updateStaffData(booking.id, { [key]: [...currentPhotos, photo] })
            this._refreshBooking()
            wx.showToast({ title: '上传成功', icon: 'success' })
          }
        })
      }
    })
  },

  previewPhoto(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const urls = this.data.booking._photos.map(p => p.path)
    wx.previewImage({ current: urls[idx], urls })
  },

  deletePhoto(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const app = getApp()
    app.removePhoto(this.data.booking.id, idx)
    this.setData({
      booking: app.getBookingById(this.data.booking.id),
      'editStaff._photos': this.data.booking._photos
    })
  },

  // ===== 拨号 =====
  callPhone() {
    if (this.data.booking && this.data.booking.phone) {
      wx.makePhoneCall({ phoneNumber: this.data.booking.phone })
    }
  },

  // ===== 格式化（内部使用，WXML 不可调用） =====
  _fmtTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  // ===== 切体验中 =====
  switchToInExperience() {
    const app = getApp()
    const booking = this.data.booking
    if (!booking) return
    if (booking._status !== 'visited') {
      wx.showToast({ title: '当前状态不支持此操作', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认开始体验',
      content: '确定要开始体验吗？开始后将可以填写体验参数记录。',
      confirmText: '开始体验',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          app.updateBookingStatus(booking.id, 'in_experience')
          this._refreshBooking()
          wx.showToast({ title: '状态已更新', icon: 'success' })
        }
      }
    })
  },

  // 快捷确认预约
  quickConfirm() {
    const booking = this.data.booking
    const id = booking.id
    const app = getApp()
    // 检查时段冲突
    const conflicts = app.checkScheduleConflict(id, booking.visitDate, booking.visitTime)
    if (conflicts.length > 0) {
      const names = conflicts.map(c => c.name).join('、')
      wx.showModal({
        title: '时段冲突',
        content: `该时段已被 ${names} 预约，是否仍要确认？`,
        confirmText: '仍要确认',
        cancelText: '取消',
        confirmColor: '#DC2626',
        success: (res) => {
          if (res.confirm) {
            app.confirmBooking(id, '管理员')
            app.globalData._needRefresh = true
            wx.showToast({ title: '已确认预约', icon: 'success' })
            this._refreshBooking()
          }
        }
      })
      return
    }
    wx.showModal({
      title: '确认预约',
      content: '确认该用户的预约时间？',
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          app.confirmBooking(id, '管理员')
          app.globalData._needRefresh = true
          wx.showToast({ title: '已确认预约', icon: 'success' })
          this._refreshBooking()
        }
      }
    })
  },

  // 快捷拒绝预约
  quickReject() {
    const booking = this.data.booking
    const id = booking.id
    const app = getApp()
    wx.showModal({
      title: '拒绝该预约',
      content: '确认拒绝后，用户将收到“预约失败”通知。可填写拒绝原因（选填）：',
      editable: true,
      placeholderText: '如：该时段已约满',
      confirmText: '确认拒绝',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const ok = app.rejectBooking(id, (res.content || '').trim())
          if (ok) {
            app.globalData._needRefresh = true
            wx.showToast({ title: '已拒绝', icon: 'none' })
            this._refreshBooking()
          } else {
            wx.showToast({ title: '当前状态不可拒绝', icon: 'none' })
          }
        }
      }
    })
  },

  // 前往现场签到
  goCheckIn() {
    const id = this.data.booking.id
    wx.navigateTo({ url: `/pages/admin/checkin/checkin?id=${id}` })
  },

  rebook() {
    const id = this.data.booking.id
    wx.showModal({
      title: '重新预约',
      content: '将基于该客户信息创建一条新预约记录',
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.rebook(id, (newId) => {
            if (newId) {
              wx.showToast({ title: '已创建新预约', icon: 'success' })
              app.globalData._needRefresh = true
              this._refreshBooking()
            }
          })
        }
      }
    })
  },

  // ===== 签到二维码 =====
  genQRCode() {
    const booking = this.data.booking
    if (!booking) return
    let envVersion = 'release'
    try {
      const account = wx.getAccountInfoSync()
      envVersion = account && account.miniProgram && account.miniProgram.envVersion
        ? account.miniProgram.envVersion
        : 'release'
    } catch (e) { /* 使用正式版兜底 */ }

    wx.showLoading({ title: '生成签到码...', mask: true })
    wx.cloud.callFunction({
      name: 'genCheckinCode',
      data: { bookingId: booking.id, envVersion },
      timeout: 20000
    }).then(res => {
      wx.hideLoading()
      const result = res.result || {}
      if (!result.success || !result.codeUrl) {
        wx.showModal({
          title: '生成失败',
          content: result.error || '未能生成签到码，请重试',
          showCancel: false
        })
        return
      }
      this.setData({
        showQRModal: true,
        qrCodeUrl: result.codeUrl,
        qrCodeFileID: result.fileID || ''
      })
    }).catch(err => {
      wx.hideLoading()
      console.error('[签到码] 生成失败:', err)
      wx.showToast({ title: '签到码生成失败，请重试', icon: 'none' })
    })
  },

  previewQRCode() {
    const url = this.data.qrCodeFileID || this.data.qrCodeUrl
    if (url) wx.previewImage({ urls: [url] })
  },

  closeQRModal() {
    this.setData({ showQRModal: false })
  },

  stop() {
    // 用于 catchtouchmove，阻止 QR 弹窗滚动穿透到页面
  },

  simCheckIn() {
    const id = this.data.booking.id
    this.setData({ showQRModal: false })
    wx.navigateTo({ url: '/pages/checkin/guest/guest?id=' + id })
  }
})
