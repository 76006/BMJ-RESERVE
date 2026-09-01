const app = getApp()

Page({
  data: {
    loading: true,
    admins: [],
    operators: [],
    visitors: [],
    showVisitors: false,
    showModal: false,
    inputPhone: '',
    selectedRole: 'staff'
  },

  onLoad() {
    if (app.globalData.adminRole !== 'superadmin') {
      wx.showModal({
        title: '无权限',
        content: '仅超级管理员可管理人员。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }
  },

  onShow() {
    if (app.globalData.adminRole === 'superadmin') this.loadData()
  },

  callManage(data) {
    return wx.cloud.callFunction({ name: 'manageAdmins', data }).then(res => {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.error || '操作失败')
      return result
    })
  },

  loadData() {
    this.setData({ loading: true })
    this.callManage({ action: 'overview' }).then(result => {
      const admins = []
      const operators = []
      ;(result.admins || []).forEach(item => {
        item.key = item.phone || item.openId
        if (item.role === 'staff') operators.push(item)
        else admins.push(item)
      })
      const adminKeys = new Set((result.admins || []).map(item => item.phone || item.openId))
      const visitors = (result.users || []).map(item => ({
        ...item,
        key: item.openId,
        shortId: item.openId ? item.openId.substring(0, 12) + '...' : '未知用户',
        lastVisitShort: (item.lastVisit || '').substring(0, 10),
        isAlreadyAdmin: adminKeys.has(item.phone || item.openId)
      }))
      this.setData({ admins, operators, visitors, loading: false })
    }).catch(err => {
      console.warn('[人员管理] 加载失败:', err.message || err)
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },

  toggleVisitors() { this.setData({ showVisitors: !this.data.showVisitors }) },
  showAddModal() { this.setData({ showModal: true, inputPhone: '', selectedRole: 'staff' }) },
  hideAddModal() { this.setData({ showModal: false }) },
  onPhoneInput(e) { this.setData({ inputPhone: e.detail.value }) },
  selectRole(e) { this.setData({ selectedRole: e.currentTarget.dataset.role }) },

  confirmAdd() {
    const phone = this.data.inputPhone.trim()
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    const role = this.data.selectedRole === 'admin' ? 'admin' : 'staff'
    const name = role === 'admin' ? '管理员' : '操作师'
    wx.showLoading({ title: '添加中...' })
    this.callManage({ action: 'add', phone, name, role }).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '已添加', icon: 'success' })
      this.setData({ showModal: false })
      this.loadData()
    }).catch(err => {
      wx.hideLoading()
      wx.showToast({ title: err.message || '添加失败', icon: 'none' })
    })
  },

  removePerson(e) {
    const { phone, openid, name } = e.currentTarget.dataset
    wx.showModal({
      title: '移除确认',
      content: `确认移除 ${name || phone}？移除后将不再能登录管理后台。`,
      confirmText: '确认移除',
      confirmColor: '#EF4444',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '移除中...' })
        this.callManage({ action: 'remove', phone, openId: openid }).then(() => {
          wx.hideLoading()
          wx.showToast({ title: '已移除', icon: 'success' })
          this.loadData()
        }).catch(err => {
          wx.hideLoading()
          wx.showToast({ title: err.message || '移除失败', icon: 'none' })
        })
      }
    })
  },

  addFromVisitor(e) {
    const openId = e.currentTarget.dataset.openid
    wx.showModal({
      title: '添加操作师',
      editable: true,
      placeholderText: '请输入操作师姓名',
      success: res => {
        const name = (res.content || '').trim()
        if (!res.confirm || !name) return
        wx.showLoading({ title: '添加中...' })
        this.callManage({ action: 'add', openId, name, role: 'staff' }).then(() => {
          wx.hideLoading()
          wx.showToast({ title: '已添加', icon: 'success' })
          this.loadData()
        }).catch(err => {
          wx.hideLoading()
          wx.showToast({ title: err.message || '添加失败', icon: 'none' })
        })
      }
    })
  },

  stop() {}
})
