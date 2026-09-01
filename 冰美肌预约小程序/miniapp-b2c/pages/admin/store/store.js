const DEFAULT_CONFIG = {
  storeName: '冰美肌',
  address: '',
  contactPhone: '',
  contactWechat: '',
  businessHours: '',
  appointmentNotice: '请提前10分钟到店，素颜更佳'
}

Page({
  data: Object.assign({
    loading: true,
    saving: false,
    configured: false,
    updatedAtText: '',
    isDevtools: false
  }, DEFAULT_CONFIG),

  onLoad() {
    const app = getApp()
    if (!app.globalData.isAdmin) {
      wx.showToast({ title: '仅操作师或管理员可进入', icon: 'none' })
      wx.navigateBack()
      return
    }
    const sys = wx.getSystemInfoSync()
    const isDevtools = sys.platform === 'devtools' || /^Windows|Mac/.test(sys.system || '')
    this.setData({ isDevtools })
    this.loadConfig()
  },

  loadConfig() {
    const app = getApp()
    app.loadStoreConfig(config => {
      const data = Object.assign({}, DEFAULT_CONFIG, config || {})
      this.setData(Object.assign({}, data, {
        loading: false,
        updatedAtText: this._formatTime(data.updatedAt)
      }))
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, field)) return
    this.setData({ [field]: e.detail.value })
  },

  saveConfig() {
    if (this.data.saving) return
    const data = {}
    Object.keys(DEFAULT_CONFIG).forEach(key => {
      data[key] = String(this.data[key] || '').trim()
    })
    if (!data.storeName) return wx.showToast({ title: '请填写门店名称', icon: 'none' })
    if (!data.address) return wx.showToast({ title: '请填写门店地址', icon: 'none' })
    if (!data.contactPhone) return wx.showToast({ title: '请填写联系电话', icon: 'none' })
    if (!/^[0-9+\-\s()]{6,30}$/.test(data.contactPhone)) {
      return wx.showToast({ title: '联系电话格式不正确', icon: 'none' })
    }

    const app = getApp()
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...', mask: true })
    wx.cloud.callFunction({
      name: 'storeService',
      data: { action: 'save', data }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.error || '保存失败')
      app.globalData.storeConfig = Object.assign({}, DEFAULT_CONFIG, result.data || data)
      this.setData({
        configured: true,
        updatedAtText: this._formatTime((result.data || {}).updatedAt)
      })
      wx.showToast({ title: '门店信息已更新', icon: 'success' })
    }).catch(err => {
      if (this.data.isDevtools) {
        const local = Object.assign({}, data, {
          configured: true,
          updatedAt: new Date().toISOString()
        })
        wx.setStorageSync('_storeConfigPreview', local)
        app.globalData.storeConfig = local
        this.setData({ configured: true, updatedAtText: this._formatTime(local.updatedAt) })
        wx.showModal({
          title: '已保存本地预览',
          content: '当前开发者微信没有云端业务管理员权限，配置仅在开发者工具中生效。请使用已加入 admins 集合的微信在真机保存。',
          showCancel: false
        })
        return
      }
      wx.showModal({
        title: '保存失败',
        content: err.message || '请稍后重试',
        showCancel: false
      })
    }).finally(() => {
      wx.hideLoading()
      this.setData({ saving: false })
    })
  },

  _formatTime(value) {
    if (!value) return ''
    return String(value).replace('T', ' ').slice(0, 16)
  }
})
