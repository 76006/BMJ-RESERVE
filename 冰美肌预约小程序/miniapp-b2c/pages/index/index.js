const genderOptions = ['男', '女']
const TIME_SLOTS = ['9:30-11:30', '13:00-15:00', '15:30-17:30']

Page({
  data: {
    name: '',
    genderIdx: 0,
    genderText: '男',
    age: '',
    idCard: '',
    visitDate: '',
    minVisitDate: '',
    visitTimeIdx: -1,
    visitTimeText: '',
    timeSlots: TIME_SLOTS,
    slotStatus: [],        // 三态：'closed'(未开放) | 'booked'(已约满) | 'free'(可约)，与 timeSlots 一一对应
    allSlots: TIME_SLOTS,  // 全量时段（含未开放），供状态列表展示
    allSlotStatus: [],     // 全量时段三态，与 allSlots 一一对应
    medicalHistory: '',
    needs: '',
    phone: '',
    phoneVerified: false,
    agreedPrivacy: false,
    channelBadge: '',
    trainerBadge: ''
  },

  onLoad() {
    const sys = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: sys.statusBarHeight, minVisitDate: this._fmtDate(new Date()) })

    // 隐私协议检查（微信 2023 年起要求，未同意则 getPhoneNumber 静默失败）
    if (wx.canIUse('getPrivacySetting')) {
      wx.getPrivacySetting({
        success: (res) => {
          if (res.needAuthorization) {
            // 弹出微信原生隐私协议弹窗
            wx.requirePrivacyAuthorize({
              success: () => { console.log('[隐私协议] 用户已同意') },
              fail: () => { console.log('[隐私协议] 用户拒绝') }
            })
          }
        }
      })
    }

    const app = getApp()
    const channelMap = { medical: '医疗渠道', beauty: '生美渠道' }
    const ch = app.globalData.channel
    if (ch && ch !== 'direct') {
      this.setData({
        channelBadge: channelMap[ch] || ch,
        trainerBadge: app.globalData.trainerName || ''
      })
    }
    // 门店签到码：检测到 checkin 标记 → 跳转顾客签到页（冷启动）
    this._checkCheckinRedirect()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    const today = this._fmtDate(new Date())
    if (this.data.visitDate && this.data.visitDate < today) {
      this.setData({
        visitDate: '',
        visitTimeIdx: -1,
        visitTimeText: '',
        timeSlots: [],
        slotStatus: [],
        allSlotStatus: []
      })
    }
    this.setData({ minVisitDate: today })
    // 暖启动：小程序已在后台时扫码只触发 onShow，需在这里也检查跳转
    const redirectingToCheckin = this._checkCheckinRedirect()
    if (!redirectingToCheckin) this._loadRebookDraft()
  },

  // 门店签到码扫描后跳转顾客签到页（onLoad 与 onShow 共用）
  _checkCheckinRedirect() {
    const app = getApp()
    if (!app.globalData._launchCheckin) return false
    app.globalData._launchCheckin = false
    const bookingId = app.globalData._checkinBookingId
    const checkinToken = app.globalData._checkinToken
    app.globalData._checkinBookingId = null
    app.globalData._checkinToken = ''
    const tokenQuery = checkinToken ? '&token=' + encodeURIComponent(checkinToken) : ''
    if (bookingId) {
      wx.navigateTo({ url: '/pages/checkin/guest/guest?id=' + encodeURIComponent(bookingId) + tokenQuery })
    } else {
      wx.navigateTo({ url: '/pages/checkin/guest/guest' + (checkinToken ? '?token=' + encodeURIComponent(checkinToken) : '') })
    }
    return true
  },

  // 重新预约只带入客户资料，日期与时段必须由用户重新选择并再次提交。
  _loadRebookDraft() {
    const draft = wx.getStorageSync('_rebookDraft')
    if (!draft) return
    wx.removeStorageSync('_rebookDraft')

    const app = getApp()
    const profile = app.getUserProfile ? (app.getUserProfile() || {}) : {}
    const verifiedPhone = profile.phone || wx.getStorageSync('_userPhone') || ''
    const isPhoneVerified = !!app.globalData.isAdmin || (
      !!wx.getStorageSync('_phoneVerified') && verifiedPhone === (draft.phone || '')
    )
    const genderIdx = Math.max(0, genderOptions.indexOf(draft.gender || '男'))
    this._rebookSource = {
      channel: draft.channel || 'direct',
      trainerId: draft.trainerId || '',
      trainerName: draft.trainerName || ''
    }
    const channelMap = { medical: '医疗渠道', beauty: '生美渠道' }
    this.setData({
      name: draft.name || '',
      genderIdx,
      genderText: genderOptions[genderIdx],
      age: draft.age || '',
      idCard: draft.idCard || '',
      phone: draft.phone || '',
      phoneVerified: isPhoneVerified,
      medicalHistory: draft.medicalHistory || '',
      needs: draft.needs || '',
      visitDate: '',
      visitTimeIdx: -1,
      visitTimeText: '',
      timeSlots: TIME_SLOTS,
      slotStatus: [],
      allSlotStatus: [],
      agreedPrivacy: false,
      channelBadge: channelMap[draft.channel] || (draft.channel === 'direct' ? '' : draft.channel || ''),
      trainerBadge: draft.trainerName || ''
    })
    wx.showToast({ title: '资料已带入，请重新选择日期和时段', icon: 'none', duration: 2200 })
    setTimeout(() => wx.pageScrollTo({ selector: '#book', duration: 300 }), 100)
  },

  scrollToBook() {
    wx.pageScrollTo({ selector: '#book', duration: 300 })
  },

  onName(e) { this.setData({ name: e.detail.value }) },
  onAge(e) { this.setData({ age: e.detail.value }) },
  onIdCard(e) { this.setData({ idCard: e.detail.value }) },
  // 微信手机号一键授权
  onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      console.log('[getPhoneNumber] 用户取消或失败:', e.detail.errMsg)
      return
    }
    wx.showLoading({ title: '授权中...', mask: true })
    wx.cloud.callFunction({
      name: 'getPhoneNumber',
      data: { code: e.detail.code }
    }).then(res => {
      wx.hideLoading()
      const result = res.result || {}
      if (result.phone) {
        const app = getApp()
        if (app.cacheVerifiedPhone) app.cacheVerifiedPhone(result.phone)
        this.setData({
          phone: result.phone,
          phoneVerified: true
        })
        wx.showToast({ title: '授权成功', icon: 'success' })
      } else {
        console.error('[getPhoneNumber] 解析失败:', result)
        wx.showToast({ title: '获取失败，请重新授权', icon: 'none' })
      }
    }).catch(err => {
      wx.hideLoading()
      console.error('[getPhoneNumber] 云函数调用失败:', err)
      wx.showToast({ title: '授权失败，请重新尝试', icon: 'none' })
    })
  },

  onMedicalHistory(e) { this.setData({ medicalHistory: e.detail.value }) },
  onNeeds(e) { this.setData({ needs: e.detail.value }) },

  onGender(e) {
    const idx = Number(e.detail.value)
    this.setData({ genderIdx: idx, genderText: genderOptions[idx] })
  },

  onVisitDate(e) {
    const date = e.detail.value
    const today = this._fmtDate(new Date())
    if (!date || date < today) {
      wx.showToast({ title: '不能选择今天以前的日期', icon: 'none' })
      return
    }
    this.setData({
      visitDate: date,
      visitTimeIdx: -1,
      visitTimeText: '',
      slotStatus: []
    })
    // 根据时段管理设置 + 已占用情况过滤可选时间段（异步）
    this.filterAvailableSlots(date)
  },

  // 读取某天可选时段并标注三态：
  //   closed  = 操作师未开启（默认关闭）
  //   booked  = 已开启但已被预约占用
  //   free    = 已开启且空闲
  // 逻辑：可选 = 开启(操作师开放) ∩ 未占用
  filterAvailableSlots(date) {
    const app = getApp()
    const self = this

    // 先查云端开放时段（操作师设置），再叠加占用情况
    app.getSchedule(date).then(openSlots => {
      // openSlots: 该日开放的时段数组；空数组=全关闭
      const openSet = new Set(openSlots || [])

      app.getOccupiedSlots(date).then(occupiedMap => {
        // 构建完整三态列表（基于全部 TIME_SLOTS，关闭项也展示以提示用户）
        const fullSlots = TIME_SLOTS
        const fullStatus = fullSlots.map(s => {
          if (!self._isFutureSlot(date, s)) return 'past'
          if (!openSet.has(s)) return 'closed'
          if (occupiedMap[s]) return 'booked'
          return 'free'
        })

        // picker 只放仍未开始且未被占用的开放时段。
        const available = fullSlots.filter((s, idx) => openSet.has(s) && fullStatus[idx] === 'free')
        const availableStatus = available.map(s => fullStatus[fullSlots.indexOf(s)])

        if (available.length === 0) {
          self.setData({
            timeSlots: [],
            slotStatus: fullStatus,
            allSlots: fullSlots,
            allSlotStatus: fullStatus,
            visitTimeText: '该日期暂无可预约时段'
          })
        } else {
          self.setData({
            timeSlots: available,
            slotStatus: availableStatus,
            allSlots: fullSlots,
            allSlotStatus: fullStatus
          })
        }
      })
    })
  },

  onVisitTime(e) {
    const idx = Number(e.detail.value)
    this.setData({ visitTimeIdx: idx, visitTimeText: this.data.timeSlots[idx] })
  },

  validate() {
    const { name, visitDate, visitTimeIdx, idCard, agreedPrivacy, phoneVerified } = this.data
    if (!name.trim()) return '请输入姓名'
    if (!visitDate) return '请选择体验日期'
    if (visitTimeIdx < 0) return '请选择体验时间段'
    if (!this._isFutureSlot(visitDate, this.data.visitTimeText)) return '不能预约已经开始或过去的时段'
    if (!phoneVerified) return '请授权手机号'
    if (!agreedPrivacy) return '请先阅读并同意隐私协议'
    if (idCard && !/^\d{17}[\dXx]$/.test(idCard)) return '请输入正确的身份证号'
    return null
  },

  togglePrivacy() {
    this.setData({ agreedPrivacy: !this.data.agreedPrivacy })
  },

  showPrivacy() {
    wx.navigateTo({ url: '/pages/legal/legal?tab=privacy' })
  },

  showAgreement() {
    wx.navigateTo({ url: '/pages/legal/legal?tab=agreement' })
  },

  submitBook() {
    const err = this.validate()
    if (err) { wx.showToast({ title: err, icon: 'none' }); return }
    if (this._submitting) return
    this._submitting = true

    // 客户端二次确认：选中时段必须是"开放且未占用"
    const { visitDate, visitTimeText, slotStatus, visitTimeIdx } = this.data
    if (slotStatus[visitTimeIdx] === 'closed') {
      this._submitting = false
      wx.showToast({ title: '该时段未开放，暂不可预约', icon: 'none' })
      return
    }
    if (slotStatus[visitTimeIdx] === 'booked') {
      this._submitting = false
      wx.showToast({ title: '该时段已被预约，请另选时间', icon: 'none' })
      return
    }

    wx.showLoading({ title: '提交中...', mask: true })

    // 服务端权威校验（防并发双占 + 防未开放时段被绕过）
    const app = getApp()
    wx.cloud.callFunction({
      name: 'checkSlot',
      data: { visitDate, visitTime: visitTimeText }
    }).then(res => {
      const r = res.result || {}
      if (!r.success) {
        wx.hideLoading()
        this._submitting = false
        wx.showToast({ title: r.error || '预约时间校验失败', icon: 'none' })
        return
      }
      if (r.success && r.occupied) {
        wx.hideLoading()
        this._submitting = false
        wx.showToast({ title: '该时段已被预约，请另选时间', icon: 'none' })
        // 刷新时段状态，让界面反映最新占用
        this.filterAvailableSlots(visitDate)
        this.setData({ visitTimeIdx: -1, visitTimeText: '' })
        return
      }
      // 直接提交（不再跳转知情同意书，签署移至签到环节）
      this.doSubmit()
    }).catch((err) => {
      wx.hideLoading()
      this._submitting = false
      console.warn('[预约] 时段校验失败:', err)
      wx.showToast({ title: '暂时无法校验时段，请稍后重试', icon: 'none' })
    })
  },

  doSubmit() {
    const app = getApp()
    const form = {
      name: this.data.name.trim(),
      gender: genderOptions[this.data.genderIdx],
      age: this.data.age.trim(),
      idCard: this.data.idCard.trim(),
      visitDate: this.data.visitDate,
      visitTime: this.data.visitTimeText,
      medicalHistory: this.data.medicalHistory.trim(),
      needs: this.data.needs.trim(),
      phone: this.data.phone.trim(),
      agreedPrivacy: this.data.agreedPrivacy,
      channel: this._rebookSource ? this._rebookSource.channel : (app.globalData.channel || 'direct'),
      trainerId: this._rebookSource ? this._rebookSource.trainerId : (app.globalData.trainerId || ''),
      trainerName: this._rebookSource ? this._rebookSource.trainerName : (app.globalData.trainerName || '')
    }

    app.addBooking(form, (booking, error) => {
      wx.hideLoading()
      this._submitting = false
      if (booking) {
        this.requestSubscription(booking.id)
      } else {
        wx.showToast({ title: error || '提交失败，请重试', icon: 'none' })
        this.filterAvailableSlots(this.data.visitDate)
      }
    })
  },

  requestSubscription(bookingId) {
    wx.showModal({
      title: '预约成功',
      content: '我们将在体验当天和30/90天后向您发送护理贴士和反馈提醒。是否允许接收消息通知？',
      confirmText: '允许',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) {
          const TEMPLATE_ID = 'A09emeoi_5a_1s7UsMD7Twuj5cfYOC-Y1999bCtb-sI'
          wx.requestSubscribeMessage({
            tmplIds: [TEMPLATE_ID],
            success: () => {},
            fail: () => {}
          })
          wx.showToast({ title: '已开启通知', icon: 'success', duration: 1500 })
        }
        // 跳转到我的页面
        setTimeout(() => {
          this.resetForm()
          wx.switchTab({ url: '/pages/mine/mine' })
        }, 1500)
      }
    })
  },

  resetForm() {
    this._rebookSource = null
    this.setData({
      name: '', genderIdx: 0, genderText: '男', age: '', idCard: '',
      visitDate: '', visitTimeIdx: -1, visitTimeText: '',
      medicalHistory: '', needs: '', phone: '',
      phoneVerified: false, agreedPrivacy: false
    })
  },

  _fmtDate(d) {
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },

  _isFutureSlot(date, slot) {
    if (!date || !slot) return false
    const now = new Date()
    const today = this._fmtDate(now)
    if (date > today) return true
    if (date < today) return false
    const match = String(slot).match(/^(\d{1,2}):(\d{2})/)
    if (!match) return false
    const startAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(match[1]),
      Number(match[2]),
      0,
      0
    )
    return startAt.getTime() >= now.getTime()
  },

  onShareAppMessage() {
    return {
      title: '冰美肌 · 非手术焕肤新体验',
      path: '/pages/index/index',
      imageUrl: '/images/hero_mj6.jpg'
    }
  }
})
