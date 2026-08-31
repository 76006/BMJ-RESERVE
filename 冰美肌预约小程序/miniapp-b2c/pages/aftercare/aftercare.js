Page({
  data: {
    activeTab: 0,
    recordId: '',
    mode: '24h'  // 24h / 30 / 90
  },

  onLoad(options) {
    const mode = options.mode || '24h'
    const tabMap = { '24h': 0, '30': 1, '90': 2 }
    this.setData({
      recordId: options.recordId || '',
      mode: mode,
      activeTab: tabMap[mode] || 0
    })
  },

  switchTab(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const modeMap = { 0: '24h', 1: '30', 2: '90' }
    this.setData({
      activeTab: index,
      mode: modeMap[index] || '24h'
    })
  }
})
