Page({
  data: {
    schedule: {},       // { '2025-06-25': ['09:00-10:00','10:00-11:00',...] }
    selectedDate: '',
    dateList: [],
    TIME_SLOTS: ['9:30-11:30', '13:00-15:00', '15:30-17:30'],
    editing: false
  },

  onShow() {
    const app = getApp()
    if (!app.globalData.isAdmin) { wx.navigateBack(); return }
    this.loadSchedule()
    this.generateDateList()
  },

  loadSchedule() {
    const app = getApp()
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')

    if (isDevtools) {
      // 演示模式：读本地降级
      const data = wx.getStorageSync('_schedule') || {}
      this.setData({ schedule: data })
      return
    }

    // 真机：从云端 schedule 集合读取（所有用户可读）
    const db = app.globalData.db
    if (!db) {
      const data = wx.getStorageSync('_schedule') || {}
      this.setData({ schedule: data })
      return
    }
    db.collection('schedule').doc('current').get()
      .then(res => {
        const data = (res.data && res.data.schedule) || {}
        this.setData({ schedule: data })
      })
      .catch(() => {
        // 文档不存在 => 默认全关闭
        this.setData({ schedule: {} })
      })
  },

  saveSchedule() {
    const app = getApp()
    const schedule = this.data.schedule
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')

    if (isDevtools) {
      // 演示模式：写本地降级
      wx.setStorageSync('_schedule', schedule)
      wx.showToast({ title: '已保存(本地演示)', icon: 'success', duration: 2000 })
      this.setData({ editing: false, selectedDate: '' })
      return
    }

    wx.showLoading({ title: '保存中...', mask: true })
    wx.cloud.callFunction({
      name: 'saveSchedule',
      data: { schedule }
    }).then(res => {
      wx.hideLoading()
      const r = res.result || {}
      if (r.success) {
        wx.showToast({ title: '已保存并同步', icon: 'success', duration: 2000 })
      } else {
        wx.showToast({ title: '保存失败: ' + (r.error || ''), icon: 'none' })
      }
      this.setData({ editing: false, selectedDate: '' })
    }).catch(err => {
      wx.hideLoading()
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      console.error('[saveSchedule] 云函数调用失败:', err)
    })
  },

  generateDateList() {
    const list = []
    const today = new Date()
    const slots = this.data.TIME_SLOTS
    const sched = this.data.schedule
    for (let i = 0; i < 10; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      const ds = this._fmtDate(d)
      const dayOfWeek = ['日','一','二','三','四','五','六'][d.getDay()]
      // 计算每个时段的开关状态（默认全部关闭：无记录=全关闭）
      const savedSlots = sched[ds]
      const slotLabels = slots.map((s, idx) => {
        if (!savedSlots) return '关闭'
        if (savedSlots.length === 0) return '关闭'
        return savedSlots.includes(s) ? '开放' : '关闭'
      })
      const slotShort = slots.map(s => s.split('-')[0])
      const slotStatus = slots.map((s, idx) => {
        if (!savedSlots) return 'closed'
        if (savedSlots.length === 0) return 'closed'
        return savedSlots.includes(s) ? 'open' : 'closed'
      })
      list.push({
        date: ds,
        label: `${d.getMonth()+1}/${d.getDate()} 周${dayOfWeek}`,
        slotLabels,
        slotShort,
        slotStatus
      })
    }
    this.setData({ dateList: list })
  },

  selectDate(e) {
    const ds = e.currentTarget.dataset.date
    this.setData({ selectedDate: ds, editing: true })
  },

  toggleSlot(e) {
    const slot = e.currentTarget.dataset.slot
    const ds = this.data.selectedDate
    const schedule = { ...this.data.schedule }
    let slots = schedule[ds]
    if (!slots) {
      // 默认全关闭：未设置过该日 => 从"空列表(全关闭)"开始，开启的逐个加入
      slots = []
      schedule[ds] = slots
    }
    const idx = slots.indexOf(slot)
    if (idx > -1) {
      slots.splice(idx, 1)
    } else {
      slots.push(slot)
      slots.sort()
    }
    this.setData({ schedule })
    this.generateDateList()
  },

  toggleAllDay(e) {
    const ds = this.data.selectedDate
    const schedule = { ...this.data.schedule }
    const open = e.currentTarget.dataset.open
    if (open) {
      schedule[ds] = [...this.data.TIME_SLOTS]
    } else {
      schedule[ds] = []
    }
    this.setData({ schedule })
    this.generateDateList()
  },

  getSlotStatus(ds) {
    const slots = this.data.schedule[ds]
    // 默认全部关闭：无记录或空数组 => 全部关闭
    if (!slots) return { allOpen: false, closedSlots: this.data.TIME_SLOTS }
    if (slots.length === 0) return { allOpen: false, closedSlots: this.data.TIME_SLOTS }
    return { allOpen: false, closedSlots: this.data.TIME_SLOTS.filter(s => !slots.includes(s)) }
  },

  _fmtDate(d) {
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  },

  goBack() {
    wx.navigateBack()
  },

  noop() {}
})
