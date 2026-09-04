const STATUS_CN = {
  pending_confirm: '新预约',
  confirmed: '已预约',
  visited: '已到店',
  in_experience: '体验中',
  completed: '已体验',
  cancelled: '已取消',
  rejected: '预约失败'
}

const SUBSCRIBE_TEMPLATES = {
  appointment: 'A09emeoi_5a_1s7UsMD7Twuj5cfYOC-Y1999bCtb-sI',
  day30: 'nV6Oc0UnmsGkZbpcBXBcUPRpkRzR4B__uX5TU_M9xUo',
  day90: 'j7okEfYaR9VoT0M3Lt2T79tUjWinkC_1CjEMmfCpkSw'
}

function localDateString(date) {
  const value = date || new Date()
  const pad = number => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

Page({
  data: {
    isAdmin: false,
    adminName: '',
    adminRole: '',
    identityLoading: true,
    previewRole: '',  // ''=实际角色 / 'user' / 'staff' / 'admin'
    isLoggedIn: false,  // 是否已手机号登录
    isDevtools: false,  // 是否开发工具环境
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
    todaySchedule: [],
    staffNotifyConfigured: null
  },

  onShow() {
    this._pageVisible = true
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    const app = getApp()

    // OPENID 返回并不代表管理员权限已经查询完成。页面必须等待完整身份校验，
    // 否则首次进入“我的”会先被渲染成普通用户，且之后不会自动切换。
    if (!app.globalData._identityReady) {
      this.setData({ identityLoading: true })
      if (this._waitingIdentity) return
      this._waitingIdentity = true
      app.whenIdentityReady(() => {
        this._waitingIdentity = false
        if (this._pageVisible) this._refreshCurrentView()
      })
      return
    }

    this._refreshCurrentView()
  },

  onHide() {
    this._pageVisible = false
  },

  _refreshCurrentView() {
    const app = getApp()
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools'

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

    // 真机只信任 app 中已经由云函数确认的状态；开发工具允许本地视图预览。
    const isAdmin = app.globalData.isAdmin || (isDevtools && wx.getStorageSync('_isAdmin'))
    const isLoggedIn = !!wx.getStorageSync('_phoneVerified')
    const rawRole = app.globalData.adminRole || wx.getStorageSync('_adminRole') || 'staff'
    const adminRole = rawRole === 'admin' || rawRole === 'superadmin' ? 'admin' : 'staff'

    // 从管理子页面返回时保留原视角；从其他 Tab 再进入“我的”时恢复实际角色。
    const previewRole = this._preservePreviewRole ? this.data.previewRole : ''
    this._preservePreviewRole = false

    const refreshSeq = (this._refreshSeq || 0) + 1
    this._refreshSeq = refreshSeq
    const hasReadyAdminData = isAdmin && app.globalData._cloudReady
    this.setData({
      isAdmin: isAdmin,
      adminRole: adminRole,
      adminName: app.globalData.adminName || wx.getStorageSync('_adminName') || '管理员',
      previewRole: previewRole,
      isLoggedIn: isLoggedIn,
      isDevtools: isDevtools,
      identityLoading: isAdmin && !isDevtools && !hasReadyAdminData
    })

    if (isAdmin) {
      this._loadStaffNotifyConfig()
      // 启动阶段已经成功取得数据时先立即展示，再在后台更新一次。
      if (hasReadyAdminData) this._loadAdminData()
      // 每次进入工作台都从云端刷新全部预约；首次读取完成前不显示错误的 0。
      if (!isDevtools && app._loadAllBookingsAsAdmin) {
        app._loadAllBookingsAsAdmin().then(() => {
          if (!this._pageVisible || refreshSeq !== this._refreshSeq) return
          if (!app.globalData.isAdmin) {
            this._refreshCurrentView()
            return
          }
          this._loadAdminData()
          this.setData({ identityLoading: false })
        })
      } else {
        this._loadAdminData()
        this.setData({ identityLoading: false })
      }
    } else {
      if (this.data.staffNotifyConfigured !== null) {
        this.setData({ staffNotifyConfigured: null })
      }
      if (!isLoggedIn) {
        this._loadUserData()
        this.setData({ identityLoading: false })
        return
      }
      const hasReadyUserData = app.globalData._cloudReady
      if (hasReadyUserData) {
        this._loadUserData()
        this._updateUserVisitSummary()
      }
      this.setData({ identityLoading: !hasReadyUserData })
      if (app._loadOwnBookingsOnly) {
        app._loadOwnBookingsOnly().then(() => {
          if (!this._pageVisible || refreshSeq !== this._refreshSeq) return
          this._loadUserData()
          this._updateUserVisitSummary()
          this.setData({ identityLoading: false })
        })
      }
    }

    // 开发工具下覆盖问候语（多用户模拟测试）
    if (isDevtools) {
      this.setData({ greeting: '全流程测试' })
    }

    if (isAdmin) {
      this.setData({ bookings: [], visitCount: 0, lastVisitDate: '', isFirstVisit: true })
    }
  },

  _updateUserVisitSummary() {
    const app = getApp()
    const myBookings = app.getUserBookings ? app.getUserBookings() : []
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
      bookings: myBookings,
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
    const today = localDateString(new Date())
    const pending = all.filter(b => b._status === 'pending_confirm')
    const todayList = all.filter(b => b.visitDate === today)
    const customerKeys = {}
    all.forEach((booking, index) => {
      const phone = String(booking.phone || '').replace(/\D/g, '')
      const key = phone || booking._openid || booking._creatorOpenId || booking.id || `record_${index}`
      customerKeys[key] = true
    })

    this.setData({
      pendingCount: pending.length,
      todayCount: todayList.length,
      totalCount: Object.keys(customerKeys).length,
      todaySchedule: todayList.map(b => ({
        id: b.id,
        name: b.name,
        time: b.visitTime || '未指定',
        status: STATUS_CN[b._status] || b._status,
        phone: b.phone || ''
      }))
    })
  },

  _loadStaffNotifyConfig() {
    const app = getApp()
    if (!app.getStaffNotifyConfig) return
    const seq = (this._staffNotifyConfigSeq || 0) + 1
    this._staffNotifyConfigSeq = seq
    app.getStaffNotifyConfig().then(configured => {
      if (!this._pageVisible || seq !== this._staffNotifyConfigSeq) return
      this.setData({ staffNotifyConfigured: configured })
    }).catch(err => {
      console.warn('[企业微信] 读取预约提醒配置失败:', err.message || err)
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

  goPhotoUpload(e) {
    const { id, stage } = e.currentTarget.dataset
    if (!id || (String(stage) !== '30' && String(stage) !== '90')) {
      wx.showToast({ title: '照片阶段不正确', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/photo-upload/photo-upload?id=${id}&stage=${stage}` })
  },

  goServiceFeedback(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '预约编号不存在', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/feedback/feedback?id=${id}` })
  },

  goFollowupFeedback(e) {
    const id = e.currentTarget.dataset.id
    const mode = String(e.currentTarget.dataset.mode || '')
    if (!id || (mode !== '30' && mode !== '90')) {
      wx.showToast({ title: '问卷阶段不正确', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/feedback/feedback?recordId=${id}&mode=${mode}` })
  },

  subscribeBookingReminders(e) {
    const bookingId = e.currentTarget.dataset.id
    const booking = (this.data.bookings || []).find(item => item.id === bookingId)
    const stages = booking && Array.isArray(booking.reminderStages) ? booking.reminderStages : []
    const templateIds = stages.map(stage => SUBSCRIBE_TEMPLATES[stage]).filter(id => !!id)
    if (!templateIds.length) {
      wx.showToast({ title: '暂无待开启的提醒', icon: 'none' })
      return
    }

    wx.requestSubscribeMessage({
      tmplIds: templateIds,
      success: result => {
        const acceptedCount = templateIds.filter(id => result[id] === 'accept').length
        wx.showModal({
          title: acceptedCount > 0 ? '提醒设置完成' : '未开启提醒',
          content: `已同意 ${acceptedCount} 项，共 ${templateIds.length} 项。每次授权对应一次通知，如需补充可再次点击。`,
          showCancel: false
        })
      },
      fail: err => {
        console.warn('[订阅消息] 用户补充授权失败:', err)
        wx.showToast({ title: '提醒授权未完成', icon: 'none' })
      }
    })
  },

  // 重新预约（基于已取消的旧记录）
  rebook(e) {
    const { id } = e.currentTarget.dataset
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

  // ===========================================
  // 管理员视图操作
  // ===========================================
  _openAdminPage(url) {
    this._preservePreviewRole = true
    wx.navigateTo({
      url,
      fail: () => { this._preservePreviewRole = false }
    })
  },

  goAdminList() {
    this._openAdminPage('/pages/admin/list/list')
  },

  goDashboard() {
    this._openAdminPage('/pages/dashboard/dashboard')
  },

  goFeedbackAdmin() {
    this._openAdminPage('/pages/admin/feedbacks/feedbacks')
  },

  goAdminSchedule() {
    this._openAdminPage('/pages/admin/schedule/schedule')
  },

  goStoreConfig() {
    this._openAdminPage('/pages/admin/store/store')
  },

  goExport() {
    this._openAdminPage('/pages/admin/export/export')
  },

  goQrcodeConfig() {
    this._openAdminPage('/pages/admin/qrconfig/qrconfig')
  },

  goStaffManage() {
    this._openAdminPage('/pages/admin/managers/managers')
  },

  // ===========================================
  // 身份认证
  // ===========================================
  // 手机号登录（微信一键授权）
  onLogin(e) {
    var self = this
    const detail = e.detail || {}
    if (!detail.code && !detail.cloudID) {
      wx.showToast({ title: '请使用微信手机号授权登录', icon: 'none' })
      return
    }
    const data = detail.code ? { code: detail.code } : { cloudID: detail.cloudID }
    wx.showLoading({ title: '登录中...' })
    wx.cloud.callFunction({ name: 'loginByPhone', data }).then(function (res) {
      wx.hideLoading()
      const result = res.result || {}
      if (!result.ok || !result.phone) {
        wx.showModal({
          title: '登录失败',
          content: result.error || '手机号授权失败，请重新尝试',
          showCancel: false
        })
        return
      }
      self._handlePhoneLogin(result.phone)
      const app = getApp()
      if (result.isAdmin) {
        app._setAdminState(result)
        self.setData({
          isAdmin: true,
          adminRole: app.globalData.adminRole,
          adminName: result.name || '工作人员',
          identityLoading: true
        })
        const loading = app._loadAllBookingsAsAdmin
          ? app._loadAllBookingsAsAdmin()
          : Promise.resolve()
        loading.then(() => {
          if (!app.globalData.isAdmin) {
            self._refreshCurrentView()
            return
          }
          self._loadAdminData()
          self.setData({ identityLoading: false })
          wx.showToast({ title: '已识别为工作人员', icon: 'success' })
        })
      } else {
        self.setData({ identityLoading: true })
        const loading = app._loadOwnBookingsOnly
          ? app._loadOwnBookingsOnly()
          : Promise.resolve()
        loading.then(() => {
          self._loadUserData()
          self._updateUserVisitSummary()
          self.setData({ identityLoading: false })
          wx.showToast({ title: '登录成功', icon: 'success' })
        })
      }
    }).catch(function (err) {
      wx.hideLoading()
      console.warn('[登录] loginByPhone 云函数调用失败:', err)
      wx.showToast({ title: '登录失败，请重试', icon: 'none' })
    })
  },

  // 手机号登录处理
  _handlePhoneLogin(phone) {
    phone = (phone || '').replace(/\s+/g, '')
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    try {
      var app = getApp()
      if (app.cacheVerifiedPhone) app.cacheVerifiedPhone(phone)
      else {
        wx.setStorageSync('_phoneVerified', true)
        wx.setStorageSync('_userPhone', phone)
      }
    } catch (e) { /* silent */ }
    this.setData({ isLoggedIn: true, userPhone: phone })

  },

  // 退出当前手机号身份，回到微信手机号授权入口
  logoutUser() {
    wx.showModal({
      title: '退出当前登录',
      content: '退出后需要重新授权手机号，是否继续？',
      confirmText: '退出',
      confirmColor: '#C94B4B',
      success: (res) => {
        if (!res.confirm) return

        const app = getApp()
        const wasAdmin = this.data.isAdmin || app.globalData.isAdmin
        if (app.logoutAdmin) app.logoutAdmin()

        wx.removeStorageSync('_phoneVerified')
        wx.removeStorageSync('_userPhone')
        wx.removeStorageSync('userProfile')

        // 管理员退出时清除全量预约；普通用户只保留属于当前微信的预约缓存。
        if (wasAdmin) {
          wx.removeStorageSync('bookings')
          app.globalData.bookings = []
          app.globalData._cloudReady = false
        }

        this.setData({
          isLoggedIn: false,
          isAdmin: false,
          adminRole: '',
          adminName: '',
          previewRole: '',
          bookings: [],
          greeting: '欢迎使用',
          userName: '',
          userGender: '',
          userAge: '',
          userPhone: '',
          visitCount: 0,
          lastVisitDate: '',
          isFirstVisit: true
        })

        wx.showToast({ title: '已退出，请重新登录', icon: 'none' })
      }
    })
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
    const sys = wx.getSystemInfoSync()
    if (sys.platform !== 'devtools') {
      wx.showToast({ title: '仅开发工具可使用预览切换', icon: 'none' })
      return
    }
    const app = getApp()
    app.globalData.isAdmin = true
    app.globalData.adminRole = 'admin'
    app.globalData.adminName = '管理员'
    wx.setStorageSync('_isAdmin', true)
    wx.setStorageSync('_adminRole', 'admin')
    wx.setStorageSync('_adminName', '管理员')
    this.setData({ isAdmin: true, adminRole: 'admin', adminName: '管理员', previewRole: 'admin' })
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
    this.setData({ isAdmin: false, adminRole: '', adminName: '', previewRole: '', staffNotifyConfigured: null })
    this._loadUserData()
    wx.showToast({ title: '已切换为用户视角', icon: 'none' })
  }
})
