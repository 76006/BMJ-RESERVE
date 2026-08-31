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
    db: null,             // 云开发数据库实例
    _: null,              // 云数据库 command
    _useCloud: true,      // 是否使用云数据库（默认开启）
    _cloudReady: false,   // 云数据库是否就绪
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

    // 自动初始化数据库集合（仅首次执行）
    this._initCollections()

    // 读取扫码scene参数（小程序码带参进入）
    this._applyScanScene(options)

    // 从 localStorage 恢复管理员状态
    if (wx.getStorageSync('_isAdmin')) {
      this.globalData.isAdmin = true
    }

    // 数据库集合初始化 + 加载预约记录（在 _initCollections 中触发）
    // 获取 openId 并检查管理员白名单（优先用本地缓存，避免启动时超时）
    this._checkAdminByOpenId()
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
    // 管理员认证扫码
    if (q.admin && q.token) {
      this._handleAdminScan(q.token)
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
    // 开发工具/真机调试：跳过 setupDB（云端集合已建好），直接走本地/云端数据
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')

    if (isDevtools || wx.getStorageSync('_dbInited_v2')) {
      this._loadBookingsFromCloud()
      return
    }
    wx.cloud.callFunction({
      name: 'setupDB',
      success: res => {
        console.log('[云开发] 数据库集合初始化:', JSON.stringify(res.result))
        wx.setStorageSync('_dbInited_v2', true)
        this._loadBookingsFromCloud()
      },
      fail: err => {
        console.warn('[云开发] setupDB失败，仍尝试加载数据:', err)
        this._loadBookingsFromCloud()
      }
    })
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
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')
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
          if (data.length === 0) {
            const local = wx.getStorageSync('bookings') || []
            if (local.length > 0) {
              console.log('[云开发] 检测到本地数据，开始迁移...')
              self._migrateLocalToCloud(local)
            }
          }
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
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')
    if (isDevtools) {
      console.log('[演示模式] 开发工具：清除本地缓存，加载最新演示数据')
      wx.removeStorageSync('bookings')
      this._seedDemoData()
      return
    }
    const bookings = wx.getStorageSync('bookings') || []
    if (bookings.length === 0) {
      this._seedDemoData()
    } else {
      this.globalData.bookings = bookings
    }
  },

  // 本地数据 → 云数据库迁移
  async _migrateLocalToCloud(localData) {
    const db = this.globalData.db
    for (const item of localData) {
      try {
        await db.collection('bookings').add({ data: item })
      } catch (e) {
        console.error('[迁移] 单条失败:', item.id, e && e.message ? e.message : e)
      }
    }
    // 迁移完成后重新加载（仅加载本人的）
    var self = this
    var openid = this.globalData.openId || ''
    var timer = setTimeout(() => {
      console.warn('[迁移] 重新加载超时，使用本地数据')
    }, 4500)
    var query = openid
      ? db.collection('bookings').where({ _openid: openid }).limit(200).get()
      : db.collection('bookings').limit(200).get()
    query.then(res => {
      clearTimeout(timer)
      var data = res.data || []
      data.sort(function(a, b) {
        var ta = a.createdAt || 0
        var tb = b.createdAt || 0
        return tb.localeCompare ? tb.localeCompare(ta) : (tb > ta ? -1 : 1)
      })
      self.globalData.bookings = data
      console.log('[迁移] 完成，共 ' + data.length + ' 条')
      wx.showToast({ title: '数据已同步到云端', icon: 'success' })
    }).catch(err => {
      clearTimeout(timer)
      console.warn('[迁移] 重新加载失败:', err && err.message ? err.message : err)
    })
  },

  // ===========================================
  // 创建体验记录（用户提交）
  // ===========================================
  // 提交预约（异步：确保 openId 就绪后再写入，修复竞态风险）
  addBooking(userData, callback) {
    var self = this
    this.getOpenId(function (openid) {
      const booking = {
      id: Date.now().toString(36),

      // === 灰色：用户填写 ===
      name: userData.name,
      gender: userData.gender,
      age: userData.age,
      idCard: userData.idCard || '',          // 身份证号
      visitDate: userData.visitDate,
      visitTime: userData.visitTime || '',    // 时间段，如 "14:00-15:00"
      medicalHistory: userData.medicalHistory || '',
      needs: userData.needs || '',
      phone: userData.phone || '',

      // === 来源渠道（扫码带入）===
      channel: self.globalData.channel || 'direct',
      trainerId: self.globalData.trainerId || '',
      trainerName: self.globalData.trainerName || '',

      // === 知情同意书 ===
      consentSignName: userData.consentSignName || '',
      consentSignTime: userData.consentSignTime || '',
      consentSignImage: userData.consentSignImage || '',

      // === 系统自动 ===
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _creatorOpenId: openid || '',  // 创建者openId（用于用户端数据隔离，确保异步就绪）

      // === 黄色：工作人员填写 ===
      _status: 'pending_confirm',             // 初始状态：待操作师确认
      _confirmedAt: '',                       // 操作师确认时间
      _confirmedBy: '',                       // 确认人
      deviceModel: '',                        // 设备型号（签到时录入）
      checkInAt: '',                          // 签到时间
      _clientManager: '',
      _totalEnergy: '',
      _shotDistribution: '',
      _maxLevel: '',
      _immediateSatisfaction: 0,   // 1-5分
      _comfortSatisfaction: 0,      // 1-5分
      _photos: [],                  // [{path, name}]
      _beforePhotos: [],             // [{path, name}] 体验前
      _halfPhotos: [],               // [{path, name}] 半侧脸对比
      _afterPhotos: [],              // [{path, name}] 体验后
      _productFeedback: '',
      _day1FollowUp: '',
      _day30FollowUp: '',
      _day90FollowUp: '',

      // === 管理员通用 ===
      _adminNote: '',
      _followUpRecords: [],
      _feedback24: false,  // 24h回访是否已提交
      _feedback30: false,  // 30天回访是否已提交
      _feedback90: false   // 90天回访是否已提交
      }

      self.globalData.bookings.unshift(booking)

      // 同步写入云数据库
      const db = self.globalData.db
      if (db) {
        db.collection('bookings').add({ data: booking })
          .then(res => {
            booking._cloudId = res._id
            console.log('[云开发] 新增预约:', res._id)
            self._saveLocal()
          })
          .catch(err => { console.warn('[云开发] 新增失败:', err) })
      } else {
        self._saveLocal()
      }

      // 保存用户画像（用于新老客户识别）
      self.saveUserProfile({
        name: userData.name || '',
        gender: userData.gender || '',
        age: userData.age || '',
        phone: userData.phone || ''
      })

      if (callback) callback(booking)
    })  // end getOpenId
  },

  // ===========================================
  // 管理员操作
  // ===========================================
  // 统一更新云数据库（通过业务id查找并更新）
  _updateCloud(bookingId, updateData) {
    const db = this.globalData.db
    if (!db) return
    const booking = this._find(bookingId)
    if (!booking) return

    if (booking._cloudId) {
      // 已知云端文档ID，直接更新
      db.collection('bookings').doc(booking._cloudId).update({ data: updateData })
        .then(() => console.log('[云开发] 更新成功:', bookingId))
        .catch(err => console.warn('[云开发] 更新失败:', err))
    } else {
      // 查找云端文档
      db.collection('bookings').where({ id: bookingId }).limit(1).get()
        .then(res => {
          if (res.data && res.data[0]) {
            booking._cloudId = res.data[0]._id
            return db.collection('bookings').doc(res.data[0]._id).update({ data: updateData })
          }
        })
        .then(() => console.log('[云开发] 更新成功:', bookingId))
        .catch(err => console.warn('[云开发] 更新失败:', err))
    }
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
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')

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
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')

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

      const db = self.globalData.db
      if (!db) { buildFromLocal(); return }

      const _ = self.globalData._
      if (!_) { buildFromLocal(); return }

      db.collection('bookings')
        .where({
          visitDate: date,
          _status: _.nin(['cancelled', 'no_show', 'rejected'])
        })
        .field({ visitTime: true, name: true, _status: true })
        .limit(200)
        .get()
        .then(res => {
          const map = {}
          ;(res.data || []).forEach(b => {
            map[b.visitTime] = { name: b.name || '', status: b._status || '' }
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

  // ===========================================
  // 管理员认证（openId 白名单 + 旧密码方式降级）
  // ===========================================
  // 启动时自动获取 openId 并检查管理员身份（优先用本地缓存，避免启动超时）
  _checkAdminByOpenId() {
    // 开发工具环境：跳过云端查询，避免超时干扰
    const sys = wx.getSystemInfoSync()
    if (sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')) {
      // 仅在本地已缓存管理员状态时恢复
      if (wx.getStorageSync('_isAdmin')) {
        this.globalData.isAdmin = true
        this.globalData.adminName = wx.getStorageSync('_adminName') || '\u7ba1\u7406\u5458'
        this.globalData.adminRole = wx.getStorageSync('_adminRole') || 'staff'
      }
      return
    }
    // 已登录过的管理员直接恢复状态，不查云端
    if (wx.getStorageSync('_isAdmin')) {
      this.globalData.isAdmin = true
      this.globalData.adminName = wx.getStorageSync('_adminName') || '\u7ba1\u7406\u5458'
      this.globalData.adminRole = wx.getStorageSync('_adminRole') || 'staff'
      this.globalData.adminPhone = wx.getStorageSync('_adminPhone') || ''
      return
    }
    var self = this
    this.getOpenId(function (openid) {
      if (!openid) {
        console.warn('[管理员] 获取 openId 失败，降级到本地认证')
        return
      }
      self._recordVisitor(openid)
      var db = self.globalData.db
      if (!db) return
      // 云端查询：增加超时保护，避免因缺少索引导致启动卡死
      var timer = setTimeout(function () {
        console.warn('[管理员] 白名单查询超时（可能缺少索引），跳过')
      }, 4500)
      db.collection('admins').where({ openId: openid, active: true }).limit(1).get()
        .then(function (res) {
          clearTimeout(timer)
          if (res.data && res.data.length > 0) {
            var admin = res.data[0]
            self._setAdminState(admin)
          } else {
            // openId 未匹配 → 尝试按手机号匹配（新添加的操作师首次登录）
            self._tryLoginByPhone(db, openid)
          }
        })
        .catch(function (err) {
          clearTimeout(timer)
          console.warn('[管理员] 白名单查询失败（索引缺失或超时）:', err && err.message ? err.message : err)
        })
    })
  },

  // 设置管理员状态（统一入口）
  _setAdminState(admin) {
    this.globalData.isAdmin = true
    this.globalData.adminName = admin.name || '\u7ba1\u7406\u5458'
    this.globalData.adminRole = admin.role || 'staff'
    this.globalData.adminPhone = admin.phone || ''
    wx.setStorageSync('_isAdmin', true)
    wx.setStorageSync('_adminName', admin.name || '\u7ba1\u7406\u5458')
    wx.setStorageSync('_adminRole', admin.role || 'staff')
    wx.setStorageSync('_adminPhone', admin.phone || '')
    console.log('[管理员] 已认证:', admin.name, admin.role, admin.phone)

    // 新认证的管理员：重新加载全部预约（之前只加载了自己的）
    if (this.globalData._cloudReady && this.globalData.bookings.length < 50) {
      console.log('[管理员] 重新加载全部预约记录')
      this._loadAllBookingsAsAdmin()
    }
  },

  // 按手机号匹配并绑定 openId（新添加的人员首次登录时自动绑定）
  _tryLoginByPhone(db, openid, callback) {
    var userPhone = wx.getStorageSync('_userPhone') || ''
    if (!userPhone) { if (callback) callback(false); return }
    var self = this
    db.collection('admins').where({ phone: userPhone, active: true }).limit(1).get()
      .then(function (res) {
        if (res.data && res.data.length > 0) {
          var admin = res.data[0]
          // 自动绑定 openId（如果尚未绑定或变更了设备）
          db.collection('admins').doc(admin._id).update({
            data: { openId: openid, updatedAt: new Date().toISOString() }
          }).then(function () {
            console.log('[管理员] 手机号匹配成功，已自动绑定 openId:', admin.name, admin.role)
            self._setAdminState(admin)
            if (callback) callback(true)
          }).catch(function (err) {
            console.warn('[管理员] openId 绑定失败，但仍可临时认证:', err && err.message)
            self._setAdminState(admin)
            if (callback) callback(true)
          })
        } else {
          console.log('[管理员] 手机号 ' + userPhone + ' 未在白名单中')
          if (callback) callback(false)
        }
      })
      .catch(function (err) {
        console.warn('[管理员] 手机号查询失败:', err && err.message ? err.message : err)
        if (callback) callback(false)
      })
  },

  // 记录访客到 users 集合（首次写入，老访客更新 lastVisit）
  _recordVisitor(openid) {
    const db = this.globalData.db
    if (!db) return
    var timer = setTimeout(function () {
      console.warn('[访客] 记录查询超时（可能缺少索引），跳过')
    }, 4500)
    db.collection('users').where({ openId: openid }).limit(1).get()
      .then(res => {
        clearTimeout(timer)
        if (res.data && res.data.length === 0) {
          db.collection('users').add({
            data: {
              openId: openid,
              firstVisit: new Date().toISOString(),
              lastVisit: new Date().toISOString(),
              visitCount: 1
            }
          }).then(() => console.log('[访客] 已记录新访客'))
        } else if (res.data[0]) {
          const doc = res.data[0]
          db.collection('users').doc(doc._id).update({
            data: {
              lastVisit: new Date().toISOString(),
              visitCount: (doc.visitCount || 0) + 1
            }
          })
        }
      })
      .catch(err => {
        clearTimeout(timer)
        console.warn('[访客] 记录失败（索引缺失或超时）:', err && err.message ? err.message : err)
      })
  },

  // 获取所有访客列表（供管理员管理页面使用）
  getAllUsers(callback) {
    const db = this.globalData.db
    if (!db) { callback([]); return }
    var timer = setTimeout(function () {
      console.warn('[getAllUsers] 查询超时（users 缺少索引或数据量大）')
      callback([])
    }, 4500)
    db.collection('users').where({}).limit(200).get()
      .then(res => {
        clearTimeout(timer)
        var data = res.data || []
        data.sort(function(a, b) {
          var ta = (a.lastVisit || a.firstVisit || '').toString()
          var tb = (b.lastVisit || b.firstVisit || '').toString()
          return tb.localeCompare(ta)
        })
        callback(data)
      })
      .catch(function (err) {
        clearTimeout(timer)
        console.warn('[getAllUsers] 读取失败:', err && err.message ? err.message : err)
        callback([])
      })
  },

  // 获取所有管理员列表
  getAllAdmins(callback) {
    const db = this.globalData.db
    if (!db) { callback([]); return }
    var timer = setTimeout(function () {
      console.warn('[getAllAdmins] 查询超时（admins 缺少索引或数据量大）')
      callback([])
    }, 4500)
    db.collection('admins').where({}).limit(200).get()
      .then(res => {
        clearTimeout(timer)
        var data = res.data || []
        data.sort(function(a, b) {
          var ta = (a.createdAt || '').toString()
          var tb = (b.createdAt || '').toString()
          return tb.localeCompare(ta)
        })
        callback(data)
      })
      .catch(function (err) {
        clearTimeout(timer)
        console.warn('[getAllAdmins] 读取失败:', err && err.message ? err.message : err)
        callback([])
      })
  },

  // 移除管理员（设为 inactive）
  removeAdmin(openId, callback) {
    const db = this.globalData.db
    if (!db) { callback(false); return }
    db.collection('admins').where({ openId: openId }).limit(1).get()
      .then(res => {
        if (res.data && res.data[0]) {
          db.collection('admins').doc(res.data[0]._id).update({
            data: { active: false }
          }).then(() => callback(true))
            .catch(function (err) {
              console.warn('[removeAdmin] 更新失败:', err && err.message ? err.message : err)
              callback(false)
            })
        } else {
          callback(false)
        }
      })
      .catch(function (err) {
        console.warn('[removeAdmin] 查询失败:', err && err.message ? err.message : err)
        callback(false)
      })
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

  /**
   * 手机号登录 — 设置管理员状态
   * @param {Object} result - 云函数返回 {role, name, phone}
   */
  setAdminByPhone(result) {
    if (!result || !result.phone) return

    // 保存用户手机号（无论是否管理员）
    wx.setStorageSync('_phoneVerified', true)
    wx.setStorageSync('_userPhone', result.phone)

    if (result.role === 'staff' || result.role === 'superadmin') {
      this.globalData.isAdmin = true
      this.globalData.adminName = result.name || '管理员'
      this.globalData.adminRole = result.role
      this.globalData.adminPhone = result.phone
      wx.setStorageSync('_isAdmin', true)
      wx.setStorageSync('_adminName', result.name || '管理员')
      wx.setStorageSync('_adminRole', result.role)
      wx.setStorageSync('_adminPhone', result.phone)
      console.log(`[手机号登录] 管理员: ${result.name} (${result.role}) phone=${result.phone}`)
    } else {
      // 普通用户，更新用户画像
      const profile = this.getUserProfile()
      if (profile) {
        profile.phone = result.phone
        this.saveUserProfile(profile)
      } else {
        this.saveUserProfile({ name: '', gender: '', phone: result.phone })
      }
      console.log(`[手机号登录] 普通用户 phone=${result.phone}`)
    }
  },

  // 手动添加管理员到白名单（首次设置用）
  addAdmin(openId, name, role) {
    const db = this.globalData.db
    if (!db) return
    db.collection('admins').add({
      data: {
        openId: openId,
        name: name || '管理员',
        role: role || 'staff',   // superadmin / staff
        active: true,
        createdAt: new Date().toISOString()
      }
    }).then(res => {
      console.log('[管理员] 已添加白名单:', name, '角色:', role, res._id)
    }).catch(err => {
      console.warn('[管理员] 添加失败:', err)
    })
  },

  // 旧密码认证（降级备用）
  _handleAdminScan(token) {
    const admins = wx.getStorageSync('_admins') || []
    const match = admins.find(a => a.token === token)
    if (match) {
      this.globalData.isAdmin = true
      wx.setStorageSync('_isAdmin', true)
      wx.setStorageSync('_adminName', match.name || '')
      wx.showToast({ title: '管理员认证成功', icon: 'success', duration: 1500 })
    } else {
      // token不匹配，提示输入密码
      wx.showModal({
        title: '管理员认证',
        editable: true,
        placeholderText: '请输入管理员密码',
        success: (res) => {
          if (res.confirm && res.content) {
            const admins2 = wx.getStorageSync('_admins') || []
            const m2 = admins2.find(a => this._adminHash(res.content) === token)
            if (m2) {
              this.globalData.isAdmin = true
              wx.setStorageSync('_isAdmin', true)
              wx.setStorageSync('_adminName', m2.name || '')
              wx.showToast({ title: '认证成功', icon: 'success' })
            }
          }
        }
      })
    }
  },

  // 生成管理员token（供qrconfig使用）
  generateAdminToken(password, name) {
    return this._adminHash(password + '_' + name)
  },

  _adminHash(s) {
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i)
      h = h & h
    }
    return 'a_' + Math.abs(h).toString(36)
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

  updateBookingStatus(bookingId, newStatus) {
    const booking = this._find(bookingId)
    if (!booking) return false
    booking._status = newStatus
    booking.updatedAt = new Date().toISOString()
    this._saveLocal()
    this._updateCloud(bookingId, { _status: newStatus, updatedAt: booking.updatedAt })
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

  // 重新预约：基于已取消的旧记录新建预约（复制客户信息，新生成记录ID）
  // 异步获取 openId 确保隐私隔离（避免继承旧记录的空 openId）
  // @param {string} oldBookingId - 旧预约ID
  // @param {function} callback - 新booking加入globalData后回调（避免调用方在异步完成前刷新数据）
  rebook(oldBookingId, callback) {
    const old = this._find(oldBookingId)
    if (!old) {
      if (callback) callback(null)
      return null
    }
    const self = this
    // 先尝试获取当前用户的 openId，确保新记录的隐私隔离正确
    this.getOpenId(function(openid) {
      const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const newBooking = {
        id: newId,
        name: old.name,
        gender: old.gender,
        age: old.age,
        idCard: old.idCard || '',
        phone: old.phone,
        medicalHistory: old.medicalHistory || '',
        needs: old.needs || '',
        visitDate: '',
        visitTime: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _status: 'pending_confirm',
        _clientManager: '',
        _totalEnergy: '', _shotDistribution: '', _maxLevel: '',
        _immediateSatisfaction: 0, _comfortSatisfaction: 0,
        _photos: [], _beforePhotos: [], _halfPhotos: [], _afterPhotos: [],
        _productFeedback: '', _day1FollowUp: '', _day30FollowUp: '', _day90FollowUp: '',
        _adminNote: '', _followUpRecords: [],
        _creatorOpenId: openid || old._creatorOpenId || '',
        _feedback24: false, _feedback30: false, _feedback90: false
      }
      self.globalData.bookings.unshift(newBooking)
      self._saveLocal()
      // 回调在本地数据就绪后立即触发，不等待云端写入
      if (callback) callback(newId)

      // 新增记录必须用 add，不能用 _updateCloud（后者只 update 已有文档）
      const db = self.globalData.db
      if (db) {
        db.collection('bookings').add({ data: newBooking })
          .then(res => {
            newBooking._cloudId = res._id
            console.log('[云开发] 重新预约新增:', res._id)
            self._saveLocal()
          })
          .catch(err => { console.warn('[云开发] 重新预约新增失败:', err) })
      }
    })
    // 无回调时返回标记以保持旧调用兼容
    if (!callback) return 'rebook_pending'
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
  getOpenId(callback) {
    if (this.globalData.openId) {
      callback(this.globalData.openId)
      return
    }

    // 开发工具/真机调试：直接返回 mock openId，避免云端调用超时影响调试
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')
    if (isDevtools) {
      const mockOpenId = 'mock_openid_' + Date.now()
      this.globalData.openId = mockOpenId
      console.log('[开发工具] 使用 mock openId:', mockOpenId)
      callback(mockOpenId)
      return
    }

    let called = false
    const safeCallback = (openid) => {
      if (called) return
      called = true
      callback(openid || '')
    }
    // 超时兜底：3秒后强制回调，避免主流程卡死
    const timer = setTimeout(() => {
      console.warn('[云开发] getOpenId 超时，使用空 openId 继续')
      safeCallback('')
    }, 3000)

    wx.cloud.callFunction({
      name: 'getOpenId',
      success: res => {
        clearTimeout(timer)
        const openid = res.result && res.result.openid
        if (openid) {
          this.globalData.openId = openid
          console.log('[云开发] 获取 openId 成功:', openid.substring(0, 10) + '...')
        }
        safeCallback(openid || '')
      },
      fail: (err) => {
        clearTimeout(timer)
        console.warn('[云开发] getOpenId 调用失败:', err)
        safeCallback('')
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
        // 管理员可以看到所有记录
        if (this.globalData.isAdmin) return true
        // 有openId时按openId过滤
        if (myOpenId && b._creatorOpenId) {
          return b._creatorOpenId === myOpenId
        }
        // 无openId时按手机号后4位匹配（兼容旧数据/演示数据）
        if (myPhone) {
          const bp = cleanPhone(b.phone)
          const mp = cleanPhone(myPhone)
          if (bp.length >= 4 && mp.length >= 4 && bp.slice(-4) === mp.slice(-4)) return true
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
