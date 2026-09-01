// 测试面板：备案期间模拟完整业务流
const app = getApp()

Page({
  data: {
    testBooking: null,  // 当前测试 booking
    step: '',           // 当前所在步骤
    logs: []            // 操作日志
  },

  onLoad() {
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools'
    if (!isDevtools) {
      wx.showModal({
        title: '页面不可用',
        content: '模拟测试仅限微信开发者工具使用',
        showCancel: false,
        complete: () => wx.navigateBack()
      })
      return
    }
    this._log('测试面板已启动')
  },

  _log(msg) {
    const logs = this.data.logs.slice(-19)
    logs.push('[' + this._time() + '] ' + msg)
    this.setData({ logs })
    console.log('[测试面板]', msg)
  },

  _time() {
    const d = new Date()
    return d.getHours().toString().padStart(2, '0') + ':' +
           d.getMinutes().toString().padStart(2, '0') + ':' +
           d.getSeconds().toString().padStart(2, '0')
  },

  /**
   * 一键生成完整测试流
   */
  simulateFull() {
    const self = this
    wx.showLoading({ title: '生成中...', mask: true })

    const now = new Date()
    const dateStr = now.getFullYear() + '-' +
      (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
      now.getDate().toString().padStart(2, '0')
    const timeSlot = now.getHours() + 2 < 20 ? '14:00-15:00' : '10:00-11:00'

    const booking = {
      id: Date.now().toString(36),
      name: 'Lisa',
      gender: '女',
      age: '30',
      idCard: '310101199001010001',
      visitDate: dateStr,
      visitTime: timeSlot,
      medicalHistory: '',
      needs: '面部紧致护理',
      phone: '13800138000',
      channel: 'direct',
      trainerId: '',
      trainerName: '',
      consentSignName: 'Lisa',
      consentSignTime: new Date().toISOString(),
      consentSignImage: '',
      consentPhotoAuth1: true,
      consentPhotoAuth2: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _creatorOpenId: '',
      _status: 'completed',
      _confirmedAt: new Date().toISOString(),
      _confirmedBy: '测试操作师',
      checkInAt: new Date().toISOString(),
      deviceModel: 'MJ6',
      _totalEnergy: '800J',
      _shotDistribution: '面部200发',
      _maxLevel: '3.5',
      _immediateSatisfaction: 5,
      _comfortSatisfaction: 5,
      _photos: [],
      _beforePhotos: [],
      _halfPhotos: [],
      _afterPhotos: [],
      _productFeedback: '测试反馈',
      _day1FollowUp: '',
      _day30FollowUp: '',
      _day90FollowUp: '',
      _adminNote: '',
      _followUpRecords: [],
      _feedback24: true,
      _feedback30: false,
      _feedback90: false
    }

    app.getOpenId(function(openid) {
      booking._creatorOpenId = openid || ''
      app.globalData.bookings.unshift(booking)
      app._saveLocal()
      app._save()

      wx.hideLoading()
      self.setData({ testBooking: booking, step: 'full' })
      self._log('✓ 完整测试数据已生成 (ID: ' + booking.id + ')')
      wx.showToast({ title: '已生成', icon: 'success' })

      // 3秒后跳转到 detail 页查看
      setTimeout(() => {
        wx.navigateTo({ url: '/pages/admin/detail/detail?id=' + booking.id })
      }, 500)
    })
  },

  /**
   * 单个步骤生成
   */
  simulateNew() { this._genBooking('pending_confirm', '新预约') },
  simulateConfirmed() { this._genBooking('confirmed', '已预约') },
  simulateVisited() { this._genBooking('visited', '已到店') },
  simulateInExperience() { this._genBooking('in_experience', '体验中') },
  simulateCompleted() { this._genBooking('completed', '已体验') },
  simulateCancelled() { this._genBooking('cancelled', '已取消') },

  _genBooking(status, label) {
    const self = this
    wx.showLoading({ title: '生成中...', mask: true })

    const now = new Date()
    const dateStr = now.getFullYear() + '-' +
      (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
      now.getDate().toString().padStart(2, '0')

    const booking = {
      id: Date.now().toString(36),
      name: '测试用户',
      gender: '女',
      age: '28',
      idCard: '',
      visitDate: dateStr,
      visitTime: '14:00-15:00',
      phone: '13800001111',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _creatorOpenId: '',
      _status: status
    }

    app.getOpenId(function(openid) {
      booking._creatorOpenId = openid || ''

      if (status === 'confirmed') {
        booking._confirmedAt = new Date().toISOString()
        booking._confirmedBy = '测试操作师'
      }
      if (['visited', 'in_experience', 'completed'].indexOf(status) >= 0) {
        booking._confirmedAt = new Date().toISOString()
        booking.checkInAt = new Date().toISOString()
        booking.consentSignName = '测试用户'
        booking.consentSignTime = new Date().toISOString()
      }
      if (['in_experience', 'completed'].indexOf(status) >= 0) {
        booking.deviceModel = 'MJ6'
        booking._totalEnergy = '600J'
      }
      if (status === 'completed') {
        booking._immediateSatisfaction = 5
      }
      if (status === 'cancelled') {
        booking.cancelReason = '测试取消'
      }

      app.globalData.bookings.unshift(booking)
      app._saveLocal()
      app._save()
      wx.hideLoading()
      self.setData({ testBooking: booking, step: status })
      self._log('✓ 生成 ' + label + ' (ID: ' + booking.id + ')')
      wx.showToast({ title: label + ' 已生成', icon: 'success' })
    })
  },

  /**
   * 模拟顾客签到（跳转到 guest checkin）
   */
  simulateGuestCheckin() {
    wx.navigateTo({ url: '/pages/checkin/guest/guest' })
  },

  /**
   * 清空测试数据
   */
  clearAll() {
    const self = this
    wx.showModal({
      title: '⚠️ 确认清空',
      content: '将删除所有测试预约数据，不可恢复。确定吗？',
      confirmColor: '#EF4444',
      success: (res) => {
        if (res.confirm) {
          app.globalData.bookings = []
          app._save()
          app._saveLocal()
          wx.removeStorageSync('feedbacks')
          wx.removeStorageSync('_dbInited_v2')
          self.setData({ testBooking: null, step: '', logs: [] })
          self._log('✗ 已清空所有数据')
          wx.showToast({ title: '已清空', icon: 'success' })
        }
      }
    })
  },

  /**
   * 进入签到测试
   */
  goCheckinFlow() {
    wx.navigateTo({ url: '/pages/checkin/guest/guest' })
  },

  /**
   * 进入后台列表看数据
   */
  goToList() {
    wx.navigateTo({ url: '/pages/admin/list/list' })
  }
})
