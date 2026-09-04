const STATUS_MAP = {
  pending_confirm: { label: '新预约', color: '#F59E0B' },
  confirmed: { label: '已预约', color: '#10B981' },
  visited: { label: '已到店', color: '#6B7280' },
  in_experience: { label: '体验中', color: '#3B0764' },
  completed: { label: '已体验', color: '#3B0764' },
  cancelled: { label: '已取消', color: '#EF4444' },
  rejected: { label: '已拒绝', color: '#9CA3AF' }
}

Page({
  data: {
    timeRange: '30d',
    stats: { total: 0, visited: 0, conversion: 0, completed: 0 },
    statusList: [],
    trend: [],
    trendTitle: '近30天预约趋势',
    reminderIssues: [],
    todaySummary: { total: 0, confirmed: 0, visiting: 0 }
  },

  onShow() {
    const app = getApp()
    if (!app.globalData.isAdmin) {
      wx.showToast({ title: '仅管理员可查看', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.loadData()
    const refreshSeq = (this._refreshSeq || 0) + 1
    this._refreshSeq = refreshSeq
    if (app._loadAllBookingsAsAdmin) {
      app._loadAllBookingsAsAdmin().then(() => {
        if (refreshSeq !== this._refreshSeq || !app.globalData.isAdmin) return
        this.loadData()
      })
    }
  },

  onTimeFilter(e) {
    const range = e.currentTarget.dataset.range
    this.setData({ timeRange: range }, () => {
      this.loadData()
    })
  },

  _filterByRange(bookings, range) {
    const today = this._fmtDate(new Date())
    const rangeDays = { '30d': 30, '90d': 90, '180d': 180 }
    const days = rangeDays[range]
    let start = ''
    if (days) {
      const startDate = new Date()
      startDate.setHours(0, 0, 0, 0)
      startDate.setDate(startDate.getDate() - (days - 1))
      start = this._fmtDate(startDate)
    }
    return bookings.filter(b => {
      const visitDate = String(b.visitDate || '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return false
      if (visitDate > today) return false
      return !start || visitDate >= start
    })
  },

  loadData() {
    const app = getApp()
    const allBookings = app.globalData.bookings || []
    const filtered = this._filterByRange(allBookings, this.data.timeRange)
    this.calcStats(filtered)
    this.calcStatus(filtered)
    this.calcTrend(filtered)
    this.calcToday(allBookings)
    this.calcReminderIssues(allBookings)
  },

  // ===== 今日概览（固定今日，不受筛选影响） =====
  calcToday(bookings) {
    const today = this._fmtDate(new Date())
    const todayBookings = bookings.filter(b => b.visitDate === today)
    this.setData({
      todaySummary: {
        total: todayBookings.length,
        confirmed: todayBookings.filter(b => b._status === 'confirmed').length,
        visiting: todayBookings.filter(b => b._status === 'pending_confirm').length
      }
    })
  },

  // ===== 统计分析 =====
  calcStats(bookings) {
    const total = bookings.length
    const arrivedStatuses = ['visited', 'in_experience', 'completed']
    const arrivalBaseStatuses = ['confirmed', ...arrivedStatuses]
    const visited = bookings.filter(b => arrivedStatuses.includes(b._status)).length
    const arrivalBase = bookings.filter(b => arrivalBaseStatuses.includes(b._status)).length
    const conversion = arrivalBase > 0 ? Math.round(visited / arrivalBase * 100) : 0
    const completed = bookings.filter(b => b._status === 'completed').length

    this.setData({
      stats: { total, visited, conversion, completed }
    })
  },

  calcStatus(bookings) {
    const map = {}
    bookings.forEach(b => { map[b._status || 'pending_confirm'] = (map[b._status || 'pending_confirm'] || 0) + 1 })
    const total = Math.max(1, bookings.length)
    const statusList = Object.entries(STATUS_MAP).map(([key, cfg]) => ({
      key, label: cfg.label, color: cfg.color,
      count: map[key] || 0,
      pct: Math.round(((map[key] || 0) / total) * 100)
    }))
    this.setData({ statusList })
  },

  calcReminderIssues(bookings) {
    const issues = bookings
      .filter(b =>
        (!b._reminder30SentAt && b._reminder30LastError) ||
        (!b._reminder90SentAt && b._reminder90LastError)
      )
      .map(b => {
        const stages = []
        const errors = []
        if (!b._reminder30SentAt && b._reminder30LastError) {
          stages.push('30天')
          errors.push(b._reminder30LastError)
        }
        if (!b._reminder90SentAt && b._reminder90LastError) {
          stages.push('90天')
          errors.push(b._reminder90LastError)
        }
        return {
          id: b.id,
          name: b.name || '未填写姓名',
          stageText: stages.join('、'),
          error: String(errors[0] || '发送失败').slice(0, 80)
        }
      })
    this.setData({ reminderIssues: issues })
  },

  goReminderIssue(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/admin/detail/detail?id=${id}` })
  },

  calcTrend(bookings) {
    const range = this.data.timeRange
    const rangeDays = { '30d': 30, '90d': 90, '180d': 180 }
    // “全部”概览统计所有历史记录；为保证图表可读，趋势图固定展示最近180天。
    const days = rangeDays[range] || 180
    const trendTitle = range === 'all' ? '近180天预约趋势' : `近${days}天预约趋势`
    const counts = {}
    bookings.forEach(b => {
      const date = String(b.visitDate || '')
      counts[date] = (counts[date] || 0) + 1
    })
    const trend = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const ds = this._fmtDate(d)
      const count = counts[ds] || 0
      trend.push({
        label: String(d.getMonth() + 1) + '/' + d.getDate(),
        count,
        h: Math.max(4, count * 28)
      })
    }
    this.setData({ trend, trendTitle })
  },

  _fmtDate(d) {
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  }
})
