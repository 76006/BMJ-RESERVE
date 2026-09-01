Page({
  data: {
    rows: [],
    total: 0
  },

  onShow() {
    this.loadData()
  },

  loadData() {
    const app = getApp()
    const bookings = app.getAllBookings()
    const statusMap = {
      pending_confirm: '新预约',
      confirmed: '已预约',
      visited: '已到店',
      in_experience: '体验中',
      completed: '已体验',
      cancelled: '已取消',
      rejected: '已拒绝'
    }
    const channelMap = {
      direct: '直接',
      medical: '医疗',
      beauty: '生美'
    }
    const rows = bookings.map((b, i) => ({
      ...b,
      statusLabel: statusMap[b._status] || b._status,
      channelLabel: channelMap[b.channel] || b.channel || '-',
      createdAtStr: b.createdAt ? this.formatDate(b.createdAt) : '-'
    }))
    this.setData({ rows, total: rows.length })
  },

  formatDate(ts) {
    if (!ts) return '-'
    const d = new Date(ts)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  copyAll() {
    const headers = ['序号', '姓名', '性别', '年龄', '电话', '预约日期', '预约时间', '门店名称', '门店地址', '改善需求', '状态', '来源', '负责人', '内部备注', '提交时间']
    const rows = this.data.rows.map((r, i) => [
      i + 1,
      r.name,
      r.gender,
      r.age,
      r.phone,
      r.visitDate,
      r.visitTime,
      r.storeName || '',
      r.storeAddress || '',
      r.needs,
      r.statusLabel,
      r.channelLabel,
      r._clientManager || '',
      r._adminNote || '',
      r.createdAtStr
    ])
    const lines = [headers.join('\t'), ...rows.map(r => r.join('\t'))]
    const text = lines.join('\n')
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '已复制全部数据', icon: 'success' })
      }
    })
  },

  shareScreenshot() {
    wx.showModal({
      title: '截图分享',
      content: '请使用手机截图功能截取当前页面，然后分享到微信好友或群。',
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
