// 顾客签到页（扫门店签到码 → 自动识别预约 → 内嵌知情同意书 → 完成）
// 自动识别逻辑：
//   1. app.js 扫码解析 → 传入 bookingId（单预约码）
//   2. 无 bookingId 时：从 userProfile 取手机号，先本地匹配今日预约（暖启动即时），
//      本地未命中 → 再云端按「手机号 + 今日」查询未签到预约（修复冷启动时序 + 兼容操作师代下）
//   3. 仍无匹配：进入 not_found，提供"手动选择今日预约"兜底列表
// 数据补全：匹配到手机号后，自动从历史 booking 记录中提取姓名/性别/年龄/身份证等字段

Page({
  data: {
    // 页面状态: loading | confirm | consent | done | error | rejected | not_found
    step: 'loading',

    // 当前预约
    booking: null,
    today: '',

    // not_found 兜底：今日可签到的预约列表（供手动选择）
    todayBookings: [],

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
    const app = getApp()
    const today = this._fmtDate(new Date())
    this.setData({ today })

    // 情况1：操作师后台传入 bookingId（直接查到记录）
    if (options.id) {
      // QR 码里 bookingId 转成了大写并加了 ID- 前缀，匹配时转回小写并去掉前缀
      let bookingId = (options.id || '').trim().toLowerCase()
      if (bookingId.indexOf('id-') === 0) {
        bookingId = bookingId.slice(3)
      }
      const booking = app.getBookingById(bookingId)
      if (booking) {
        const merged = this._mergeCustomerData(booking)
        this.setData({ step: 'confirm', booking: merged, bookingData: merged })
        return
      }
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
        self.setData({ step: 'confirm', booking: merged, bookingData: merged })
        return
      }
      if (cloudBookings.length > 1) {
        const list = self._getTodayBookings(today, cloudBookings)
        self.setData({ step: 'not_found', todayBookings: list })
        return
      }

      // 云端也无匹配 → not_found，附带"手动选择今日预约"兜底（尽力用本地数据）
      const fallback = self._getTodayBookings(today)
      self.setData({ step: 'not_found', todayBookings: fallback })
    }).catch(function (err) {
      console.warn('[签到] 云端查询失败，降级到本地:', err)
      const fallback = self._getTodayBookings(today)
      self.setData({ step: 'not_found', todayBookings: fallback })
    })
  },

  // 云端查询：phone + visitDate + 未签到 + 状态为已确认/已到店
  // 仅用两个等值条件（phone + visitDate），避免复合索引依赖；状态/签到在服务端过滤后于客户端再筛。
  _fetchTodayByPhone(phone, today) {
    const app = getApp()
    const db = app.globalData.db
    if (!db) return Promise.resolve([])
    if (!phone) return Promise.resolve([])

    return db.collection('bookings')
      .where({ phone: phone, visitDate: today })
      .limit(50)
      .get()
      .then(function (res) {
        return (res.data || []).filter(function (b) {
          if (b.checkInAt) return false
          return b._status === 'confirmed' || b._status === 'visited'
        })
      })
      .catch(function (err) {
        console.warn('[签到] 按手机号查询今日预约失败:', err)
        return []
      })
  },

  // ========== 数据自动补全：手机号匹配历史记录，合并字段 ==========
  _mergeCustomerData(currentBooking) {
    const app = getApp()
    const all = app.globalData.bookings || []
    const phone = (currentBooking.phone || '').replace(/\*/g, '').trim()

    if (!phone) {
      return {
        name: currentBooking.name || '',
        gender: currentBooking.gender || '',
        age: currentBooking.age || '',
        idCard: currentBooking.idCard || '',
        phone: currentBooking.phone || '',
        visitDate: currentBooking.visitDate || '',
        visitTime: currentBooking.visitTime || ''
      }
    }

    // 搜索所有历史上匹配此手机号的 booking（按时间倒序，最新的在前）
    const history = all
      .filter(b => {
        const bp = (b.phone || '').replace(/\*/g, '').trim()
        return bp === phone || (bp.length >= 4 && phone.length >= 4 && bp.slice(-4) === phone.slice(-4))
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

    return {
      name: pick('name'),
      gender: pick('gender'),
      age: pick('age'),
      idCard: pick('idCard'),
      phone: phone,
      visitDate: currentBooking.visitDate || '',
      visitTime: currentBooking.visitTime || ''
    }
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
      return bp === p || (bp.length >= 4 && p.length >= 4 && bp.slice(-4) === p.slice(-4))
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

    // 写入知情同意书签署记录（含摄影授权）
    app.saveConsent(booking.id, {
      name: this.data.bookingData.name || booking.name,
      image: '',
      photoAuth1: this.data.photoAuth1,
      photoAuth2: this.data.photoAuth2
    })

    // 将自动补全后的客户信息回写到当前 booking
    app.updateCustomerFields(booking.id, {
      name: this.data.bookingData.name || booking.name,
      gender: this.data.bookingData.gender || booking.gender,
      age: this.data.bookingData.age || booking.age,
      idCard: this.data.bookingData.idCard || booking.idCard,
      phone: this.data.bookingData.phone || booking.phone
    })

    // 执行签到（不自动切换状态）
    const checkedIn = app.checkIn(booking.id, '')
    if (!checkedIn) {
      // 签到失败：预约未确认或已签到过
      this.setData({ step: 'error' })
      this._submitting = false
      return
    }

    this.setData({ step: 'done', showExperienceModal: true })
    this._submitting = false
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
    // 状态守卫：仅已预约（签到后）或已到店可切体验中
    if (booking._status !== 'confirmed' && booking._status !== 'visited') {
      wx.showToast({ title: '状态异常，请联系工作人员', icon: 'none' })
      return
    }
    app.updateBookingStatus(booking.id, 'in_experience')
    const name = booking.name || ''
    this.setData({
      showExperienceModal: false,
      welcomeText: name + '  欢迎体验  过程中有任何不适请告知操作师'
    })
  },

  // 选择暂不体验
  onExperienceNo() {
    const app = getApp()
    const booking = this.data.booking
    if (!booking) return
    // 状态守卫：仅已预约（签到后）可切已到店
    if (booking._status !== 'confirmed') {
      wx.showToast({ title: '状态异常，请联系工作人员', icon: 'none' })
      return
    }
    app.updateBookingStatus(booking.id, 'visited')
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
