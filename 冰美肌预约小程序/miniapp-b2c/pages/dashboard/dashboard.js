const STATUS_MAP = {
  pending_confirm: { label: '新预约', color: '#F59E0B' },
  confirmed: { label: '已预约', color: '#10B981' },
  visited: { label: '已到店', color: '#6B7280' },
  in_experience: { label: '体验中', color: '#3B0764' },
  completed: { label: '已体验', color: '#3B0764' },
  cancelled: { label: '已取消', color: '#EF4444' }
}

Page({
  data: {
    timeRange: '30d',
    stats: { total: 0, visited: 0, conversion: 0, avgSatisfaction: '--', satDist: {} },
    statusList: [],
    trend: [],
    todaySummary: { total: 0, confirmed: 0, visiting: 0 }
  },

  onShow() {
    if (!getApp().globalData.isAdmin) {
      wx.showToast({ title: '仅管理员可查看', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.loadData()
  },

  onTimeFilter(e) {
    const range = e.currentTarget.dataset.range
    this.setData({ timeRange: range }, () => {
      this.loadData()
    })
  },

  _filterByRange(bookings, range) {
    const today = this._fmtDate(new Date())
    const now = new Date(today + 'T00:00:00')
    if (range === '30d') {
      const start = new Date(now.getTime() - 29 * 86400000)
      return bookings.filter(b => new Date(b.visitDate) >= start)
    }
    if (range === '90d') {
      const start = new Date(now.getTime() - 89 * 86400000)
      return bookings.filter(b => new Date(b.visitDate) >= start)
    }
    if (range === '180d') {
      const start = new Date(now.getTime() - 179 * 86400000)
      return bookings.filter(b => new Date(b.visitDate) >= start)
    }
    return bookings
  },

  loadData() {
    const app = getApp()
    const allBookings = app.globalData.bookings || []
    const feedbacks = wx.getStorageSync('feedbacks') || []
    const filtered = this._filterByRange(allBookings, this.data.timeRange)
    this.calcStats(filtered, feedbacks)
    this.calcStatus(filtered)
    this.calcTrend(filtered)
    this.calcToday(allBookings)
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
  calcStats(bookings, feedbacks) {
    const total = bookings.length
    const visited = bookings.filter(b => b._status === 'visited' || b._status === 'in_experience' || b._status === 'completed').length
    const conversion = total > 0 ? Math.round(visited / total * 100) : 0

    const allAreas = []
    feedbacks.forEach(f => {
      if (f.areas) allAreas.push(...f.areas)
    })
    const ratedAreas = allAreas.filter(a => a.score > 0)
    const avg = ratedAreas.length > 0
      ? (ratedAreas.reduce((s, a) => s + a.score, 0) / ratedAreas.length).toFixed(1)
      : '--'

    const satDist = {}
    ratedAreas.forEach(a => {
      const k = String(a.score)
      satDist[k] = (satDist[k] || 0) + 1
    })
    const maxCnt = Math.max(1, ...Object.values(satDist))
    ;[1, 2, 3, 4, 5].forEach(s => {
      const cnt = satDist[String(s)] || 0
      satDist[s] = Math.max(4, Math.round((cnt / maxCnt) * 120))
      satDist[s + 'cnt'] = cnt
    })

    this.setData({
      stats: { total, visited, conversion, avgSatisfaction: avg, satDist }
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

  calcTrend(bookings) {
    const now = Date.now()
    const range = this.data.timeRange
    const days = range === '30d' ? 29 : (range === '90d' ? 89 : (range === '180d' ? 179 : 29))
    const trend = []
    for (let i = days; i >= 0; i--) {
      const d = new Date(now - i * 86400000)
      const ds = d.toISOString().slice(0, 10)
      const count = bookings.filter(b => (b.visitDate || '').startsWith(ds)).length
      trend.push({
        label: String(d.getMonth() + 1) + '/' + d.getDate(),
        count,
        h: Math.max(4, count * 28)
      })
    }
    this.setData({ trend })
  },

  _fmtDate(d) {
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  }
})
