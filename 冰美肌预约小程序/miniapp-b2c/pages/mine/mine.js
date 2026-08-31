const STATUS_CN = {
  pending_confirm: '新预约',
  confirmed: '已预约',
  visited: '已到店',
  in_experience: '体验中',
  completed: '已体验',
  cancelled: '已取消'
}

Page({
  data: {
    isAdmin: false,
    adminName: '',
    adminRole: '',
    previewRole: '',  // ''=实际角色 / 'user' / 'staff' / 'admin'
    isLoggedIn: false,  // 是否已手机号登录
    isDevtools: false,  // 是否开发工具环境
    operatorPhone: '15571892089',
    testPhone: '15821182307',  // 操作师手机号
    // 联系客服
    servicePhone: '19117352642',                  // 电话咨询号码
    serviceQrImage: '/images/service-qr.png',     // 企业微信客服二维码（请替换为后台下载的真实二维码）
    showServiceQr: false,                         // 是否展示客服二维码弹窗
    // 用户视图
    bookings: [],
    greeting: '欢迎使用',
    userName: '',
    userGender: '',
    userAge: '',
    userPhone: '',
    visitCount: 0,
    lastVisitDate: '',
    isFirstVisit: true,
    // 操作师视图
    pendingCount: 0,
    todayCount: 0,
    totalCount: 0,
    todaySchedule: []
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    const app = getApp()
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')

    // 开发工具环境：保留已有管理员状态，否则默认模拟用户登录
    const wasAdmin = wx.getStorageSync('_isAdmin')
    if (isDevtools && !wasAdmin) {
      try {
        wx.setStorageSync('_phoneVerified', true)
        wx.setStorageSync('_userPhone', '15821182307')
        if (app.saveUserProfile) {
          app.saveUserProfile({ name: 'Demo', gender: '女', phone: '15821182307' })
        }
      } catch (e) {
        console.warn('[dev] 模拟登录失败:', e)
      }
    }

    const isAdmin = app.globalData.isAdmin || wx.getStorageSync('_isAdmin')
    const isLoggedIn = !!wx.getStorageSync('_phoneVerified')

    this.setData({
      isAdmin: isAdmin,
      adminRole: app.globalData.adminRole || wx.getStorageSync('_adminRole') || '',
      adminName: app.globalData.adminName || wx.getStorageSync('_adminName') || '管理员',
      previewRole: '',  // 每次进入页面重置
      isLoggedIn: isLoggedIn,
      isDevtools: isDevtools
    })

    if (isAdmin) {
      this._loadAdminData()
    } else {
      this._loadUserData()
    }

    // 开发工具下覆盖问候语（多用户模拟测试）
    if (isDevtools) {
      this.setData({ greeting: '全流程测试' })
    }

    // 计算体验次数和上次体验时间
    const rawBookings = app.globalData.bookings || []
    const myPhone = (app.getUserProfile() || {}).phone || wx.getStorageSync('_userPhone') || ''
    const cleanPhone = (s) => (s || '').replace(/\*/g, '').trim()
    const myBookings = rawBookings.filter(b => {
      const bp = cleanPhone(b.phone)
      const mp = cleanPhone(myPhone)
      return bp && mp && bp.slice(-4) === mp.slice(-4)
    })
    // 已体验/已完成的记录（含体验中）
    const doneBookings = myBookings.filter(b => b._status === 'visited' || b._status === 'in_experience' || b._status === 'completed')
    const visitCount = doneBookings.length
    let lastVisitDate = ''
    if (visitCount > 0) {
      const dates = doneBookings
        .map(b => b.visitDate)
        .filter(d => !!d)
        .sort()
      lastVisitDate = dates.length > 0 ? dates.reverse()[0] : ''
    }
    this.setData({
      bookings: isAdmin ? [] : this.data.bookings,
      visitCount,
      lastVisitDate,
      isFirstVisit: visitCount === 0
    })
  },

  // ===========================================
  // 用户视图数据
  // ===========================================
  _loadUserData() {
    const app = getApp()
    let bookings = []
    try {
      bookings = app.getUserBookings ? app.getUserBookings() : []
      this.setData({ bookings: bookings })
    } catch (e) {
      console.warn('[mine] 加载用户预约失败:', e)
      this.setData({ bookings: [] })
    }

    // 用户画像优先取 userProfile；字段缺失时回退到最新一条预约记录
    // （预约数据本身含 姓名/性别/年龄/手机，是更权威的来源）
    const profile = (app.getUserProfile && app.getUserProfile()) || {}
    const latest = bookings[0] || {}
    const userName = profile.name || latest.name || ''
    const userGender = profile.gender || latest.gender || ''
    const userAge = profile.age || latest.age || ''
    const userPhone = profile.phone || latest.phone || wx.getStorageSync('_userPhone') || ''

    this.setData({ userName, userGender, userAge, userPhone })

    if (userName) {
      const surname = userName.charAt(0)
      const honorific = userGender === '女' ? '女士' : '先生'
      this.setData({ greeting: surname + honorific })
    } else {
      this.setData({ greeting: '欢迎使用' })
    }
  },

  // ===========================================
  // 操作师视图数据
  // ===========================================
  _loadAdminData() {
    const app = getApp()
    const all = app.getAllBookings ? app.getAllBookings() : []
    const today = new Date().toISOString().slice(0, 10)
    const pending = all.filter(b => b._status === 'pending_confirm')
    const todayList = all.filter(b => b.visitDate === today)

    this.setData({
      pendingCount: pending.length,
      todayCount: todayList.length,
      totalCount: all.length,
      todaySchedule: todayList.map(b => ({
        id: b.id,
        name: b.name,
        time: b.visitTime || '未指定',
        status: STATUS_CN[b._status] || b._status,
        phone: b.phone || ''
      }))
    })
  },

  // ===========================================
  // 用户视图操作
  // ===========================================
  goBook() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 电话咨询：直接拨号
  callPhone() {
    const phone = (this.data.servicePhone || '').trim()
    if (!phone) return
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => {}
    })
  },

  // 微信咨询：弹出企业微信客服二维码
  openServiceQr() {
    this.setData({ showServiceQr: true })
  },
  closeServiceQr() {
    this.setData({ showServiceQr: false })
  },
  // 阻止冒泡，避免点弹窗内部误触关闭
  preventClose() {},

  goFeedback(e) {
    const { id, modes } = e.currentTarget.dataset
    var available = []
    try {
      if (Array.isArray(modes)) {
        available = modes
      } else if (typeof modes === 'string') {
        available = JSON.parse(modes)
      } else if (modes) {
        available = [modes]
      }
    } catch (err) {
      console.warn('[问卷] modes 解析失败:', modes, err)
      available = []
    }
    if (!available || available.length === 0) {
      wx.showToast({ title: '暂无可用问卷', icon: 'none' })
      return
    }
    // 直接跳转第一个可用项，不再弹窗选择
    const mode = available[0].mode
    wx.navigateTo({ url: `/pages/feedback/feedback?recordId=${id}&mode=${mode}` })
  },

  goAftercare(e) {
    const { id, modes } = e.currentTarget.dataset
    var available = []
    try {
      if (Array.isArray(modes)) {
        available = modes
      } else if (typeof modes === 'string') {
        available = JSON.parse(modes)
      } else if (modes) {
        available = [modes]
      }
    } catch (err) {
      console.warn('[护理须知] modes 解析失败:', modes, err)
      available = []
    }
    if (available.length === 0) {
      wx.navigateTo({ url: `/pages/aftercare/aftercare?recordId=${id}` })
      return
    }
    // 直接跳转第一个可用项，不再弹窗选择
    const mode = available[0].mode
    wx.navigateTo({ url: `/pages/aftercare/aftercare?recordId=${id}&mode=${mode}` })
  },

  // 重新预约（基于已取消的旧记录）
  rebook(e) {
    const { id } = e.currentTarget.dataset
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
              wx.showToast({ title: '已创建新预约，等待确认', icon: 'success' })
              this._loadUserData()
            }
          })
        }
      }
    })
  },

  // ===========================================
  // 管理员视图操作
  // ===========================================
  goAdminList() {
    wx.navigateTo({ url: '/pages/admin/list/list' })
  },

  goDashboard() {
    wx.navigateTo({ url: '/pages/dashboard/dashboard' })
  },

  goAdminSchedule() {
    wx.navigateTo({ url: '/pages/admin/schedule/schedule' })
  },

  goFeedbacksAdmin() {
    wx.navigateTo({ url: '/pages/admin/feedbacks/feedbacks' })
  },

  goExport() {
    wx.navigateTo({ url: '/pages/admin/export/export' })
  },

  goQrcodeConfig() {
    wx.navigateTo({ url: '/pages/admin/qrconfig/qrconfig' })
  },

  goStaffManage() {
    wx.navigateTo({ url: '/pages/admin/managers/managers' })
  },

  // ===========================================
  // 身份认证
  // ===========================================
  goLogin() {
    wx.navigateTo({ url: '/pages/auth/phone/phone' })
  },

  // 手机号登录（微信一键授权）
  onLogin(e) {
    var self = this

    // 方式1：新 API code 解码
    if (e.detail && e.detail.code) {
      wx.showLoading({ title: '登录中...' })
      wx.cloud.callFunction({
        name: 'getPhoneNumber',
        data: { code: e.detail.code }
      }).then(function (res) {
        wx.hideLoading()
        var result = res.result || {}
        if (result.phone) {
          self._handlePhoneLogin(result.phone)
        } else {
          console.warn('[登录] getPhoneNumber 解密失败:', result.error)
          self._fallbackPhoneInput()
        }
      }).catch(function (err) {
        wx.hideLoading()
        console.warn('[登录] getPhoneNumber 云函数调用失败:', err)
        self._fallbackPhoneInput()
      })
      return
    }

    // 方式2：旧 API cloudID 解码
    if (e.detail && e.detail.cloudID) {
      wx.showLoading({ title: '登录中...' })
      wx.cloud.callFunction({
        name: 'loginByPhone',
        data: { cloudID: e.detail.cloudID }
      }).then(function (res) {
        wx.hideLoading()
        var result = res.result || {}
        if (result.phone) {
          self._handlePhoneLogin(result.phone)
          // loginByPhone 已在云端完成角色识别
          if (result.role === 'staff' || result.role === 'superadmin' || result.role === 'admin') {
            var app = getApp()
            if (!app.globalData.isAdmin) {
              app.globalData.isAdmin = true
              app.globalData.adminName = result.name || '工作人员'
              app.globalData.adminRole = result.role
              app.globalData.adminPhone = result.phone
              wx.setStorageSync('_isAdmin', true)
              wx.setStorageSync('_adminName', result.name || '工作人员')
              wx.setStorageSync('_adminRole', result.role)
              wx.setStorageSync('_adminPhone', result.phone)
              setTimeout(function () {
                wx.showToast({ title: '已识别为工作人员', icon: 'success' })
                wx.redirectTo({ url: '/pages/mine/mine' })
              }, 500)
            }
          }
        } else {
          self._fallbackPhoneInput()
        }
      }).catch(function (err) {
        wx.hideLoading()
        console.warn('[登录] loginByPhone 云函数调用失败:', err)
        self._fallbackPhoneInput()
      })
      return
    }

    // 降级：手动输入
    self._fallbackPhoneInput()
  },

  // 降级：手动输入手机号
  _fallbackPhoneInput() {
    var self = this
    wx.showModal({
      title: '登录',
      content: '请输入手机号',
      editable: true,
      placeholderText: '手机号',
      success: function (res) {
        if (res.confirm && res.content) {
          self._handlePhoneLogin(res.content)
        }
      }
    })
  },

  // 手机号登录处理
  _handlePhoneLogin(phone) {
    phone = (phone || '').replace(/\s+/g, '')
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    wx.setStorageSync('_phoneVerified', true)
    wx.setStorageSync('_userPhone', phone)
    try {
      var app = getApp()
      if (app.saveUserProfile) {
        app.saveUserProfile({ phone: phone })
      }
    } catch (e) { /* silent */ }
    this.setData({ isLoggedIn: true, userPhone: phone })

    // 尝试按手机号匹配管理员/操作师
    var app = getApp()
    var self = this
    if (app._tryLoginByPhone && app.globalData.db && !app.globalData.isAdmin) {
      app.getOpenId(function (openid) {
        if (openid) {
          app._tryLoginByPhone(app.globalData.db, openid, function (isAdmin) {
            if (isAdmin) {
              self.setData({
                isAdmin: true,
                adminRole: app.globalData.adminRole || 'staff',
                adminName: app.globalData.adminName || '工作人员'
              })
              self._loadAdminData()
              wx.showToast({ title: '已识别为工作人员', icon: 'success' })
            } else {
              wx.showToast({ title: '登录成功', icon: 'success' })
            }
          })
        } else {
          wx.showToast({ title: '登录成功', icon: 'success' })
        }
      })
    } else {
      wx.showToast({ title: '登录成功', icon: 'success' })
    }
  },

  // ===========================================
  // 视角切换（仅管理员可见）
  // ===========================================
  switchPreviewRole(e) {
    const role = e.currentTarget.dataset.role
    this.setData({ previewRole: role })

    const app = getApp()
    if (role === 'admin' || role === 'staff') {
      this._loadAdminData()
    } else if (role === 'user') {
      this._loadUserData()
    } else {
      // 显示实际角色
      if (this.data.adminRole === 'staff') {
        this._loadAdminData()
      } else {
        this._loadAdminData()
      }
    }
  },

  // ===========================================
  // 开发工具一键切换管理员（跳过密码）
  // ===========================================
  quickSwitchToAdmin() {
    const app = getApp()
    app.globalData.isAdmin = true
    app.globalData.adminRole = 'superadmin'
    app.globalData.adminName = '管理员'
    wx.setStorageSync('_isAdmin', true)
    wx.setStorageSync('_adminRole', 'superadmin')
    wx.setStorageSync('_adminName', '管理员')
    this.setData({ isAdmin: true, adminRole: 'superadmin', adminName: '管理员', previewRole: 'admin' })
    this._loadAdminData()
    wx.showToast({ title: '已切换为管理员视角', icon: 'none' })
  },

  exitAdmin() {
    const app = getApp()
    app.globalData.isAdmin = false
    app.globalData.adminRole = ''
    app.globalData.adminName = ''
    wx.removeStorageSync('_isAdmin')
    wx.removeStorageSync('_adminRole')
    wx.removeStorageSync('_adminName')
    this.setData({ isAdmin: false, adminRole: '', adminName: '', previewRole: '' })
    this._loadUserData()
    wx.showToast({ title: '已切换为用户视角', icon: 'none' })
  }
})
