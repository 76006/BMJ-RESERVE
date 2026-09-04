// 操作师二维码 + 门店签到码配置页
Page({
  data: {
    trainers: [],
    newTrainerId: '',
    newTrainerName: '',
    newChannel: 'beauty',
    channelOptions: ['beauty', 'medical'],
    channelLabels: ['生美渠道', '医疗渠道'],
    channelIdx: 0,
    showAddForm: false,
    trainersLoading: false,
    trainersSaving: false,
    // 门店签到码
    checkinCodeReady: false,
    checkinCodeUrl: '',
    checkinCodeFileID: ''
  },

  onLoad() {
    const role = (getApp().globalData.adminRole || wx.getStorageSync('_adminRole') || '')
    if (!['staff', 'admin', 'superadmin'].includes(role)) {
      wx.showModal({ title: '无权限', content: '仅工作人员可访问。', showCancel: false, success: () => wx.navigateBack() })
      return
    }
    this.loadTrainers()
    this._loadCachedCheckinCode()
  },

  loadTrainers() {
    const list = wx.getStorageSync('trainers') || []
    this.setData({ trainers: list, trainersLoading: true })
    wx.cloud.callFunction({
      name: 'storeService',
      data: { action: 'getTrainers' }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.error || '读取配置失败')
      const trainers = Array.isArray(result.data) ? result.data : []
      wx.setStorageSync('trainers', trainers)
      this.setData({ trainers })
    }).catch(err => {
      console.warn('[二维码配置] 云端读取失败，暂用本机缓存:', err)
      wx.showToast({ title: '云端配置读取失败，当前显示本机缓存', icon: 'none' })
    }).finally(() => this.setData({ trainersLoading: false }))
  },

  _saveTrainers(list) {
    if (this.data.trainersSaving) return Promise.reject(new Error('配置正在保存，请稍候'))
    this.setData({ trainersSaving: true })
    wx.showLoading({ title: '正在同步', mask: true })
    return wx.cloud.callFunction({
      name: 'storeService',
      data: { action: 'saveTrainers', data: list }
    }).then(res => {
      const result = res.result || {}
      if (!result.success) throw new Error(result.error || '同步失败')
      const trainers = Array.isArray(result.data) ? result.data : []
      wx.setStorageSync('trainers', trainers)
      this.setData({ trainers })
      return trainers
    }).finally(() => {
      wx.hideLoading()
      this.setData({ trainersSaving: false })
    })
  },

  // ===== 操作师管理 =====

  toggleAddForm() {
    this.setData({ showAddForm: !this.data.showAddForm })
  },

  onTrainerId(e) { this.setData({ newTrainerId: e.detail.value }) },
  onTrainerName(e) { this.setData({ newTrainerName: e.detail.value }) },
  onChannel(e) {
    const idx = Number(e.detail.value)
    this.setData({ channelIdx: idx, newChannel: this.data.channelOptions[idx] })
  },

  addTrainer() {
    const { newTrainerId, newTrainerName, newChannel } = this.data
    const id = newTrainerId.trim()
    const name = newTrainerName.trim()
    if (!id || !name) {
      wx.showToast({ title: '请填写ID和姓名', icon: 'none' })
      return
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      wx.showToast({ title: 'ID只能包含字母、数字、下划线和短横线', icon: 'none' })
      return
    }
    const list = [...this.data.trainers]
    if (list.some(item => item.id === id)) {
      wx.showToast({ title: '该操作师ID已经存在', icon: 'none' })
      return
    }
    list.push({
      id,
      name,
      channel: newChannel
    })
    this._saveTrainers(list).then(() => {
      this.setData({ newTrainerId: '', newTrainerName: '', showAddForm: false })
      wx.showToast({ title: '已添加并同步', icon: 'success' })
    }).catch(err => {
      wx.showToast({ title: err.message || '添加失败，请重试', icon: 'none' })
    })
  },

  deleteTrainer(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '删除该操作师配置？',
      success: (res) => {
        if (res.confirm) {
          const list = this.data.trainers.filter(t => t.id !== id)
          this._saveTrainers(list).then(() => {
            wx.showToast({ title: '已删除并同步', icon: 'success' })
          }).catch(err => {
            wx.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
          })
        }
      }
    })
  },

  copyScene(e) {
    const scene = e.currentTarget.dataset.scene
    const tip = `page=pages/index/index\nscene=${scene}\n\n将以上参数提交微信平台或使用云开发生成小程序码`
    wx.setClipboardData({
      data: tip,
      success: () => {
        wx.showToast({ title: '参数已复制', icon: 'success' })
      }
    })
  },

  goBack() {
    wx.navigateBack()
  },

  // ===== 门店签到码 =====
  genCheckinCode() {
    let envVersion = 'release'
    try {
      const account = wx.getAccountInfoSync()
      envVersion = account && account.miniProgram && account.miniProgram.envVersion
        ? account.miniProgram.envVersion
        : 'release'
    } catch (e) { /* 使用正式版兜底 */ }

    wx.showLoading({ title: '生成中...', mask: true })
    wx.cloud.callFunction({
      name: 'genCheckinCode',
      data: { envVersion },
      // 云函数内要调微信接口，给足时间
      timeout: 20000,
      success: res => {
        wx.hideLoading()
        const r = res.result
        if (r && r.success && r.codeUrl) {
          this.setData({
            checkinCodeReady: true,
            checkinCodeUrl: r.codeUrl,
            checkinCodeFileID: r.fileID || ''
          })
          wx.setStorageSync('_checkinCodeUrl', r.codeUrl)
          wx.setStorageSync('_checkinCodeFileID', r.fileID || '')
          wx.showModal({
            title: '签到码已生成',
            content: '长按二维码图片可保存到相册，打印后贴在门店前台即可。顾客扫码后自动进入签到流程。',
            showCancel: false,
            confirmText: '查看二维码',
            success: () => {
              const previewUrl = this.data.checkinCodeFileID || this.data.checkinCodeUrl
              wx.previewImage({ urls: [previewUrl] })
            }
          })
        } else {
          // 云函数返回了明确错误，显示完整信息
          const errorMsg = (r && r.error) || '请稍后重试'
          wx.showModal({ title: '生成失败', content: errorMsg, showCancel: false })
          console.error('[genCheckinCode] 云函数返回:', r)
        }
      },
      fail: err => {
        wx.hideLoading()
        // 客户端调用失败：超时 / 未部署 / 网络问题
        const msg = err.errMsg || JSON.stringify(err)
        wx.showModal({ title: '生成失败', content: msg, showCancel: false })
        console.error('[genCheckinCode] 调用失败:', err)
      }
    })
  },

  previewCheckinCode() {
    const previewUrl = this.data.checkinCodeFileID || this.data.checkinCodeUrl
    if (previewUrl) wx.previewImage({ urls: [previewUrl] })
  },

  _loadCachedCheckinCode() {
    const fileID = wx.getStorageSync('_checkinCodeFileID')
    const url = wx.getStorageSync('_checkinCodeUrl')
    if (fileID) {
      this.setData({ checkinCodeReady: true, checkinCodeFileID: fileID, checkinCodeUrl: url || '' })
    } else if (url) {
      // 旧缓存只有临时 URL（会过期），直接清理，让用户重新生成
      wx.removeStorageSync('_checkinCodeUrl')
    }
  },

  // 图片加载失败：临时 URL 过期或 fileID 失效
  onCodeImageError(e) {
    console.error('[qrconfig] 签到码图片加载失败:', e.detail)
    wx.removeStorageSync('_checkinCodeUrl')
    wx.removeStorageSync('_checkinCodeFileID')
    this.setData({ checkinCodeReady: false, checkinCodeUrl: '', checkinCodeFileID: '' })
    wx.showToast({ title: '二维码已过期，请重新生成', icon: 'none' })
  }
})
