Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: '○', activeIcon: '◉' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: '○', activeIcon: '◉' }
    ]
  },
  methods: {
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset
      const url = path
      wx.switchTab({ url })
      this.setData({ selected: index })
    }
  }
})
