// 顾客签到页（方案B：顾客扫小程序码 → 知情同意书 → 欢迎页）
Page({
  data: {
    bookingId: '',
    booking: null,
    done: false,
    needConsent: false
  },

  onLoad(options) {
    const id = options.id || ''
    if (!id) {
      wx.showToast({ title: '无效签到链接', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.setData({ bookingId: id })
    const app = getApp()
    const booking = app.getBookingById(id)
    if (!booking) {
      wx.showToast({ title: '未找到预约记录', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    const updates = { booking }
    if (!booking.consentSignName) {
      updates.needConsent = true
    }
    this.setData(updates)
    if (booking.consentSignName) this._completeCheckIn()
  },

  onShow() {
    const app = getApp()
    if (app.globalData._checkinConsent) {
      const data = app.globalData._checkinConsent
      app.globalData._checkinConsent = null
      if (data.bookingId === this.data.bookingId) {
        this._completeCheckIn()
      }
    }
  },

  _completeCheckIn() {
    const app = getApp()
    const booking = app.getBookingById(this.data.bookingId)
    if (!booking) return
    if (booking._status === 'visited') {
      this.setData({ booking, needConsent: false, done: true })
      return
    }
    // 同意书签署成功后签到，并沿合法流程更新为“已到店”。
    const checkedIn = booking.checkInAt ? true : app.checkIn(this.data.bookingId, booking.deviceModel || '')
    const statusUpdated = checkedIn && app.updateBookingStatus(this.data.bookingId, 'visited')
    this.setData({
      booking: app.getBookingById(this.data.bookingId),
      needConsent: false,
      done: !!statusUpdated
    })
    if (!statusUpdated) {
      wx.showToast({ title: '签到状态更新失败，请重试', icon: 'none' })
    }
  },

  goConsent() {
    const b = this.data.booking
    if (!b) return
    const params = [
      'source=checkin',
      'bookingId=' + encodeURIComponent(this.data.bookingId),
      'name=' + encodeURIComponent(b.name || ''),
      'gender=' + encodeURIComponent(b.gender || ''),
      'age=' + encodeURIComponent(b.age || ''),
      'idCard=' + encodeURIComponent(b.idCard || ''),
      'phone=' + encodeURIComponent(b.phone || ''),
      'visitDate=' + encodeURIComponent(b.visitDate || ''),
      'visitTime=' + encodeURIComponent(b.visitTime || '')
    ]
    wx.navigateTo({ url: '/pages/consent/consent?' + params.join('&') })
  },

  goBack() {
    wx.navigateBack()
  }
})
