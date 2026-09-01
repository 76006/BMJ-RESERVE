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
    this.setData({ statusBarHeight: sys.statusBarHeight })

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
    // 暖启动：小程序已在后台时扫码只触发 onShow，需在这里也检查跳转
    this._checkCheckinRedirect()
  },

  // 门店签到码扫描后跳转顾客签到页（onLoad 与 onShow 共用）
  _checkCheckinRedirect() {
    const app = getApp()
    if (!app.globalData._launchCheckin) return
    app.globalData._launchCheckin = false
    const bookingId = app.globalData._checkinBookingId
    app.globalData._checkinBookingId = null
    if (bookingId) {
      wx.navigateTo({ url: '/pages/checkin/guest/guest?id=' + bookingId })
    } else {
      wx.navigateTo({ url: '/pages/checkin/guest/guest' })
    }
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
          if (!openSet.has(s)) return 'closed'
          if (occupiedMap[s]) return 'booked'
          return 'free'
        })

        // picker 仅放"开放"时段（closed 不入可选，避免用户误选）
        const available = fullSlots.filter(s => openSet.has(s))
        const availableStatus = fullStatus.filter(s => s !== 'closed')

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
    }).catch(() => {
      // 云函数不可用（如演示模式）→ 信任客户端判断，仍提交
      this.doSubmit()
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
      phone: this.data.phone.trim()
    }

    app.addBooking(form, (booking) => {
      wx.hideLoading()
      this._submitting = false
      if (booking) {
        this.requestSubscription(booking.id)
      } else {
        wx.showToast({ title: '提交失败，请重试', icon: 'none' })
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
    this.setData({
      name: '', genderIdx: 0, genderText: '男', age: '', idCard: '',
      visitDate: '', visitTimeIdx: -1, visitTimeText: '',
      medicalHistory: '', needs: '', phone: '',
      phoneVerified: false, agreedPrivacy: false
    })
  },

  onShareAppMessage() {
    return {
      title: '冰美肌 · 非手术焕肤新体验',
      path: '/pages/index/index',
      imageUrl: '/images/hero_mj6.jpg'
    }
  }
})
