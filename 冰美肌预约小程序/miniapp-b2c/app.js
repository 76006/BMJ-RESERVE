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

// 正式权限只有两级：staff（操作师）与 admin（管理员）。
// 线上已有的 superadmin 数据按 admin 兼容，避免升级后原管理员失去权限。
function normalizeAdminRole(role) {
  return role === 'admin' || role === 'superadmin' ? 'admin' : 'staff'
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
    _identityReady: false, // 当前微信的管理员身份是否已经完成云端校验
    _launchCheckin: false,     // 是否需要跳转签到页
    _checkinBookingId: '',     // 扫描签到码带入的预约ID
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
    this.globalData._identityReady = false
    this.getOpenId((openid) => {
      if (!openid) {
        this.logoutAdmin()
        this.globalData.bookings = []
        console.warn('[身份隔离] 未取得当前微信身份，本次不读取本地用户数据')
        this._markIdentityReady()
        return
      }
      this._checkAdminByOpenId(() => {
        this._markIdentityReady()
        this._initCollections()
      })
    })
  },

  // 页面可在启动阶段等待管理员身份校验完成，避免先渲染成普通用户。
  whenIdentityReady(callback) {
    if (typeof callback !== 'function') return
    if (this.globalData._identityReady) {
      callback()
      return
    }
    this._identityWaiters = this._identityWaiters || []
    this._identityWaiters.push(callback)
  },

  _markIdentityReady() {
    this.globalData._identityReady = true
    const waiters = this._identityWaiters || []
    this._identityWaiters = []
    waiters.forEach(fn => {
      try { fn() } catch (err) { console.warn('[身份校验] 页面刷新失败:', err) }
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
      return this._loadAllBookingsAsAdmin()
    }
    // 普通用户尚未完成手机号登录时不提前发起预约读取，避免登录过程复用到旧请求。
    if (!wx.getStorageSync('_phoneVerified')) {
      this.globalData.bookings = []
      this.globalData._cloudReady = false
      return Promise.resolve([])
    }
    return this._loadOwnBookingsOnly()
  },

  // 管理员：通过云函数加载全部预约（绕过数据库安全规则）
  _loadAllBookingsAsAdmin(callback) {
    var self = this

    // 启动流程和“我的”页可能同时发起读取，复用同一个请求，避免后返回的旧请求覆盖新数据。
    if (!this._adminBookingsPromise) {
      const loadPage = function(offset, all) {
        return wx.cloud.callFunction({
          name: 'getAdminBookings',
          data: { limit: 100, offset },
          timeout: 20000
        }).then(res => {
          const result = res.result || {}
          if (!result.success) throw new Error(result.error || '无管理员权限')
          const rows = result.data || []
          all.push(...rows)
          if (result.hasMore && rows.length > 0) return loadPage(offset + rows.length, all)
          return all
        })
      }

      this._adminBookingsPromise = loadPage(0, []).then(data => {
        data.sort(function(a, b) {
          var ta = a.createdAt || 0
          var tb = b.createdAt || 0
          return tb.localeCompare ? tb.localeCompare(ta) : (tb > ta ? -1 : 1)
        })
        self.globalData.bookings = data
        self.globalData._cloudReady = true
        self._saveLocal()
        console.log('[云开发] 管理员加载 ' + data.length + ' 条预约记录')
        return data
      }).catch(err => {
        const message = err && err.message ? err.message : String(err || '')
        console.warn('[云开发] 管理员加载失败，降级到当前账号缓存:', message)
        if (message.indexOf('无管理员权限') >= 0) {
          self.logoutAdmin()
          self.globalData.bookings = []
          self.globalData._cloudReady = false
          return self._loadOwnBookingsOnly()
        }
        self._loadBookingsLocal()
        return self.globalData.bookings || []
      }).then(data => {
        self._adminBookingsPromise = null
        return data
      })
    }

    return this._adminBookingsPromise.then(data => {
      if (typeof callback === 'function') callback(data)
      return data
    })
  },

  // 普通用户：只加载自己的预约（数据隔离）
  _loadOwnBookingsOnly(callback) {
    var self = this
    if (!this._ownBookingsPromise) {
      this._ownBookingsPromise = new Promise((resolve, reject) => {
        self.getOpenId(openid => {
          if (!openid) {
            reject(new Error('无法识别当前微信用户'))
            return
          }
          wx.cloud.callFunction({
            name: 'bookingService',
            data: { action: 'listMine' },
            timeout: 15000
          }).then(resolve).catch(reject)
        })
      }).then(res => {
        const result = res.result || {}
        if (!result.success) throw new Error(result.error || '读取预约失败')
        const data = result.data || []
        data.sort(function(a, b) {
          var ta = a.createdAt || 0
          var tb = b.createdAt || 0
          return tb.localeCompare ? tb.localeCompare(ta) : (tb > ta ? -1 : 1)
        })
        self.globalData.bookings = data
        self.globalData._cloudReady = true
        self._saveLocal()
        console.log('[云开发] 用户加载 ' + data.length + ' 条预约记录（仅本人）')
        return data
      }).catch(err => {
        console.warn('[云开发] 用户预约读取失败，降级到当前账号缓存:', err && err.message ? err.message : err)
        self._loadBookingsLocal()
        return self.globalData.bookings || []
      }).then(data => {
        self._ownBookingsPromise = null
        return data
      })
    }

    return this._ownBookingsPromise.then(data => {
      if (typeof callback === 'function') callback(data)
      return data
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
    if (!bookingId || !updateData) return Promise.reject(new Error('缺少预约编号或更新内容'))
    const sys = wx.getSystemInfoSync()
    if (sys.platform === 'devtools') {
      return Promise.resolve({ success: true, localOnly: true })
    }
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'update', bookingId, data: updateData }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.error || '更新失败')
      console.log('[云开发] 受控更新成功:', bookingId)
      return result
    })
  },

  // 云端确认成功后才更新本地缓存，避免界面显示成功但云端实际失败。
  _commitBookingUpdate(bookingId, updateData) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    return this._updateCloud(bookingId, updateData).then(() => {
      Object.assign(booking, updateData)
      this._saveLocal()
      return booking
    })
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
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    if (booking._status !== 'pending_confirm') return Promise.reject(new Error('当前状态不可确认'))
    const now = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, {
      _status: 'confirmed',
      _confirmedAt: now,
      _confirmedBy: confirmedBy || '',
      updatedAt: now
    }).then(updated => {
      // 预约确认后异步通知顾客；通知失败不回滚已经成功的确认。
      this._notifyCustomer(bookingId, 'confirmed')
      return updated
    })
  },

  // 操作师拒绝预约（pending_confirm → rejected），并推送"预约失败"订阅消息
  rejectBooking(bookingId, reason) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    if (booking._status !== 'pending_confirm') return Promise.reject(new Error('当前状态不可拒绝'))
    const now = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, {
      _status: 'rejected',
      _rejectReason: reason || '',
      updatedAt: now
    }).then(updated => {
      this._notifyCustomer(bookingId, 'rejected')
      return updated
    })
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

  // 管理员查看企业微信预约提醒是否已配置。仅返回布尔值，不暴露机器人地址。
  getStaffNotifyConfig() {
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'getStaffNotifyConfig' }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.error || '读取通知配置失败')
      return result.configured === true
    })
  },

  // 企业微信通知失败时由管理员手动重试，并同步更新当前预约缓存。
  retryStaffNotification(bookingId) {
    const self = this
    if (!bookingId) return Promise.reject(new Error('缺少预约编号'))
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'retryStaffNotify', bookingId }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.error || '重新发送失败')
      const booking = self._find(bookingId)
      if (booking && result.data) Object.assign(booking, result.data)
      self._saveLocal()
      return result
    })
  },

  // 现场签到并录入设备型号
  checkIn(bookingId, deviceModel) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    if (booking._status !== 'confirmed') return Promise.reject(new Error('当前状态不可签到'))
    const nowDate = new Date()
    const pad = value => String(value).padStart(2, '0')
    const today = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`
    if (booking.visitDate !== today) return Promise.reject(new Error('只能在预约当天到店签到'))
    if (!booking.consentSignTime) return Promise.reject(new Error('请先完成知情同意书签署'))
    const now = new Date().toISOString()
    // 签到时间和“已到店”状态一次提交，避免两个请求先后顺序不确定。
    return this._commitBookingUpdate(bookingId, {
      _status: 'visited',
      checkInAt: now,
      deviceModel: deviceModel || '',
      updatedAt: now
    })
  },

  // 顾客扫码签到专用入口：由云端校验预约归属、日期、状态和签署内容。
  completeGuestCheckin(bookingId, signData) {
    const self = this
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: {
        action: 'completeCheckin',
        bookingId,
        consentAccepted: true,
        data: signData || {}
      }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) {
        const error = new Error(result.error || '签到失败')
        error.requiresPhoneAuth = result.requiresPhoneAuth === true
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
        this.globalData.adminRole = normalizeAdminRole(wx.getStorageSync('_adminRole') || 'staff')
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
    this.globalData.adminRole = normalizeAdminRole(admin.role)
    this.globalData.adminPhone = admin.phone || ''
    wx.setStorageSync('_isAdmin', true)
    wx.setStorageSync('_adminName', admin.name || '\u7ba1\u7406\u5458')
    wx.setStorageSync('_adminRole', this.globalData.adminRole)
    wx.setStorageSync('_adminPhone', admin.phone || '')
    console.log('[管理员] 云端身份已确认:', this.globalData.adminRole)

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
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    const now = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, {
      consentSignName: signData.name || '',
      consentSignTime: now,
      consentSignImage: signData.image || '',
      consentPhotoAuth1: signData.photoAuth1 === true,
      consentPhotoAuth2: signData.photoAuth2 === true,
      updatedAt: now
    })
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
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    if (!canTransitionStatus(booking, newStatus)) {
      console.warn('[状态流转] 已阻止非法变更:', booking._status, '→', newStatus)
      return Promise.reject(new Error('不允许跳过或回退状态'))
    }
    if (booking._status === newStatus) return Promise.resolve(booking)
    const now = new Date().toISOString()
    const cloudData = { _status: newStatus, updatedAt: now }
    if (booking.checkInAt) cloudData.checkInAt = booking.checkInAt
    if (booking.consentSignTime) cloudData.consentSignTime = booking.consentSignTime
    return this._commitBookingUpdate(bookingId, cloudData)
  },

  cancelBooking(bookingId, reason) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    if (booking._status !== 'confirmed') return Promise.reject(new Error('当前状态不可取消'))
    const now = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, {
      _status: 'cancelled',
      _cancelReason: reason,
      updatedAt: now
    })
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
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    const now = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, { _adminNote: note, updatedAt: now })
  },

  addFollowUpRecord(bookingId, content) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    const newRecord = { date: new Date().toISOString(), content: content }
    const records = [...(booking._followUpRecords || []), newRecord]
    const now = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, {
      _followUpRecords: records,
      updatedAt: now
    })
  },

  updateCustomerInfo(bookingId, data) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    const cloudData = {}
    if (data.adminNote !== undefined) cloudData._adminNote = data.adminNote
    cloudData.updatedAt = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, cloudData)
  },

  // 更新黄色字段（批量）
  updateStaffData(bookingId, data) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    const yellowFields = [
      '_clientManager', '_totalEnergy', '_shotDistribution', '_maxLevel',
      '_immediateSatisfaction', '_comfortSatisfaction',
      '_productFeedback', '_day30FollowUp', '_day90FollowUp'
    ]
    const cloudData = {}
    yellowFields.forEach(key => {
      if (data[key] !== undefined) cloudData[key] = data[key]
    })
    if (data.deviceModel !== undefined) cloudData.deviceModel = data.deviceModel
    if (data._photos !== undefined) cloudData._photos = data._photos
    if (data._beforePhotos !== undefined) cloudData._beforePhotos = data._beforePhotos
    if (data._beforeFrontPhotos !== undefined) cloudData._beforeFrontPhotos = data._beforeFrontPhotos
    if (data._beforeSidePhotos !== undefined) cloudData._beforeSidePhotos = data._beforeSidePhotos
    if (data._immediatePhotos !== undefined) cloudData._immediatePhotos = data._immediatePhotos
    if (data._day30Photos !== undefined) cloudData._day30Photos = data._day30Photos
    if (data._day90Photos !== undefined) cloudData._day90Photos = data._day90Photos
    if (data._status !== undefined) {
      if (!canTransitionStatus(booking, data._status)) {
        return Promise.reject(new Error('不允许跳过或回退状态'))
      }
      cloudData._status = data._status
    }
    cloudData.updatedAt = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, cloudData)
  },

  // 更新客户灰色字段（用户在知情同意书等场景自动补全后回写）
  updateCustomerFields(bookingId, data) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    const grayFields = ['name', 'gender', 'age', 'idCard', 'phone']
    const cloudData = {}
    grayFields.forEach(key => {
      if (data[key] !== undefined && data[key] !== null) {
        cloudData[key] = data[key]
      }
    })
    if (Object.keys(cloudData).length === 0) return Promise.resolve(booking)
    cloudData.updatedAt = new Date().toISOString()
    return this._commitBookingUpdate(bookingId, cloudData)
  },

  addPhoto(bookingId, photo) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    const photos = [...(booking._photos || []), photo]
    return this._commitBookingUpdate(bookingId, {
      _photos: photos,
      updatedAt: new Date().toISOString()
    })
  },

  removePhoto(bookingId, index) {
    const booking = this._find(bookingId)
    if (!booking) return Promise.reject(new Error('预约记录不存在'))
    const photos = [...(booking._photos || [])]
    photos.splice(index, 1)
    return this._commitBookingUpdate(bookingId, {
      _photos: photos,
      updatedAt: new Date().toISOString()
    })
  },

  // 将本机临时图片上传到云存储；已经是云文件或网络图片时直接复用。
  uploadImage(filePath, folder) {
    const path = String(filePath || '').trim()
    if (!path) return Promise.reject(new Error('图片路径为空'))
    if (/^(cloud:\/\/|https?:\/\/)/.test(path)) return Promise.resolve(path)
    const safeFolder = String(folder || 'common').replace(/[^A-Za-z0-9/_-]/g, '_')
    const cleanPath = path.split('?')[0]
    const match = cleanPath.match(/\.([A-Za-z0-9]{2,5})$/)
    const ext = match ? match[1].toLowerCase() : 'jpg'
    const cloudPath = `uploads/${safeFolder}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`
    return wx.cloud.uploadFile({ cloudPath, filePath: path }).then(res => {
      if (!res || !res.fileID) throw new Error('图片上传失败')
      return res.fileID
    })
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

    wx.cloud.callFunction({
      name: 'getOpenId',
      timeout: 15000,
      success: res => {
        const openid = res.result && res.result.openid
        if (openid) {
          this._activateIdentity(openid)
          console.log('[云开发] 获取 openId 成功:', openid.substring(0, 10) + '...')
        }
        finish(openid || '')
      },
      fail: (err) => {
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

    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const daysDiff = (dateStr) => {
      const d1 = new Date(dateStr + 'T00:00:00')
      const d2 = new Date(today + 'T00:00:00')
      return Math.floor((d2 - d1) / 86400000)
    }

    return (this.globalData.bookings || [])
      .filter(b => {
        // 用户视角始终只显示本人预约；管理员查看全部记录只能走管理页面。
        if (myOpenId) {
          // _openid 是当前预约归属；操作师代预约后，顾客签到会把它绑定到顾客微信。
          const ownerOpenId = b._openid || b._creatorOpenId || ''
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
        // 护理须知按体验日期触发。
        const getAvailable = (diff) => {
          const items = []
          if (diff >= 1) items.push({ mode: '24h', label: '24小时' })
          if (diff >= 30) items.push({ mode: '30', label: '30天' })
          if (diff >= 90) items.push({ mode: '90', label: '90天' })
          return items
        }
        // 护理须知：按时间触发，不受填写状态影响
        const availableAftercares = getAvailable(diff)
        const canAftercare = availableAftercares.length > 0 && (b._status === 'visited' || b._status === 'in_experience' || b._status === 'completed')
        const photoUploadStages = []
        if (diff >= 30) photoUploadStages.push({ stage: '30', label: '上传30天照片' })
        if (diff >= 90) photoUploadStages.push({ stage: '90', label: '上传90天照片' })
        const canUploadFollowupPhotos = photoUploadStages.length > 0 &&
          (b._status === 'visited' || b._status === 'in_experience' || b._status === 'completed')
        const reminderStages = []
        if (b._status === 'pending_confirm') reminderStages.push('appointment')
        if (['pending_confirm', 'confirmed', 'visited', 'in_experience', 'completed'].includes(b._status)) {
          // 与云端30天重试窗口保持一致，失败期间允许客户再次补充订阅授权。
          if (!b._reminder30SentAt && diff < 60) reminderStages.push('day30')
          if (!b._reminder90SentAt && diff < 120) reminderStages.push('day90')
        }
        const reminderNames = reminderStages.map(stage => ({
          appointment: '预约结果',
          day30: '30天照片',
          day90: '90天照片'
        })[stage])
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
          canAftercare: canAftercare,
          availableAftercares: availableAftercares,
          canUploadFollowupPhotos: canUploadFollowupPhotos,
          photoUploadStages: photoUploadStages,
          canSubscribeReminders: reminderStages.length > 0,
          reminderStages: reminderStages,
          reminderText: reminderNames.join('、') + '提醒',
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
      'Day30回访', 'Day90回访',
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
      esc(b._productFeedback), esc(b._day30FollowUp), esc(b._day90FollowUp),
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
