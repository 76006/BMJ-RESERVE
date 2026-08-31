Page({
  data: {
    activeTab: 'privacy'  // 'privacy' | 'agreement'
  },

  onLoad(options) {
    // 支持从URL参数指定默认tab
    if (options.tab === 'agreement') {
      this.setData({ activeTab: 'agreement' })
    } else if (options.tab === 'privacy') {
      this.setData({ activeTab: 'privacy' })
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
  }
})
