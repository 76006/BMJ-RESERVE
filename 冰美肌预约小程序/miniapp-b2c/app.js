// ===========================================
// 冰美肌 - 体验记录小程序
// ===========================================
// 数据分为两层：
//   【灰色】用户填写 + 用户可见（我的页面）
//   【黄色】工作人员填写 + 管理员可见（后台页面）
//
// 云开发 env: cloudbase-d8gc0n57h3c535142
// ===========================================

const STATUS_MAP = {
  pending_confirm: { user: '新预约',   admin: '新预约' },
  confirmed:       { user: '已预约',   admin: '已预约' },
  visited:         { user: '已到店',   admin: '已到店' },
  in_experience:   { user: '体验中',   admin: '体验中' },
  completed:       { user: '已体验',   admin: '已体验' },
  cancelled:       { user: '已取消',   admin: '已取消' },
  rejected:        { user: '预约失败', admin: '已拒绝' }
}

// 预约状态只允许沿业务流程向前推进，避免后台任意跳转或回退。
const STATUS_TRANSITIONS = {
  pending_confirm: ['confirmed', 'rejected'],
  confirmed: ['visited', 'in_experience', 'cancelled'],
  visited: ['in_experience'],
  in_experience: ['completed'],
  completed: [],
  cancelled: [],
  rejected: []
}

function canTransitionStatus(booking, nextStatus) {
  if (!booking || !nextStatus) return false
  if (booking._status === nextStatus) return true
  const allowed = STATUS_TRANSITIONS[booking._status] || []
  if (allowed.indexOf(nextStatus) === -1) return false
  // 到店/体验中只能由完成签到后的流程触发，不能在详情页直接改写。
  if (booking._status === 'confirmed' &&
      (nextStatus === 'visited' || nextStatus === 'in_experience')) {
    return !!booking.checkInAt && !!booking.consentSignTime
  }
  return true
}

// 渠道标签
const CHANNEL_MAP = {
  medical: '医疗渠道',
  beauty:  '生美渠道',
  direct:  '直接访问'
}

// 解析小程序码 scene 字符串
// 微信扫码进入时，整个 scene（如 'checkin=true'、'id=xxx'、'channel=beauty&trainer=xxx'）
// 会作为整体放在 options.query.scene 中，不会自动拆成多个 query key，需手动解析
function parseScene(raw) {
  const obj = {}
  if (!raw) return obj
  decodeURIComponent(raw).split('&').forEach(function (p) {
    const i = p.indexOf('=')
    if (i === -1) {
      obj[p] = true
    } else {
      obj[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1))
    }
  })
  return obj
}

App({
  globalData: {
    bookings: [],
    isAdmin: false,
    adminName: '',
    adminRole: '',
    adminPhone: '',       // 管理员手机号（缓存）
    channel: 'direct',   // 扫码进入时由scene参数覆盖: medical / beauty / direct
    trainerId: '',        // 扫码带入的培训师标识
    trainerName: '',      // 培训师展示名称
    storeConfig: {
      storeName: '冰美肌',
      address: '',
      contactPhone: '',
      contactWechat: '',
      businessHours: '',
      appointmentNotice: '请提前10分钟到店，素颜更佳'
    },
    db: null,             // 云开发数据库实例
    _: null,              // 云数据库 command
    _useCloud: true,      // 是否使用云数据库（默认开启）
    _cloudReady: false,   // 云数据库是否就绪
    _launchCheckin: false,     // 是否需要跳转签到页
    _checkinBookingId: '',     // 扫描签到码带入的预约ID
    _checkinToken: '',         // 签到码中的服务端校验令牌
    openId: ''              // 用户 openId（云开发身份标识）
  },

  onLaunch(options) {
    // 获取系统信息（导航栏适配）
    const sys = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sys.statusBarHeight
    this.globalData.navBarHeight = 44 // 标准导航栏高度(px)

    // 全局错误捕获（开发调试 + 生产降级）
    wx.onError(err => console.error('[全局错误]', err))
    wx.onUnhandledRejection(res => console.warn('[未捕获Promise]', res.reason || res))

    // 初始化云开发
    wx.cloud.init({
      env: 'cloudbase-d8gc0n57h3c535142',
      traceUser: true
    })
    this.globalData.db = wx.cloud.database()
    this.globalData._ = this.globalData.db.command
    console.log('[云开发] 初始化完成, env=cloudbase-d8gc0n57h3c535142')

    // 读取扫码scene参数（小程序码带参进入）
    this._applyScanScene(options)

    // 必须先确认当前微信身份，再读取任何本地缓存或预约数据。
    // 同一部手机更换微信号时，这一步会清除上一账号遗留的资料与权限。
    this.getOpenId((openid) => {
      if (!openid) {
        this.logoutAdmin()
        this.globalData.bookings = []
        console.warn('[身份隔离] 未取得当前微信身份，本次不读取本地用户数据')
        return
      }
      this._checkAdminByOpenId(() => this._initCollections())
    })
  },

  // 解析扫码参数并写入全局标记（冷启动 onLaunch 与 暖启动 onShow 共用）
  _applyScanScene(options) {
    if (!options) return
    // 合并普通 query（分享卡片/普通跳转）与小程序码 scene 字符串
    const q = Object.assign({}, options.query || {})
    if (q.scene) {
      // 微信把整个 scene 字符串放在 query.scene，需手动解析成 key=value
      Object.assign(q, parseScene(q.scene))
    }

    // 培训师渠道扫码
    if (q.channel || q.trainer) {
      this.globalData.channel = q.channel || 'direct'
      this.globalData.trainerId = q.trainer || ''
      this.globalData.trainerName = q.name ? decodeURIComponent(q.name) : ''
    }
    // 顾客签到扫码（门店签到码 scene=checkin=true）
    if (q.checkin || q.scene === 'checkin') {
      this.globalData._launchCheckin = true
    }
    // 单预约签到码（scene 含 id=xxx）
    if (q.id) {
      this.globalData._launchCheckin = true
      this.globalData._checkinBookingId = q.id
    }
    if (q.t) {
      this.globalData._checkinToken = q.t
    }
  },

  onShow(options) {
    // 小程序已在后台运行时，顾客扫码只会触发 onShow，需在这里重新解析 scene
    this._applyScanScene(options)
  },

  // ===========================================
  // 云数据库加载（带本地缓存降级）
  // ===========================================
  _initCollections() {
    // 集合已在阶段0创建，不允许客户端启动时调用高权限初始化函数
    this._loadBookingsFromCloud()
    this.loadStoreConfig()
  },

  // 读取唯一门店配置。统一从云函数读取，开发者工具调用失败时才使用本地预览。
  loadStoreConfig(callback) {
    const defaults = {
      storeName: '冰美肌', address: '', contactPhone: '', contactWechat: '',
      businessHours: '', appointmentNotice: '请提前10分钟到店，素颜更佳'
    }
    return wx.cloud.callFunction({
      name: 'storeService',
      data: { action: 'get' }
    }).then(res => {
      const result = res.result || {}
      this.globalData.storeConfig = Object.assign({}, defaults, result.data || {})
      if (callback) callback(this.globalData.storeConfig)
      return this.globalData.storeConfig
    }).catch(err => {
      console.warn('[门店配置] 读取失败:', err && err.message ? err.message : err)
      const local = wx.getStorageSync('_storeConfigPreview') || {}
      this.globalData.storeConfig = Object.assign({}, defaults, local)
      if (callback) callback(this.globalData.storeConfig)
      return this.globalData.storeConfig
    })
  },

  getStoreConfig() {
    return this.globalData.storeConfig || {}
  },

  _loadBookingsFromCloud() {
    const db = this.globalData.db
    if (!db) {
      console.warn('[云开发] 未初始化，使用本地存储')
      this._loadBookingsLocal()
      return
    }

    // 开发工具环境下跳过云端，直接用本地演示数据（避免超时+缓存旧数据）
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools'
    if (isDevtools) {
      console.log('[演示模式] 开发工具：跳过云端查询，直接加载最新演示数据')
      wx.removeStorageSync('bookings')
      this._seedDemoData()
      return
    }

    // 数据安全：非管理员只加载自己的预约（按 _openid 过滤）
    // 管理员通过云函数加载全部（绕过安全规则）
    var self = this
    if (wx.getStorageSync('_isAdmin')) {
      this._loadAllBookingsAsAdmin()
    } else {
      this._loadOwnBookingsOnly()
    }
  },

  // 管理员：通过云函数加载全部预约（绕过数据库安全规则）
  _loadAllBookingsAsAdmin() {
    var self = this
    var timer = setTimeout(() => {
      console.warn('[云开发] 管理员加载超时，降级到本地存储')
      self._loadBookingsLocal()
    }, 4500)
    wx.cloud.callFunction({
      name: 'getAdminBookings',
      data: { limit: 200 }
    }).then(res => {
      clearTimeout(timer)
      var result = res.result || {}
      if (!result.success) {
        console.warn('[云开发] 管理员身份失效:', result.error || '无权限')
        self.logoutAdmin()
        self._loadOwnBookingsOnly()
        return
      }
      var data = result.data || []
      data.sort(function(a, b) {
        var ta = a.createdAt || 0
        var tb = b.createdAt || 0
        return tb.localeCompare ? tb.localeCompare(ta) : (tb > ta ? -1 : 1)
      })
      self.globalData.bookings = data
      self.globalData._cloudReady = true
      console.log('[云开发] 管理员加载 ' + data.length + ' 条预约记录')
    }).catch(err => {
      clearTimeout(timer)
      console.warn('[云开发] 管理员加载失败，降级到本地存储:', err && err.message ? err.message : err)
      self._loadBookingsLocal()
    })
  },

  // 普通用户：只加载自己的预约（数据隔离）
  _loadOwnBookingsOnly() {
    var self = this
    this.getOpenId(function(openid) {
      if (!openid) {
        console.warn('[云开发] 获取 openId 失败，降级到本地存储')
        self._loadBookingsLocal()
        return
      }
      var timer = setTimeout(function () {
        console.warn('[云开发] 查询超时，降级到本地存储')
        self._loadBookingsLocal()
      }, 4500)
      self.globalData.db.collection('bookings')
        .where({ _openid: openid })
        .limit(200)
        .get()
        .then(res => {
          clearTimeout(timer)
          var data = res.data || []
          data.sort(function(a, b) {
            var ta = a.createdAt || 0
            var tb = b.createdAt || 0
            return tb.localeCompare ? tb.localeCompare(ta) : (tb > ta ? -1 : 1)
          })
          self.globalData.bookings = data
          self.globalData._cloudReady = true
          console.log('[云开发] 用户加载 ' + data.length + ' 条预约记录（仅本人）')
        })
        .catch(err => {
          clearTimeout(timer)
          console.warn('[云开发] 读取失败，降级到本地存储:', err && err.message ? err.message : err)
          self._loadBookingsLocal()
        })
    })
  },

  _loadBookingsLocal() {
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools'
    if (isDevtools) {
      console.log('[演示模式] 开发工具：清除本地缓存，加载最新演示数据')
      wx.removeStorageSync('bookings')
      this._seedDemoData()
      return
    }
    const bookings = wx.getStorageSync('bookings') || []
    // 真机云端暂时不可用时只读取当前账号本地缓存；没有缓存就保持空数据，绝不清理其他资料。
    this.globalData.bookings = bookings
  },

  // ===========================================
  // 创建体验记录（用户提交）
  // ===========================================
  // 提交预约：只调用受控云函数，由云端事务完成时段校验、占位和创建。
  addBooking(userData, callback) {
    const self = this
    const payload = Object.assign({}, userData, {
      channel: userData.channel || self.globalData.channel || 'direct',
      trainerId: userData.trainerId || self.globalData.trainerId || '',
      trainerName: userData.trainerName || self.globalData.trainerName || ''
    })
    wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'create', data: payload },
      timeout: 20000
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) {
        if (callback) callback(null, result.error || '预约提交失败')
        return
      }
      const booking = result.data
      const sys = wx.getSystemInfoSync()
      const isDevtools = sys.platform === 'devtools'
      if (isDevtools && self.globalData.openId) {
        booking._openid = self.globalData.openId
        booking._creatorOpenId = self.globalData.openId
      }
      self.globalData.bookings.unshift(booking)
      self._saveLocal()
      self.saveUserProfile({
        name: booking.name || '',
        gender: booking.gender || '',
        age: booking.age || '',
        phone: booking.phone || ''
      })
      if (callback) callback(booking)
    }).catch(err => {
      console.warn('[云开发] 预约创建失败:', err)
      if (callback) callback(null, '网络异常，请稍后重试')
    })
  },

  // ===========================================
  // 管理员操作
  // ===========================================
  // 统一更新云数据库（通过业务id查找并更新）
  _updateCloud(bookingId, updateData) {
    if (!bookingId || !updateData) return
    wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'update', bookingId, data: updateData }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.error || '更新失败')
      console.log('[云开发] 受控更新成功:', bookingId)
    }).catch(err => console.warn('[云开发] 受控更新失败:', err && err.message ? err.message : err))
  },

  // 操作师确认预约
  // 检查时段冲突
  checkScheduleConflict(bookingId, date, time) {
    const bookings = this.globalData.bookings || []
    return bookings.filter(b => {
      if (b.id === bookingId) return false
      if (b.visitDate !== date || b.visitTime !== time) return false
      // 只检查活跃预约
      return b._status === 'pending_confirm' || b._status === 'confirmed' || b._status === 'visited'
    }).map(b => ({ name: b.name, phone: b.phone }))
  },

  // ===========================================
  // 时段开关（开放时段）：默认全部关闭，由操作师开启
  // 数据存储在云端集合 schedule(doc 'current')，所有用户可读。
  // 本地存储 _schedule 仅作 Devtools 演示模式降级。
  // ===========================================

  // 读取某天开放的时段（云端优先，Devtools 降级本地）
  // 返回 Promise<Array<string>> 该日开放时段列表（未设置/无记录 => 空数组=全关闭）
  getSchedule(date) {
    const self = this
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools'

    return new Promise((resolve) => {
      // 演示模式（Devtools）：直接读本地 _schedule，避免云端超时
      if (isDevtools) {
        const local = wx.getStorageSync('_schedule') || {}
        resolve((date && local[date]) ? local[date] : (Object.keys(local).length === 0 ? [] : []))
        return
      }

      const db = self.globalData.db
      if (!db) { resolve([]); return }

      db.collection('schedule').doc('current').get()
        .then(res => {
          const data = res.data || {}
          const sched = data.schedule || {}
          // 没有该日记录 => 默认全关闭 => 空数组
          resolve(Array.isArray(sched[date]) ? sched[date] : [])
        })
        .catch(() => {
          // 集合/文档不存在 => 默认全关闭
          resolve([])
        })
    })
  },

  // 读取某天已占用的时段映射（供"时段状态"指示用）
  // 排除已取消(cancelled)的预约；状态改为 cancelled/no_show 自动释放时段。
  // 返回 Promise<{ [visitTime]: { name, status } }>
  getOccupiedSlots(date) {
    const self = this
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools'

    return new Promise((resolve) => {
      const buildFromLocal = () => {
        // 演示模式：从 globalData.bookings + 本地存储合并判断
        const list = (self.globalData.bookings || []).concat(wx.getStorageSync('bookings') || [])
        const map = {}
        list.forEach(b => {
          if (b.visitDate !== date) return
          if (b._status === 'cancelled' || b._status === 'no_show') return
          map[b.visitTime] = { name: b.name || '', status: b._status || '' }
        })
        resolve(map)
      }

      if (isDevtools) { buildFromLocal(); return }

      wx.cloud.callFunction({
        name: 'checkSlot',
        data: { visitDate: date }
      })
        .then(res => {
          const result = res.result || {}
          const map = {}
          ;(result.occupiedSlots || []).forEach(visitTime => {
            map[visitTime] = { status: 'booked' }
          })
          resolve(map)
        })
        .catch(() => { resolve({}) })
    })
  },

  confirmBooking(bookingId, confirmedBy) {
    const booking = this._find(bookingId)
    if (!booking) return false
    if (booking._status !== 'pending_confirm') return false  // 只能从新预约确认
    booking._status = 'confirmed'
    booking._confirmedAt = new Date().toISOString()
    booking._confirmedBy = confirmedBy || ''
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, {
      _status: booking._status,
      _confirmedAt: booking._confirmedAt,
      _confirmedBy: booking._confirmedBy,
      updatedAt: booking.updatedAt
    })
    // 预约确认后异步通知顾客（微信订阅消息）；失败不影响确认结果
    this._notifyCustomer(bookingId, 'confirmed')
    return true
  },

  // 操作师拒绝预约（pending_confirm → rejected），并推送"预约失败"订阅消息
  rejectBooking(bookingId, reason) {
    const booking = this._find(bookingId)
    if (!booking) return false
    if (booking._status !== 'pending_confirm') return false  // 只能从新预约拒绝
    booking._status = 'rejected'
    booking._rejectReason = reason || ''
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, {
      _status: booking._status,
      _rejectReason: booking._rejectReason,
      updatedAt: booking.updatedAt
    })
    this._notifyCustomer(bookingId, 'rejected')
    return true
  },

  // 向顾客推送订阅消息（确认成功 / 拒绝失败），失败静默忽略，不影响主流程
  _notifyCustomer(bookingId, status) {
    if (!bookingId) return
    try {
      wx.cloud.callFunction({
        name: 'sendBookingNotify',
        data: { bookingId: bookingId, status: status },
        success: (res) => {
          const r = (res && res.result) || {}
          if (!r.ok) console.warn('[订阅消息] 发送未成功:', r.error)
          else console.log('[订阅消息] 已发送:', status)
        },
        fail: (err) => console.warn('[订阅消息] 调用失败:', err)
      })
    } catch (e) {
      console.warn('[订阅消息] 调用异常:', e)
    }
  },

  // 现场签到并录入设备型号
  checkIn(bookingId, deviceModel) {
    const booking = this._find(bookingId)
    if (!booking) return false
    if (booking._status !== 'confirmed') return false  // 只能从已预约签到
    booking.checkInAt = new Date().toISOString()
    booking.deviceModel = deviceModel || ''
    // 签到成功但状态不自动切换，等用户弹窗选择
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, {
      checkInAt: booking.checkInAt,
      deviceModel: booking.deviceModel,
      updatedAt: booking.updatedAt
    })
    return true
  },

  // 顾客扫码签到专用入口：由云端一次性校验签到码、预约归属、签署内容并写入到店状态。
  completeGuestCheckin(bookingId, checkinToken, signData) {
    const self = this
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: {
        action: 'completeCheckin',
        bookingId,
        checkinToken,
        consentAccepted: true,
        data: signData || {}
      }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) {
        const error = new Error(result.error || '签到失败')
        error.requiresPhoneAuth = result.requiresPhoneAuth === true
        error.invalidCode = result.invalidCode === true
        throw error
      }
      const local = self._find(bookingId)
      if (local) Object.assign(local, result.data)
      else self.globalData.bookings.unshift(Object.assign({}, result.data))
      self._saveLocal()
      return result.data
    })
  },

  // 顾客签到成功后选择“开始体验”，只允许云端从已到店状态继续流转。
  startGuestExperience(bookingId) {
    const self = this
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'startExperience', bookingId }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.error || '状态更新失败')
      const local = self._find(bookingId)
      if (local) Object.assign(local, result.data || { _status: 'in_experience' })
      self._saveLocal()
      return result.data || {}
    })
  },

  // ===========================================
  // 管理员认证（服务端 OPENID 白名单）
  // ===========================================
  // 真机每次启动都由云函数重新确认；本地缓存只用于开发工具界面预览。
  _checkAdminByOpenId(done) {
    const sys = wx.getSystemInfoSync()
    if (sys.platform === 'devtools') {
      if (wx.getStorageSync('_isAdmin')) {
        this.globalData.isAdmin = true
        this.globalData.adminName = wx.getStorageSync('_adminName') || '\u7ba1\u7406\u5458'
        this.globalData.adminRole = wx.getStorageSync('_adminRole') || 'staff'
      }
      if (done) done()
      return
    }
    var self = this
    wx.cloud.callFunction({
      name: 'loginByPhone',
      data: { action: 'check' }
    }).then(function (res) {
      const result = res.result || {}
      if (result.ok && result.isAdmin) {
        self._setAdminState(result)
      } else {
        self.logoutAdmin()
      }
      if (done) done()
    }).catch(function (err) {
      self.logoutAdmin()
      console.warn('[管理员] 云端身份校验失败:', err && err.message ? err.message : err)
      if (done) done()
    })
  },

  // 设置管理员状态（统一入口）
  _setAdminState(admin) {
    const wasAdmin = this.globalData.isAdmin
    this.globalData.isAdmin = true
    this.globalData.adminName = admin.name || '\u7ba1\u7406\u5458'
    this.globalData.adminRole = admin.role || 'staff'
    this.globalData.adminPhone = admin.phone || ''
    wx.setStorageSync('_isAdmin', true)
    wx.setStorageSync('_adminName', admin.name || '\u7ba1\u7406\u5458')
    wx.setStorageSync('_adminRole', admin.role || 'staff')
    wx.setStorageSync('_adminPhone', admin.phone || '')
    console.log('[管理员] 云端身份已确认:', admin.role)

    // 新认证的管理员：重新加载全部预约（之前只加载了自己的）
    if (!wasAdmin && this.globalData._cloudReady) {
      console.log('[管理员] 重新加载全部预约记录')
      this._loadAllBookingsAsAdmin()
    }
  },

  // 退出管理员登录
  logoutAdmin() {
    this.globalData.isAdmin = false
    this.globalData.adminName = ''
    this.globalData.adminRole = ''
    this.globalData.adminPhone = ''
    wx.removeStorageSync('_isAdmin')
    wx.removeStorageSync('_adminName')
    wx.removeStorageSync('_adminRole')
    wx.removeStorageSync('_adminPhone')
    console.log('[管理员] 已退出登录')
  },

  // ===========================================
  // 知情同意书签署（checkin流程中直接写入booking）
  // ===========================================
  saveConsent(bookingId, signData) {
    const booking = this._find(bookingId)
    if (!booking) return false
    booking.consentSignName = signData.name || ''
    booking.consentSignTime = new Date().toISOString()
    booking.consentSignImage = signData.image || ''
    booking.consentPhotoAuth1 = signData.photoAuth1 || false
    booking.consentPhotoAuth2 = signData.photoAuth2 || false
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, {
      consentSignName: booking.consentSignName,
      consentSignTime: booking.consentSignTime,
      consentSignImage: booking.consentSignImage,
      consentPhotoAuth1: booking.consentPhotoAuth1,
      consentPhotoAuth2: booking.consentPhotoAuth2,
      updatedAt: booking.updatedAt
    })
    return true
  },

  // ===========================================
  // 用户画像（新老客户识别）
  // ===========================================
  saveUserProfile(profile) {
    wx.setStorageSync('userProfile', {
      name: profile.name || '',
      gender: profile.gender || '',
      phone: profile.phone || '',
      updatedAt: new Date().toISOString()
    })
  },

  getUserProfile() {
    return wx.getStorageSync('userProfile') || null
  },

  // 微信手机号授权成功后的统一缓存入口，供首页、签到页和“我的”页共享。
  cacheVerifiedPhone(phone) {
    const value = String(phone || '').trim()
    if (!/^1[3-9]\d{9}$/.test(value)) return false
    wx.setStorageSync('_phoneVerified', true)
    wx.setStorageSync('_userPhone', value)
    const profile = this.getUserProfile() || {}
    wx.setStorageSync('userProfile', Object.assign({}, profile, {
      phone: value,
      updatedAt: new Date().toISOString()
    }))
    return true
  },

  updateBookingStatus(bookingId, newStatus) {
    const booking = this._find(bookingId)
    if (!booking) return false
    if (!canTransitionStatus(booking, newStatus)) {
      console.warn('[状态流转] 已阻止非法变更:', booking._status, '→', newStatus)
      return false
    }
    if (booking._status === newStatus) return true
    booking._status = newStatus
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    const cloudData = { _status: newStatus, updatedAt: booking.updatedAt }
    if (booking.checkInAt) cloudData.checkInAt = booking.checkInAt
    if (booking.consentSignTime) cloudData.consentSignTime = booking.consentSignTime
    this._updateCloud(bookingId, cloudData)
    return true
  },

  cancelBooking(bookingId, reason) {
    const booking = this._find(bookingId)
    if (!booking) return false
    if (booking._status !== 'confirmed') return false  // 只能在已预约状态下取消
    booking._status = 'cancelled'
    booking._cancelReason = reason
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, { _status: 'cancelled', _cancelReason: reason, updatedAt: booking.updatedAt })
    return true
  },

  // 重新预约：仅保存预填资料，返回首页重新选择日期与时段后再走云端创建。
  // @param {string} oldBookingId - 旧预约ID
  // @param {function} callback - 新booking加入globalData后回调（避免调用方在异步完成前刷新数据）
  rebook(oldBookingId, callback) {
    const old = this._find(oldBookingId)
    if (!old) {
      if (callback) callback(null)
      return null
    }
    wx.setStorageSync('_rebookDraft', {
      name: old.name || '',
      gender: old.gender || '',
      age: old.age || '',
      idCard: old.idCard || '',
      phone: old.phone || '',
      medicalHistory: old.medicalHistory || '',
      needs: old.needs || '',
      channel: old.channel || 'direct',
      trainerId: old.trainerId || '',
      trainerName: old.trainerName || ''
    })
    if (callback) callback('draft')
    return 'draft'
  },

  updateAdminNote(bookingId, note) {
    const booking = this._find(bookingId)
    if (!booking) return false
    booking._adminNote = note
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, { _adminNote: note, updatedAt: booking.updatedAt })
    return true
  },

  addFollowUpRecord(bookingId, content) {
    const booking = this._find(bookingId)
    if (!booking) return false
    const newRecord = { date: new Date().toISOString(), content: content }
    booking._followUpRecords.push(newRecord)
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, {
      _followUpRecords: booking._followUpRecords,
      updatedAt: booking.updatedAt
    })
    return true
  },

  updateCustomerInfo(bookingId, data) {
    const booking = this._find(bookingId)
    if (!booking) return false
    const cloudData = {}
    if (data.adminNote !== undefined) { booking._adminNote = data.adminNote; cloudData._adminNote = data.adminNote }
    booking.updatedAt = new Date().toISOString()
    cloudData.updatedAt = booking.updatedAt
    this._saveLocal()
    this._updateCloud(bookingId, cloudData)
    return true
  },

  // 更新黄色字段（批量）
  updateStaffData(bookingId, data) {
    const booking = this._find(bookingId)
    if (!booking) return false
    const yellowFields = [
      '_clientManager', '_totalEnergy', '_shotDistribution', '_maxLevel',
      '_immediateSatisfaction', '_comfortSatisfaction',
      '_productFeedback', '_day1FollowUp', '_day30FollowUp', '_day90FollowUp'
    ]
    const cloudData = {}
    yellowFields.forEach(key => {
      if (data[key] !== undefined) {
        booking[key] = data[key]
        cloudData[key] = data[key]
      }
    })
    if (data.deviceModel !== undefined) { booking.deviceModel = data.deviceModel; cloudData.deviceModel = data.deviceModel }
    if (data._photos !== undefined) { booking._photos = data._photos; cloudData._photos = data._photos }
    if (data._beforePhotos !== undefined) { booking._beforePhotos = data._beforePhotos; cloudData._beforePhotos = data._beforePhotos }
    if (data._halfPhotos !== undefined) { booking._halfPhotos = data._halfPhotos; cloudData._halfPhotos = data._halfPhotos }
    if (data._afterPhotos !== undefined) { booking._afterPhotos = data._afterPhotos; cloudData._afterPhotos = data._afterPhotos }
    booking.updatedAt = new Date().toISOString()
    cloudData.updatedAt = booking.updatedAt
    this._saveLocal()
    this._updateCloud(bookingId, cloudData)
    return true
  },

  // 更新客户灰色字段（用户在知情同意书等场景自动补全后回写）
  updateCustomerFields(bookingId, data) {
    const booking = this._find(bookingId)
    if (!booking) return false
    const grayFields = ['name', 'gender', 'age', 'idCard', 'phone']
    const cloudData = {}
    grayFields.forEach(key => {
      if (data[key] !== undefined && data[key] !== null) {
        booking[key] = data[key]
        cloudData[key] = data[key]
      }
    })
    if (Object.keys(cloudData).length === 0) return true
    booking.updatedAt = new Date().toISOString()
    cloudData.updatedAt = booking.updatedAt
    this._saveLocal()
    this._updateCloud(bookingId, cloudData)
    return true
  },

  addPhoto(bookingId, photo) {
    const booking = this._find(bookingId)
    if (!booking) return false
    booking._photos.push(photo)
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, { _photos: booking._photos, updatedAt: booking.updatedAt })
    return true
  },

  removePhoto(bookingId, index) {
    const booking = this._find(bookingId)
    if (!booking) return false
    booking._photos.splice(index, 1)
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, { _photos: booking._photos, updatedAt: booking.updatedAt })
    return true
  },

  // 标记回访问卷已提交
  markFeedbackDone(bookingId, mode) {
    const booking = this._find(bookingId)
    if (!booking) return false
    const cloudData = {}
    if (mode === '24h') { booking._feedback24 = true; cloudData._feedback24 = true }
    if (mode === '30') { booking._feedback30 = true; cloudData._feedback30 = true }
    if (mode === '90') { booking._feedback90 = true; cloudData._feedback90 = true }
    booking.updatedAt = new Date().toISOString()
    cloudData.updatedAt = booking.updatedAt
    this._saveLocal()
    this._updateCloud(bookingId, cloudData)
    return true
  },

  // ===========================================
  // 用户身份（openId）
  // ===========================================
  _activateIdentity(openid) {
    if (!openid) return
    const previous = wx.getStorageSync('_activeOpenId') || ''
    const isolationVersion = wx.getStorageSync('_identityIsolationVersion') || 0
    const identityChanged = !!previous && previous !== openid
    const needsMigration = isolationVersion < 1

    if (identityChanged || needsMigration) {
      wx.removeStorageSync('_phoneVerified')
      wx.removeStorageSync('_userPhone')
      wx.removeStorageSync('userProfile')
      wx.removeStorageSync('bookings')
      wx.removeStorageSync('feedbacks')
      this.logoutAdmin()
      this.globalData.bookings = []
      this.globalData._cloudReady = false
      console.log(identityChanged ? '[身份隔离] 检测到微信账号变化，已清除上一账号缓存' : '[身份隔离] 已完成本机缓存升级')
    }

    wx.setStorageSync('_activeOpenId', openid)
    wx.setStorageSync('_identityIsolationVersion', 1)
    this.globalData.openId = openid
  },

  getOpenId(callback) {
    const cb = typeof callback === 'function' ? callback : function () {}
    if (this.globalData.openId) {
      cb(this.globalData.openId)
      return
    }
    // 启动阶段多个页面可能同时请求身份，统一复用同一次云函数结果。
    if (this._openIdLoading) {
      this._openIdWaiters.push(cb)
      return
    }
    this._openIdLoading = true
    this._openIdWaiters = [cb]

    const finish = (openid) => {
      if (!this._openIdLoading) return
      this._openIdLoading = false
      const waiters = this._openIdWaiters || []
      this._openIdWaiters = []
      waiters.forEach(fn => fn(openid || ''))
    }

    // 开发工具/真机调试：直接返回 mock openId，避免云端调用超时影响调试
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools'
    if (isDevtools) {
      const mockOpenId = 'mock_openid_devtools'
      this._activateIdentity(mockOpenId)
      console.log('[开发工具] 使用 mock openId:', mockOpenId)
      finish(mockOpenId)
      return
    }

    // 超时兜底：3秒后强制回调，避免主流程卡死
    const timer = setTimeout(() => {
      console.warn('[云开发] getOpenId 超时，使用空 openId 继续')
      finish('')
    }, 3000)

    wx.cloud.callFunction({
      name: 'getOpenId',
      success: res => {
        clearTimeout(timer)
        const openid = res.result && res.result.openid
        if (openid) {
          this._activateIdentity(openid)
          console.log('[云开发] 获取 openId 成功:', openid.substring(0, 10) + '...')
        }
        finish(openid || '')
      },
      fail: (err) => {
        clearTimeout(timer)
        console.warn('[云开发] getOpenId 调用失败:', err)
        finish('')
      }
    })
  },
  getAllBookings() {
    return this.globalData.bookings
  },

  getBookingById(id) {
    return this._find(id)
  },

  // 获取用户可见的体验记录（剥离管理员字段，仅返回当前用户自己的记录）
  getUserBookings() {
    const myOpenId = this.globalData.openId || ''
    const profile = this.getUserProfile()
    const myPhone = profile ? profile.phone : ''
    const cleanPhone = (s) => (s || '').replace(/\*/g, '').trim()

    const today = new Date().toISOString().slice(0, 10)
    const daysDiff = (dateStr) => {
      const d1 = new Date(dateStr + 'T00:00:00')
      const d2 = new Date(today + 'T00:00:00')
      return Math.floor((d2 - d1) / 86400000)
    }

    return (this.globalData.bookings || [])
      .filter(b => {
        // 用户视角始终只显示本人预约；管理员查看全部记录只能走管理页面。
        if (myOpenId) {
          const ownerOpenId = b._creatorOpenId || b._openid || ''
          if (ownerOpenId) return ownerOpenId === myOpenId

          // 兼容没有归属字段的旧记录，但必须完整手机号一致，禁止仅后4位匹配。
          if (myPhone) {
            const bp = cleanPhone(b.phone)
            const mp = cleanPhone(myPhone)
            return !!bp && bp === mp
          }
          return false
        }
        // 仅在无法获取openId的本地降级场景按完整手机号匹配。
        if (myPhone) {
          const bp = cleanPhone(b.phone)
          const mp = cleanPhone(myPhone)
          if (bp && bp === mp) return true
        }
        // 演示数据（无openId且本地模式）- 仅在云端未就绪时显示
        if (!this.globalData._cloudReady && !b._creatorOpenId) return true
        return false
      })
      .map(b => {
        const diff = daysDiff(b.visitDate)
        // 问卷和护理须知触发规则相同（按visit时间计算）
        const getAvailable = (diff) => {
          const items = []
          if (diff >= 1) items.push({ mode: '24h', label: '24小时' })
          if (diff >= 30) items.push({ mode: '30', label: '30天' })
          if (diff >= 90) items.push({ mode: '90', label: '90天' })
          return items
        }
        // 用户已提交的问卷（不再显示）
        const allFeedbacks = wx.getStorageSync('feedbacks') || []
        const submittedModes = new Set(
          allFeedbacks.filter(f => f.recordId === b.id).map(f => f.mode)
        )
        // 护理须知：按时间触发，不受填写状态影响
        const availableAftercares = getAvailable(diff)
        const canAftercare = availableAftercares.length > 0 && (b._status === 'visited' || b._status === 'in_experience' || b._status === 'completed')
        // 问卷：过滤掉已提交的
        const rawFeedbacks = getAvailable(diff)
        const availableFeedbacks = rawFeedbacks.filter(f => !submittedModes.has(f.mode))
        const canFeedback = availableFeedbacks.length > 0 && (b._status === 'visited' || b._status === 'in_experience' || b._status === 'completed')
        const isDone = b._status === 'completed'
        return {
          id: b.id,
          name: b.name,
          gender: b.gender,
          age: b.age,
          visitDate: b.visitDate,
          visitTime: b.visitTime || '',
          medicalHistory: b.medicalHistory,
          needs: b.needs,
          createdAt: b.createdAt,
          userStatus: STATUS_MAP[b._status] ? STATUS_MAP[b._status].user : (console.warn('[数据异常] booking', b.id||b._id, '_status 不是6个合法值之一:', b._status), ''),
          canFeedback: canFeedback,
          availableFeedbacks: availableFeedbacks,
          canAftercare: canAftercare,
          availableAftercares: availableAftercares,
          isDone: isDone,
          _status: b._status,
          _cancelReason: b._cancelReason || ''
        }
      })
  },

  // ===========================================
  // 导出CSV（含全部字段）
  // ===========================================
  exportCSV() {
    const headers = [
      'ID', '姓名', '性别', '年龄', '身份证号', '体验日期', '时间段', '过往美容护理经历', '重点改善需求', '手机号',
      '来源渠道', '培训师', '状态', '确认人', '签到时间', '设备型号',
      '客户负责人', '累计能量', '发数分配', '最高档位', '产品优化意见',
      'Day1回访', 'Day30回访', 'Day90回访',
      '内部备注', '签署人', '签署时间', '创建时间', '更新时间'
    ]
    const statusLabel = s => STATUS_MAP[s] ? STATUS_MAP[s].admin : s
    const channelLabel = c => CHANNEL_MAP[c] || c || ''
    const esc = v => { const s = String(v || ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s }
    const rows = this.globalData.bookings.map(b => [
      b.id, b.name, b.gender, b.age, b.idCard || '', b.visitDate, b.visitTime || '',
      esc(b.medicalHistory), esc(b.needs), b.phone,
      channelLabel(b.channel), b.trainerName || '',
      statusLabel(b._status), b._confirmedBy || '', b.checkInAt || '', b.deviceModel || '',
      b._clientManager, b._totalEnergy, b._shotDistribution, b._maxLevel,
      esc(b._productFeedback), esc(b._day1FollowUp), esc(b._day30FollowUp), esc(b._day90FollowUp),
      esc(b._adminNote),
      b.consentSignName || '', b.consentSignTime || '', b.createdAt, b.updatedAt
    ])
    return { headers, rows }
  },

  // ===========================================
  // 内部方法
  // ===========================================
  _find(id) {
    return this.globalData.bookings.find(b => b.id === id)
  },

  _saveLocal() {
    wx.setStorageSync('bookings', this.globalData.bookings)
  },

  // 兼容旧调用（如有遗漏）
  _save() {
    this._saveLocal()
  },

  // ===========================================
  // 数据初始化（内测模式：空数据启动）
  // ===========================================
  _seedDemoData() {
    this.globalData.bookings = []
    this._save()
    wx.removeStorageSync('feedbacks')
    console.log('[内测模式] 已启动，数据为空，等待真实用户操作')
  }
})
