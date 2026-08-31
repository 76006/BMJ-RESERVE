const app = getApp()

Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    showBack: {
      type: Boolean,
      value: false
    },
    bgColor: {
      type: String,
      value: '#6B7280'
    }
  },

  data: {
    statusBarHeight: 0
  },

  lifetimes: {
    attached() {
      this.setData({
        statusBarHeight: app.globalData.statusBarHeight || 20
      })
    }
  },

  methods: {
    onBack() {
      wx.navigateBack({ delta: 1 })
    }
  }
})