const app = getApp()

Page({
  data: {
    loading: true,
    admins: [],        // 管理员列表（含超级管理员）
    operators: [],     // 操作师列表
    visitors: [],      // 访客列表
    showVisitors: false,
    showModal: false,
    inputPhone: '',
    selectedRole: 'staff'
  },

  onLoad() {
    const role = app.globalData.adminRole || ''
    if (role !== 'superadmin') {
      wx.showModal({
        title: '无权限',
        content: '仅超级管理员可管理人员。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
  },

  onShow() {
    this.loadData()
  },

  loadData() {
    this.setData({ loading: true })
    const db = wx.cloud.database()
    if (!db) {
      wx.showToast({ title: '云开发未初始化', icon: 'none' })
      this.setData({ loading: false })
      return
    }

    let admins = []
    let operators = []
    let visitors = []
    let loaded = 0

    const done = () => {
      loaded++
      if (loaded >= 2) {
        // 处理访客列表：标记是否已添加
        const adminPhones = [...admins, ...operators].map(a => a.phone)
        const visitorList = visitors.map(v => ({
          ...v,
          shortId: (v.openId || '').substring(0, 12) + '...',
          lastVisitShort: (v.lastVisit || '').substring(0, 10),
          isAlreadyAdmin: adminPhones.includes(v.phone)
        }))

        this.setData({
          admins,
          operators,
          visitors: visitorList,
          loading: false
        })
      }
    }

    // 1. 加载 admins 集合
    var admTimer = setTimeout(function () {
      console.warn('[人员管理] admins 查询超时')
      done()
    }, 4500)
    db.collection('admins').where({
      active: db.command.neq(false)
    }).get().then(res => {
      clearTimeout(admTimer)
      const list = res.data || []
      const adminsList = []
      const opsList = []
      list.forEach(item => {
        if (item.role === 'superadmin' || item.role === 'admin') {
          adminsList.push(item)
        } else if (item.role === 'staff') {
          opsList.push(item)
        }
      })
      admins = adminsList
      operators = opsList
      done()
    }).catch(function (err) {
      clearTimeout(admTimer)
      console.warn('[人员管理] admins 读取失败:', err && err.message ? err.message : err)
      done()
    })

    // 2. 加载访客（users 集合）
    app.getAllUsers(list => {
      visitors = list || []
      done()
    })
  },

  toggleVisitors() {
    this.setData({ showVisitors: !this.data.showVisitors })
  },

  showAddModal() {
    this.setData({ showModal: true, inputPhone: '', selectedRole: 'staff' })
  },

  hideAddModal() {
    this.setData({ showModal: false })
  },

  onPhoneInput(e) {
    this.setData({ inputPhone: e.detail.value })
  },

  selectRole(e) {
    this.setData({ selectedRole: e.currentTarget.dataset.role })
  },

  confirmAdd() {
    const phone = this.data.inputPhone.trim()
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }

    const role = this.data.selectedRole
    const name = role === 'admin' ? '管理员' : '操作师'
    const db = wx.cloud.database()

    wx.showLoading({ title: '添加中...' })

    // 先查是否已存在
    db.collection('admins').where({ phone }).limit(1).get()
      .then(res => {
        if (res.data && res.data.length > 0) {
          const doc = res.data[0]
          return db.collection('admins').doc(doc._id).update({
            data: {
              name,
              role,
              active: true,
              updatedAt: new Date().toISOString()
            }
          })
        } else {
          return db.collection('admins').add({
            data: {
              phone,
              name,
              role,
              openId: '',
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          })
        }
      })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已添加', icon: 'success' })
        this.setData({ showModal: false })
        this.loadData()
      })
      .catch(err => {
        wx.hideLoading()
        console.error('[人员] 添加失败:', err)
        wx.showModal({
          title: '添加失败',
          content: '请确保数据库权限设置为「所有用户可读写」。',
          showCancel: false
        })
      })
  },

  removePerson(e) {
    const { phone, name } = e.currentTarget.dataset
    wx.showModal({
      title: '移除确认',
      content: `确认移除 ${name || phone}？移除后将不再能登录管理后台。`,
      confirmText: '确认移除',
      confirmColor: '#EF4444',
      success: (res) => {
        if (!res.confirm) return
        const db = wx.cloud.database()
        wx.showLoading({ title: '移除中...' })
        db.collection('admins').where({ phone }).limit(1).get()
          .then(res => {
            if (res.data && res.data[0]) {
              return db.collection('admins').doc(res.data[0]._id).update({
                data: { active: false, updatedAt: new Date().toISOString() }
              })
            }
            throw new Error('未找到记录')
          })
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已移除', icon: 'success' })
            this.loadData()
          })
          .catch(err => {
            wx.hideLoading()
            wx.showToast({ title: '移除失败', icon: 'none' })
          })
      }
    })
  },

  addFromVisitor(e) {
    const openid = e.currentTarget.dataset.openid
    wx.showModal({
      title: '添加操作师',
      editable: true,
      placeholderText: '请输入操作师姓名',
      success: (res) => {
        if (res.confirm && res.content) {
          wx.showLoading({ title: '添加中...' })
          // 改用云数据库直接写入（避免 app.addAdmin 的竞态风险）
          const db = wx.cloud.database()
          db.collection('admins').add({
            data: {
              openId: openid,
              name: res.content,
              role: 'staff',
              phone: '',
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          }).then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已添加', icon: 'success' })
            this.loadData()  // 云写入完成后刷新列表
          }).catch(err => {
            wx.hideLoading()
            console.error('[人员] 访客添加失败:', err)
            wx.showToast({ title: '添加失败', icon: 'none' })
          })
        }
      }
    })
  },

  // 阻止手势穿透（catchtouchmove 绑定用）
  stop() {}
})
