function deleteCloudFile(fileID) {
  if (!fileID) return
  wx.cloud.deleteFile({ fileList: [fileID] }).catch(err => {
    console.warn('[照片清理] 云文件删除失败:', err)
  })
}

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
    photoGroups: [],
    staffNotify: null,
    followupReminderIssues: [],
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
    if (!this._bookingId) return
    const app = getApp()
    // 从签到/同意书返回时先显示本地更新，再同步其他设备产生的云端变化。
    this._refreshBooking()
    const refreshSeq = (this._refreshSeq || 0) + 1
    this._refreshSeq = refreshSeq
    if (app._loadAllBookingsAsAdmin) {
      app._loadAllBookingsAsAdmin().then(() => {
        if (refreshSeq !== this._refreshSeq || !app.globalData.isAdmin) return
        this._refreshBooking()
      })
    }
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
      _photos: [], _beforePhotos: [], _beforeFrontPhotos: [], _beforeSidePhotos: [],
      _immediatePhotos: [], _day30Photos: [], _day90Photos: [],
      _productFeedback: '',
      _day30FollowUp: '', _day90FollowUp: '',
      _followUpRecords: []
    }
    Object.keys(defaults).forEach(k => {
      if (!(k in booking)) booking[k] = defaults[k]
    })
    ;['_photos', '_beforePhotos', '_beforeFrontPhotos', '_beforeSidePhotos',
      '_immediatePhotos', '_day30Photos', '_day90Photos'].forEach(key => {
      if (!Array.isArray(booking[key])) booking[key] = []
    })
    // 兼容旧版照片字段，统一迁移到“体验前”五角度数组。
    if (!booking._beforePhotos.some(photo => !!photo)) {
      const legacy = Array.isArray(booking._photos) ? booking._photos : []
      booking._beforePhotos = [
        booking._beforeFrontPhotos[0] || legacy[0] || null,
        booking._beforeSidePhotos[0] || legacy[1] || null,
        legacy[2] || null,
        legacy[3] || null,
        legacy[4] || null
      ]
    }
    // 旧测试数据中的“体验后”照片自动显示到新的“体验后立即”位置。
    if (booking._immediatePhotos.length === 0 && Array.isArray(booking._afterPhotos)) {
      booking._immediatePhotos = booking._afterPhotos
    }
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
      photoGroups: this._buildPhotoGroups(booking),
      staffNotify: this._buildStaffNotifyView(booking),
      followupReminderIssues: this._buildFollowupReminderIssues(booking),
      editNote: booking._adminNote || '',
      statusOptions: this._getStatusOptions(booking._status)
    })
  },

  _buildStaffNotifyView(booking) {
    const status = booking._staffNotifyStatus || 'unknown'
    const labels = {
      sent: '已通知操作师',
      failed: '发送失败',
      not_configured: '未配置企业微信',
      pending: '正在发送',
      unknown: '历史预约未记录'
    }
    return {
      status,
      label: labels[status] || labels.unknown,
      error: booking._staffNotifyError || '',
      updatedAt: this._fmtTime(booking._staffNotifyUpdatedAt || booking._staffNotifiedAt),
      canRetry: status !== 'sent'
    }
  },

  _buildFollowupReminderIssues(booking) {
    const issues = []
    if (!booking._reminder30SentAt && booking._reminder30LastError) {
      issues.push({ stage: '30天', error: booking._reminder30LastError })
    }
    if (!booking._reminder90SentAt && booking._reminder90LastError) {
      issues.push({ stage: '90天', error: booking._reminder90LastError })
    }
    return issues
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

  _runBookingAction(action, successTitle, onSuccess) {
    if (this._actionPending) return
    this._actionPending = true
    wx.showLoading({ title: '处理中', mask: true })
    Promise.resolve()
      .then(action)
      .then(result => {
        wx.hideLoading()
        if (onSuccess) onSuccess(result)
        else this._refreshBooking()
        if (successTitle) wx.showToast({ title: successTitle, icon: 'none' })
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '操作失败，请重试', icon: 'none' })
      })
      .finally(() => {
        this._actionPending = false
      })
  },

  previewCompPhoto(e) {
    const { idx, type } = e.currentTarget.dataset
    const key = this._comparePhotoField(type)
    if (!key) return
    const photos = this.data.booking[key] || []
    if (photos[idx]) {
      const current = typeof photos[idx] === 'string' ? photos[idx] : photos[idx].path
      const urls = photos
        .map(p => typeof p === 'string' ? p : ((p && p.path) || ''))
        .filter(path => !!path)
      wx.previewImage({ current, urls })
    }
  },

  _comparePhotoField(type) {
    const fields = {
      before: '_beforePhotos',
      immediate: '_immediatePhotos',
      day30: '_day30Photos',
      day90: '_day90Photos'
    }
    return fields[type] || ''
  },

  _buildPhotoGroups(booking) {
    const angles = ['正脸', '左侧45°', '右侧45°', '左侧90°', '右侧90°']
    const groups = [
      { type: 'before', title: '体验前', field: '_beforePhotos' },
      { type: 'immediate', title: '体验后立即', field: '_immediatePhotos' },
      { type: 'day30', title: '体验后30天', field: '_day30Photos' },
      { type: 'day90', title: '体验后90天', field: '_day90Photos' }
    ]
    return groups.map(group => {
      const values = Array.isArray(booking[group.field]) ? booking[group.field] : []
      return {
        type: group.type,
        title: group.title,
        items: angles.map((angle, index) => {
          const value = values[index]
          return {
            index,
            angle,
            path: typeof value === 'string' ? value : ((value && value.path) || '')
          }
        })
      }
    })
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
    this.setData({ showStatusPicker: false })
    const app = getApp()
    this._runBookingAction(
      () => app.updateBookingStatus(this.data.booking.id, key),
      '状态已更新'
    )
  },

  onCancelReasonInput(e) { this.setData({ cancelReason: e.detail.value }) },

  confirmCancel() {
    const reason = (this.data.cancelReason || '').trim()
    if (!reason) { wx.showToast({ title: '请填写取消原因', icon: 'none' }); return }
    const app = getApp()
    this._runBookingAction(
      () => app.cancelBooking(this.data.booking.id, reason),
      '已取消',
      () => {
        this.setData({ showCancelModal: false, cancelReason: '' })
        this._refreshBooking()
      }
    )
  },

  closeCancelModal() { this.setData({ showCancelModal: false, cancelReason: '' }) },

  retryStaffNotify() {
    const booking = this.data.booking
    const app = getApp()
    if (!booking || !app.retryStaffNotification) return
    this._runBookingAction(
      () => app.retryStaffNotification(booking.id),
      '',
      result => {
        this._refreshBooking()
        wx.showToast({
          title: result.sent ? '通知已发送' : '发送失败，请检查配置',
          icon: 'none'
        })
      }
    )
  },

  // ===== 内部备注 =====
  startEditNote() { this.setData({ isEditingNote: true }) },
  cancelEditNote() { this.setData({ isEditingNote: false, editNote: this.data.booking._adminNote || '' }) },
  saveNote() {
    const app = getApp()
    this._runBookingAction(
      () => app.updateAdminNote(this.data.booking.id, this.data.editNote),
      '已保存',
      () => {
        this.setData({ isEditingNote: false })
        this._refreshBooking()
      }
    )
  },
  onNoteInput(e) { this.setData({ editNote: e.detail.value }) },

  // ===== 跟进记录 =====
  startEditFollowUp() { this.setData({ isEditingFollowUp: true, newFollowUp: '' }) },
  cancelEditFollowUp() { this.setData({ isEditingFollowUp: false }) },
  saveFollowUp() {
    if (!this.data.newFollowUp.trim()) return
    const app = getApp()
    this._runBookingAction(
      () => app.addFollowUpRecord(this.data.booking.id, this.data.newFollowUp.trim()),
      '已添加',
      () => {
        this.setData({ isEditingFollowUp: false, newFollowUp: '' })
        this._refreshBooking()
      }
    )
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
        _day30FollowUp: b._day30FollowUp || '',
        _day90FollowUp: b._day90FollowUp || ''
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
    wx.showLoading({ title: '正在保存', mask: true })
    app.updateStaffData(this.data.booking.id, {
      _clientManager: ed._clientManager,
      _totalEnergy: ed._totalEnergy,
      _shotDistribution: ed._shotDistribution,
      _maxLevel: ed._maxLevel,
      deviceModel: ed.deviceModel,
      _immediateSatisfaction: ed._immediateSatisfaction,
      _comfortSatisfaction: ed._comfortSatisfaction,
      _productFeedback: ed._productFeedback,
      _day30FollowUp: ed._day30FollowUp,
      _day90FollowUp: ed._day90FollowUp,
      _status: booking._status === 'in_experience' ? 'completed' : undefined
    })
      .then(() => {
        this.setData({ isEditingStaff: false })
        this._refreshBooking()
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch(err => {
        wx.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
      })
      .finally(() => {
        wx.hideLoading()
        this._submitting = false
      })
  },
  onStaffField(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`editStaff.${key}`]: e.detail.value })
  },
  onStaffSatisfaction(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`editStaff.${key}`]: Number(e.detail.value) + 1 })
  },

  // ===== 20个固定照片位：4个时间点 × 5个拍摄角度 =====
  chooseComparePhoto(e) {
    const type = e.currentTarget.dataset.type
    const index = Number(e.currentTarget.dataset.idx)
    const key = this._comparePhotoField(type)
    if (!key || !Number.isInteger(index) || index < 0 || index > 4 || this._actionPending) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const photo = { path: res.tempFiles[0].tempFilePath, name: `photo_${Date.now()}.jpg` }
        const app = getApp()
        const photos = Array.isArray(this.data.booking[key]) ? [...this.data.booking[key]] : []
        while (photos.length < 5) photos.push(null)
        let uploadedFileID = ''
        let saveCompleted = false
        this._runBookingAction(
          () => app.uploadImage(photo.path, `booking/${this.data.booking.id}/${type}`)
            .then(fileID => {
              uploadedFileID = fileID
              photos[index] = { ...photo, path: fileID, fileID }
              return app.updateStaffData(this.data.booking.id, { [key]: photos })
            })
            .then(result => {
              saveCompleted = true
              return result
            })
            .catch(err => {
              if (!saveCompleted && uploadedFileID) deleteCloudFile(uploadedFileID)
              throw err
            }),
          '上传成功'
        )
      }
    })
  },

  deleteComparePhoto(e) {
    const type = e.currentTarget.dataset.type
    const index = Number(e.currentTarget.dataset.idx)
    const key = this._comparePhotoField(type)
    if (!key || !Number.isInteger(index) || index < 0 || index > 4) return
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这张照片吗？',
      success: (res) => {
        if (!res.confirm) return
        const app = getApp()
        const photos = Array.isArray(this.data.booking[key]) ? [...this.data.booking[key]] : []
        while (photos.length < 5) photos.push(null)
        photos[index] = null
        this._runBookingAction(
          () => app.updateStaffData(this.data.booking.id, { [key]: photos }),
          '已删除'
        )
      }
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
          this._runBookingAction(
            () => app.updateBookingStatus(booking.id, 'in_experience'),
            '状态已更新'
          )
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
            this._runBookingAction(
              () => app.confirmBooking(id, '管理员'),
              '已确认预约',
              () => {
                app.globalData._needRefresh = true
                this._refreshBooking()
              }
            )
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
          this._runBookingAction(
            () => app.confirmBooking(id, '管理员'),
            '已确认预约',
            () => {
              app.globalData._needRefresh = true
              this._refreshBooking()
            }
          )
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
          this._runBookingAction(
            () => app.rejectBooking(id, (res.content || '').trim()),
            '已拒绝',
            () => {
              app.globalData._needRefresh = true
              this._refreshBooking()
            }
          )
        }
      }
    })
  },

  // 前往现场签到
  goCheckIn() {
    const booking = this.data.booking
    if (!booking) return
    const nowDate = new Date()
    const pad = value => String(value).padStart(2, '0')
    const today = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`
    if (booking.visitDate !== today) {
      wx.showToast({ title: '只能在预约当天到店签到', icon: 'none' })
      return
    }
    const id = booking.id
    wx.navigateTo({ url: `/pages/admin/checkin/checkin?id=${id}` })
  },

  rebook() {
    const id = this.data.booking.id
    wx.showModal({
      title: '重新预约',
      content: '将带入客户资料，请在首页重新选择日期和时段后提交',
      confirmText: '去选择',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.rebook(id, (draft) => {
            if (draft) wx.switchTab({ url: '/pages/index/index' })
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
  }
})
