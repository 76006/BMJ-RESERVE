// 顾客签到页（扫门店签到码 → 自动识别预约 → 内嵌知情同意书 → 完成）
// 自动识别逻辑：
//   1. 新版小程序码直接进入本页并携带 scene；旧版码仍由 app.js 首页中转兼容
//   2. 无 bookingId 时：从 userProfile 取手机号，先本地匹配今日预约（暖启动即时），
//      本地未命中 → 再云端按「手机号 + 今日」查询未签到预约（修复冷启动时序 + 兼容操作师代下）
//   3. 仍无匹配：进入 not_found，提供"手动选择今日预约"兜底列表
// 数据补全：匹配到手机号后，自动从历史 booking 记录中提取姓名/性别/年龄/身份证等字段

function parseScene(raw) {
  const result = {}
  if (!raw) return result

  let decoded = String(raw)
  try {
    decoded = decodeURIComponent(decoded)
  } catch (err) {
    console.warn('[签到] scene 解码失败，使用原值:', err)
  }

  decoded.split('&').forEach(item => {
    if (!item) return
    const index = item.indexOf('=')
    const key = index >= 0 ? item.slice(0, index) : item
    const value = index >= 0 ? item.slice(index + 1) : ''
    if (!key) return
    try {
      result[decodeURIComponent(key)] = decodeURIComponent(value)
    } catch (err) {
      result[key] = value
    }
  })
  return result
}

Page({
  data: {
    // 页面状态: loading | confirm | consent | done | error | rejected | not_found
    step: 'loading',

    // 当前预约
    booking: null,
    today: '',

    // not_found 兜底：今日可签到的预约列表（供手动选择）
    todayBookings: [],
    needsPhoneAuth: false,
    authorizing: false,

    // 自动补全后的展示数据（合并当前预约 + 历史记录）
    bookingData: {
      name: '', gender: '', age: '', idCard: '', phone: '',
      visitDate: '', visitTime: ''
    },

    // 知情同意书滚动与签署
    scrolledBottom: false,
    allRead: true,

    // 摄影授权（默认勾选）
    photoAuth1: true,
    photoAuth2: true,

    // 体验确认弹窗
    showExperienceModal: false,
    // 选"是"后的欢迎文案
    welcomeText: ''
  },

  onLoad(options) {
    options = options || {}
    const app = getApp()
    const today = this._fmtDate(new Date())
    this.setData({ today })
    // wxacode.getUnlimited 的 scene 在直接打开目标页时由页面 onLoad 接收。
    // 同时兼容普通链接参数和旧版首页中转传入的 id。
    const rawScene = options.scene || (options.query && options.query.scene) || ''
    const scene = parseScene(rawScene)
    this._pendingBookingId = String(options.id || options.bookingId || scene.id || '').trim()

    // 情况1：预约专属小程序码传入 bookingId。
    // 始终由云端校验该预约是否属于当前微信，避免本地缓存误认。
    if (this._pendingBookingId) {
      this._resolveById(this._pendingBookingId)
      return
    }

    // 情况2：扫门店签到码，从 userProfile 自动匹配今日预约
    //   优先用本地已加载的预约（暖启动即时匹配）；
    //   若本地无匹配，再走云端按手机号查询（修复冷启动时序、兼容操作师代下）
    const profile = app.getUserProfile()
    if (profile && profile.phone) {
      const matched = this._matchTodayBooking(profile.phone, today)
      if (matched) {
        const merged = this._mergeCustomerData(matched)
        this.setData({ step: 'confirm', booking: merged, bookingData: merged })
        return
      }
    }

    // 情况3：本地未匹配 → 云端按手机号查询今日未签到预约（兜底）
    this._resolveByCloud(profile && profile.phone ? profile.phone : '', today)
  },

  // 冷启动扫码时本地预约尚未加载，按预约编号从服务端安全读取本人预约。
  _resolveById(bookingId) {
    const app = getApp()
    this.setData({ step: 'loading' })
    wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'getForCheckin', bookingId }
    }).then(res => {
      const result = res.result || {}
      if (!result.success || !result.data) {
        this.setData({
          step: 'not_found',
          todayBookings: [],
          needsPhoneAuth: result.requiresPhoneAuth === true
        })
        wx.showToast({ title: result.error || '未找到可签到预约', icon: 'none' })
        return
      }
      const booking = result.data
      const all = app.globalData.bookings || []
      if (!all.some(item => item.id === booking.id)) all.unshift(booking)
      app.globalData.bookings = all
      const merged = this._mergeCustomerData(booking)
      this.setData({ step: 'confirm', booking: merged, bookingData: merged, needsPhoneAuth: false })
    }).catch(err => {
      console.warn('[签到] 按预约编号查询失败:', err)
      this.setData({ step: 'not_found', todayBookings: [], needsPhoneAuth: false })
    })
  },

  // 云端按"手机号 + 今日"查询未签到预约
  // 修复冷启动时序：不依赖 globalData.bookings 异步加载完成，云端现查现用；
  // 同时兼容"操作师代客下单"：按手机号匹配，不受 openId / 创建者隔离影响。
  _resolveByCloud(phone, today) {
    const app = getApp()
    const self = this
    this.setData({ step: 'loading' })

    this._fetchTodayByPhone(phone, today).then(function (cloudBookings) {
      // 合并云端结果到本地缓存，保证手动选择 / 后续读取一致
      if (cloudBookings.length > 0) {
        const all = app.globalData.bookings || []
        const ids = {}
        all.forEach(b => { ids[b.id] = true })
        cloudBookings.forEach(function (cb) {
          if (!ids[cb.id]) { all.unshift(cb); ids[cb.id] = true }
        })
        app.globalData.bookings = all
      }

      // 仅1条 → 自动匹配进入签署；多条 → 展示手动选择列表；0条 → 兜底
      if (cloudBookings.length === 1) {
        const merged = self._mergeCustomerData(cloudBookings[0])
        self.setData({ step: 'confirm', booking: merged, bookingData: merged, needsPhoneAuth: false })
        return
      }
      if (cloudBookings.length > 1) {
        const list = self._getTodayBookings(today, cloudBookings)
        self.setData({ step: 'not_found', todayBookings: list, needsPhoneAuth: false })
        return
      }

      // 云端也无匹配 → not_found，附带"手动选择今日预约"兜底（尽力用本地数据）
      const fallback = self._getTodayBookings(today)
      self.setData({ step: 'not_found', todayBookings: fallback, needsPhoneAuth: false })
    }).catch(function (err) {
      console.warn('[签到] 云端查询失败，降级到本地:', err)
      const fallback = self._getTodayBookings(today)
      self.setData({
        step: 'not_found',
        todayBookings: fallback,
        needsPhoneAuth: err && err.requiresPhoneAuth === true
      })
    })
  },

  // 云端查询：服务端只使用当前微信已验证手机号，不信任客户端传入手机号。
  _fetchTodayByPhone(phone, today) {
    return wx.cloud.callFunction({
      name: 'bookingService',
      data: { action: 'listToday', visitDate: today }
    }).then(function (res) {
        const result = res.result || {}
        if (!result.success) {
          const error = new Error(result.error || '查询失败')
          error.requiresPhoneAuth = result.requiresPhoneAuth === true
          throw error
        }
        return result.data || []
      })
  },

  // 首次使用当前微信签到时，现场授权预约手机号；云端验证后会自动绑定操作师代下的预约。
  onAuthorizePhone(e) {
    if (!e.detail || e.detail.errMsg !== 'getPhoneNumber:ok' || !e.detail.code) {
      wx.showToast({ title: '需要授权预约手机号才能识别预约', icon: 'none' })
      return
    }
    if (this.data.authorizing) return
    this.setData({ authorizing: true })
    wx.showLoading({ title: '正在验证...', mask: true })
    wx.cloud.callFunction({
      name: 'getPhoneNumber',
      data: { code: e.detail.code }
    }).then(res => {
      const result = res.result || {}
      if (!result.phone) throw new Error(result.error || '手机号验证失败')
      const app = getApp()
      if (app.cacheVerifiedPhone) app.cacheVerifiedPhone(result.phone)
      this.setData({ authorizing: false, needsPhoneAuth: false })
      wx.hideLoading()
      if (this._pendingBookingId) this._resolveById(this._pendingBookingId)
      else this._resolveByCloud(result.phone, this.data.today)
    }).catch(err => {
      wx.hideLoading()
      this.setData({ authorizing: false })
      wx.showToast({ title: err.message || '手机号验证失败', icon: 'none' })
    })
  },

  // ========== 数据自动补全：手机号匹配历史记录，合并字段 ==========
  _mergeCustomerData(currentBooking) {
    const app = getApp()
    const all = app.globalData.bookings || []
    const phone = (currentBooking.phone || '').replace(/\*/g, '').trim()

    if (!phone) {
      return Object.assign({}, currentBooking, {
        name: currentBooking.name || '',
        gender: currentBooking.gender || '',
        age: currentBooking.age || '',
        idCard: currentBooking.idCard || '',
        phone: currentBooking.phone || '',
        visitDate: currentBooking.visitDate || '',
        visitTime: currentBooking.visitTime || ''
      })
    }

    // 搜索所有历史上匹配此手机号的 booking（按时间倒序，最新的在前）
    const history = all
      .filter(b => {
        const bp = (b.phone || '').replace(/\*/g, '').trim()
        return bp === phone
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

    // 合并策略：优先取当前 booking 的值，空缺时从历史中取最新非空值
    const pick = (field) => {
      if (currentBooking[field]) return currentBooking[field]
      for (const h of history) {
        if (h[field]) return h[field]
      }
      return ''
    }

    return Object.assign({}, currentBooking, {
      name: pick('name'),
      gender: pick('gender'),
      age: pick('age'),
      idCard: pick('idCard'),
      phone: phone,
      visitDate: currentBooking.visitDate || '',
      visitTime: currentBooking.visitTime || ''
    })
  },

  // 自动匹配今日预约
  _matchTodayBooking(phone, today) {
    const app = getApp()
    const all = app.globalData.bookings || []
    const clean = s => (s || '').replace(/\*/g, '').trim()
    const p = clean(phone)

    const matches = all.filter(b => {
      if (b.visitDate !== today) return false
      if (b.checkInAt) return false
      const bp = clean(b.phone)
      return bp === p
    })

    return matches.length > 0 ? matches[0] : null
  },

  // 获取今日"可签到"的预约列表（用于 not_found 兜底手动选择）
  // 仅返回：今天、未签到、状态为已预约/已到店 的预约
  // @param {Array} [list] 可选，外部传入的预约列表（如云端按手机号查回的结果）；缺省回退到 globalData.bookings
  _getTodayBookings(today, list) {
    const app = getApp()
    const all = list || app.globalData.bookings || []
    const clean = s => (s || '').replace(/\*/g, '').trim()
    return all
      .filter(b => {
        if (b.visitDate !== today) return false
        if (b.checkInAt) return false
        // 仅展示已确认/已到店（签到需要 confirmed 状态；已到店 checkInAt 已过滤）
        if (b._status !== 'confirmed' && b._status !== 'visited') return false
        return true
      })
      .map(b => ({
        id: b.id,
        name: b.name || '未填写姓名',
        visitDate: b.visitDate,
        visitTime: b.visitTime || '',
        phone: clean(b.phone) || '',
        statusLabel: b._status === 'visited' ? '已到店' : '已预约'
      }))
  },

  // 手动选择某条今日预约 → 进入确认页
  selectBooking(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const app = getApp()
    const full = app.getBookingById(id)
    if (!full) {
      wx.showToast({ title: '预约不存在', icon: 'none' })
      return
    }
    // 防御：仅允许今天且未签到的预约进入签署流程
    const today = this.data.today
    if (full.visitDate !== today) {
      wx.showToast({ title: '该预约不是今天的', icon: 'none' })
      return
    }
    if (full.checkInAt) {
      wx.showToast({ title: '该预约已签到', icon: 'none' })
      // 从兜底列表中移除已签到项，避免重复选择
      const remain = this.data.todayBookings.filter(b => b.id !== id)
      this.setData({ todayBookings: remain })
      return
    }
    if (full._status !== 'confirmed' && full._status !== 'visited') {
      wx.showToast({ title: '该预约暂不可签到', icon: 'none' })
      return
    }
    const merged = this._mergeCustomerData(full)
    this.setData({ step: 'confirm', booking: merged, bookingData: merged })
  },

  // 点"确认到店，阅读知情同意书"
  proceedToConsent() {
    this.setData({ step: 'consent', scrolledBottom: false, allRead: false })
  },

  // =================== 知情同意书逻辑 ===================

  onConsentScroll(e) {
    if (this.data.scrolledBottom) return
    const { scrollTop, scrollHeight, clientHeight } = e.detail
    if (scrollHeight - scrollTop - clientHeight < 60) {
      this.setData({ scrolledBottom: true })
    }
  },

  onConsentScrollLower() {
    this.setData({ scrolledBottom: true })
  },

  toggleAllRead() {
    if (this.data.allRead) {
      this.setData({ allRead: false })
      return
    }
    if (!this.data.scrolledBottom) {
      wx.showToast({ title: '请下滑浏览全文至底部', icon: 'none' })
      return
    }
    this.setData({ allRead: true })
  },

  // 摄影授权
  togglePhotoAuth1() {
    this.setData({ photoAuth1: !this.data.photoAuth1 })
  },
  togglePhotoAuth2() {
    this.setData({ photoAuth2: !this.data.photoAuth2 })
  },

  // 确认签署
  confirmConsent() {
    if (!this.data.allRead) {
      wx.showToast({ title: '请先勾选确认已阅读全部内容', icon: 'none' })
      return
    }
    if (this._submitting) return
    this._submitting = true

    const app = getApp()
    const booking = this.data.booking
    if (!booking) { this._submitting = false; return }

    wx.showLoading({ title: '正在签到...', mask: true })
    app.completeGuestCheckin(booking.id, {
      name: this.data.bookingData.name || booking.name,
      gender: this.data.bookingData.gender || booking.gender,
      age: this.data.bookingData.age || booking.age,
      idCard: this.data.bookingData.idCard || booking.idCard,
      photoAuth1: this.data.photoAuth1,
      photoAuth2: this.data.photoAuth2
    }).then(saved => {
      wx.hideLoading()
      const merged = Object.assign({}, booking, saved || {})
      this.setData({
        step: 'done',
        booking: merged,
        bookingData: Object.assign({}, this.data.bookingData, merged),
        showExperienceModal: true
      })
      this._submitting = false
    }).catch(err => {
      wx.hideLoading()
      this._submitting = false
      this.setData({ step: 'error' })
      wx.showToast({ title: err.message || '签到失败，请联系工作人员', icon: 'none' })
    })
  },

  // 拒绝签署
  rejectConsent() {
    wx.showModal({
      title: '确认拒绝签署？',
      content: '拒绝签署后无法继续体验，请联系工作人员',
      confirmText: '确认拒绝',
      cancelText: '返回',
      success: (res) => {
        if (res.confirm) {
          this.setData({ step: 'rejected' })
        }
      }
    })
  },

  // 选择开始体验
  onExperienceYes() {
    const app = getApp()
    const booking = this.data.booking
    if (!booking) return
    // 完成签到后云端状态已经是“已到店”，只有该状态可以开始体验。
    if (booking._status !== 'visited') {
      wx.showToast({ title: '状态异常，请联系工作人员', icon: 'none' })
      return
    }
    wx.showLoading({ title: '正在更新...', mask: true })
    app.startGuestExperience(booking.id).then(data => {
      wx.hideLoading()
      const updated = Object.assign({}, booking, data || {}, { _status: 'in_experience' })
      this.setData({
        booking: updated,
        showExperienceModal: false,
        welcomeText: (booking.name || '') + '  欢迎体验  过程中有任何不适请告知操作师'
      })
    }).catch(err => {
      wx.hideLoading()
      wx.showToast({ title: err.message || '状态更新失败', icon: 'none' })
    })
  },

  // 选择暂不体验
  onExperienceNo() {
    const app = getApp()
    const booking = this.data.booking
    if (!booking) return
    // 签到事务已经写入“已到店”，选择“否”只需关闭提示。
    if (booking._status !== 'visited') {
      wx.showToast({ title: '状态异常，请联系工作人员', icon: 'none' })
      return
    }
    this.setData({ showExperienceModal: false })
    wx.showToast({ title: '已记录', icon: 'success' })
  },

  // 完成 → 返回首页
  finish() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 无预约 → 联系操作师
  contactStaff() {
    wx.showModal({
      title: '请联系工作人员',
      content: '如您已预约但无法自动识别，请向前台工作人员说明，由工作人员协助完成签到。',
      showCancel: false,
      confirmText: '好的'
    })
  },

  // 格式化日期
  _fmtDate(d) {
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },

  // 阻止手势穿透（catchtouchmove 绑定用）
  stop() {}
})
