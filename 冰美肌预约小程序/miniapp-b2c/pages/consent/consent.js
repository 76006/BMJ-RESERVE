Page({
  data: {
    // Auto-filled data (merged from URL params + history)
    bookingData: {
      name: '', phone: '', gender: '', age: '', idCard: '',
      visitDate: '', visitTime: ''
    },
    allRead: false,
    scrolledBottom: false,
    source: 'booking',
    bookingId: '',
    photoAuth1: false,
    photoAuth2: false
  },

  onLoad(options) {
    const app = getApp()
    const bookingId = options.bookingId || ''

    // 从 URL 参数取基础数据
    const baseData = {
      name: decodeURIComponent(options.name || ''),
      visitDate: decodeURIComponent(options.visitDate || ''),
      visitTime: decodeURIComponent(options.visitTime || ''),
      phone: decodeURIComponent(options.phone || ''),
      gender: decodeURIComponent(options.gender || ''),
      age: decodeURIComponent(options.age || ''),
      idCard: decodeURIComponent(options.idCard || '')
    }

    // 如果有 bookingId，从数据库查询补充数据
    if (bookingId) {
      const booking = app.getBookingById(bookingId)
      if (booking) {
        const merged = this._mergeFromBooking(booking, baseData)
        this.setData({
          bookingData: merged,
          source: options.source || 'booking',
          bookingId: bookingId
        })
        return
      }
    }

    // 没有 bookingId 或找不到记录：只展示 URL 参数 + 手机号查找历史
    if (baseData.phone) {
      const merged = this._mergeFromHistory(baseData)
      this.setData({ bookingData: merged, source: options.source || 'booking', bookingId })
    } else {
      const bd = { ...baseData }
      this.setData({ bookingData: bd, source: options.source || 'booking', bookingId })
    }
  },

  // 从 booking 记录 + URL params 合并数据
  _mergeFromBooking(booking, params) {
    const app = getApp()
    const all = app.globalData.bookings || []
    const phone = (booking.phone || params.phone || '').replace(/\*/g, '').trim()

    // 从历史记录中搜索此手机号，取非空字段补全
    const history = all
      .filter(b => {
        const bp = (b.phone || '').replace(/\*/g, '').trim()
        return bp === phone || (bp.length >= 4 && phone.length >= 4 && bp.slice(-4) === phone.slice(-4))
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

    const pick = (field) => {
      if (booking[field]) return booking[field]
      if (params[field]) return params[field]
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
      visitDate: booking.visitDate || params.visitDate || '',
      visitTime: booking.visitTime || params.visitTime || ''
    }
  },

  // 纯 URL 参数 + 历史记录合并
  _mergeFromHistory(params) {
    const app = getApp()
    const all = app.globalData.bookings || []
    const phone = (params.phone || '').replace(/\*/g, '').trim()

    const history = all
      .filter(b => {
        const bp = (b.phone || '').replace(/\*/g, '').trim()
        return bp === phone || (bp.length >= 4 && phone.length >= 4 && bp.slice(-4) === phone.slice(-4))
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

    const pick = (field) => {
      if (params[field]) return params[field]
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
      visitDate: params.visitDate || '',
      visitTime: params.visitTime || ''
    }
  },

  onScroll(e) {
    if (this.data.scrolledBottom) return
    const { scrollTop, scrollHeight, clientHeight } = e.detail
    if (scrollHeight - scrollTop - clientHeight < 40) {
      this.setData({ scrolledBottom: true })
    }
  },

  onScrollToLower() {
    this.setData({ scrolledBottom: true })
  },

  toggleAllRead() {
    const checked = !this.data.allRead
    if (checked && !this.data.scrolledBottom) {
      wx.showToast({ title: '请下滑浏览全文至底部', icon: 'none' })
      return
    }
    this.setData({ allRead: checked })
  },

  togglePhotoAuth1() {
    this.setData({ photoAuth1: !this.data.photoAuth1 })
  },
  togglePhotoAuth2() {
    this.setData({ photoAuth2: !this.data.photoAuth2 })
  },

  confirmConsent() {
    if (!this.data.allRead) {
      wx.showToast({ title: '请先勾选确认已阅读全部内容', icon: 'none' })
      return
    }

    const app = getApp()
    const signName = this.data.bookingData.name
    const signTime = new Date().toISOString()

    if ((this.data.source === 'checkin' || this.data.source === 'guest_checkin') && this.data.bookingId) {
      app.saveConsent(this.data.bookingId, {
        name: signName,
        image: '',
        photoAuth1: this.data.photoAuth1,
        photoAuth2: this.data.photoAuth2
      })
      // 回写自动补全的客户信息到当前 booking
      app.updateCustomerFields(this.data.bookingId, {
        name: this.data.bookingData.name,
        gender: this.data.bookingData.gender,
        age: this.data.bookingData.age,
        idCard: this.data.bookingData.idCard,
        phone: this.data.bookingData.phone
      })
      if (this.data.source === 'guest_checkin') {
        app.globalData._guestCheckinComplete = {
          bookingId: this.data.bookingId,
          deviceModel: ''
        }
      } else {
        app.globalData._checkinConsent = {
          bookingId: this.data.bookingId,
          name: signName,
          image: ''
        }
      }
    } else {
      app.globalData._consentConfirmed = true
      app.globalData._consentSignName = signName
      app.globalData._consentSignTime = signTime
      app.globalData._consentSignImage = ''
    }
    wx.navigateBack()
  },

  goAftercare() {
    wx.navigateTo({ url: '/pages/aftercare/aftercare' })
  }
})
