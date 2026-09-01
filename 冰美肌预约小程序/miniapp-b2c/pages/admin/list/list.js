Page({
  data: {
    bookings: [],
    filterStatus: 'all',
    totalCount: 0,
    statusCounts: {}
  },

  onShow() {
    this.loadData()
  },

  loadData() {
    const app = getApp()
    if (!app.globalData.isAdmin) {
      wx.navigateBack()
      return
    }
    const all = app.getAllBookings()
    const counts = { all: all.length }
    all.forEach(b => {
      counts[b._status] = (counts[b._status] || 0) + 1
    })

    let filtered = all
    if (this.data.filterStatus !== 'all') {
      filtered = all.filter(b => b._status === this.data.filterStatus)
    }

    this.setData({
      bookings: filtered,
      totalCount: all.length,
      statusCounts: counts
    })
  },

  setFilter(e) {
    const status = e.currentTarget.dataset.status
    this.setData({ filterStatus: status })
    this.loadData()
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/admin/detail/detail?id=${id}` })
  },

  exportData() {
    wx.navigateTo({ url: '/pages/admin/export/export' })
  },

  onConfirmTap(e) {
    const id = e.currentTarget.dataset.id
    const app = getApp()
    const booking = app.getBookingById(id)
    if (!booking) return
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
            wx.showToast({ title: '已确认预约', icon: 'success' })
            this.loadData()
          }
        }
      })
      return
    }
    wx.showModal({
      title: '确认预约',
      content: '确认该用户的预约时间？确认后用户将收到通知。',
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          app.confirmBooking(id, '管理员')
          wx.showToast({ title: '已确认预约', icon: 'success' })
          this.loadData()
        }
      }
    })
  },

  onRejectTap(e) {
    const id = e.currentTarget.dataset.id
    const app = getApp()
    const booking = app.getBookingById(id)
    if (!booking) return
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
            wx.showToast({ title: '已拒绝', icon: 'none' })
            this.loadData()
          } else {
            wx.showToast({ title: '当前状态不可拒绝', icon: 'none' })
          }
        }
      }
    })
  },

  goBack() {
    wx.navigateBack()
  },

  // 退出管理员身份
  logoutAdmin() {
    wx.showModal({
      title: '退出管理',
      content: '退出后将返回用户模式，需重新认证。',
      confirmText: '确认退出',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.globalData.isAdmin = false
          wx.removeStorageSync('_isAdmin')
          wx.removeStorageSync('_adminName')
          wx.showToast({ title: '已退出管理', icon: 'success' })
          wx.switchTab({ url: '/pages/mine/mine' })
        }
      }
    })
  },

  goDashboard() {
    wx.navigateTo({ url: '/pages/dashboard/dashboard' })
  },

  goSchedule() {
    wx.navigateTo({ url: '/pages/admin/schedule/schedule' })
  },

  goQRConfig() {
    wx.navigateTo({ url: '/pages/admin/qrconfig/qrconfig' })
  },

  onRebookTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: "重新预约",
      content: "将带入客户资料，请在首页重新选择日期和时段后提交",
      confirmText: "去选择",
      cancelText: "取消",
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.rebook(id, (draft) => {
            if (draft) wx.switchTab({ url: '/pages/index/index' })
          })
        }
      }
    })
  }
})
