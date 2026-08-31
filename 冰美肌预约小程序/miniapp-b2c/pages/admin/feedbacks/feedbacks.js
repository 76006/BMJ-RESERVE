var AREA_CONFIG_30 = [
  { key: 'nasolabial', label: '法令纹淡化（1-5分）' },
  { key: 'forehead', label: '抬头纹淡化（1-5分）' },
  { key: 'marionette', label: '木偶纹淡化（1-5分）' },
  { key: 'skintone', label: '肤色改善（1-5分）' },
  { key: 'applemuscle', label: '苹果肌上移（1-5分）' },
  { key: 'jawline', label: '下颌线清晰（1-5分）' },
  { key: 'environment', label: '环境舒适度（1-5分）' },
  { key: 'quiet', label: '室内安静度（1-5分）' },
  { key: 'device', label: '仪器舒适度（1-5分）' },
  { key: 'flow', label: '流程便利性（1-5分）' },
  { key: 'recommend', label: '愿意推荐度（1-5分）' },
  { key: 'text', label: '文字反馈（客户填写感受）' }
]

var AREA_CONFIG_90 = [
  { key: 'nasolabial', label: '法令纹淡化（1-5分）' },
  { key: 'forehead', label: '抬头纹淡化（1-5分）' },
  { key: 'marionette', label: '木偶纹淡化（1-5分）' },
  { key: 'skintone', label: '肤色改善（1-5分）' },
  { key: 'applemuscle', label: '苹果肌上移（1-5分）' },
  { key: 'jawline', label: '下颌线清晰（1-5分）' },
  { key: 'environment', label: '环境舒适度（1-5分）' },
  { key: 'quiet', label: '室内安静度（1-5分）' },
  { key: 'device', label: '仪器舒适度（1-5分）' },
  { key: 'flow', label: '流程便利性（1-5分）' },
  { key: 'recommend', label: '愿意推荐度（1-5分）' },
  { key: 'text', label: '文字反馈（客户填写感受）' },
  { key: 'revisit', label: '二次体验意愿（是/否）' }
]

Page({
  data: {
    currentTab: 'list',
    filterMode: 'all',
    allFeedbacks: [],
    filteredFeedbacks: [],
    fb24Count: 0,
    fb30Count: 0,
    fb90Count: 0,
    avgScore: '--',
    pendingCount: 0,
    tmpl30: [],
    tmpl90: [],
    sms30Enabled: false,
    sms90Enabled: false,
    showDetail: false,
    detailData: null
  },

  onShow: function () {
    if (!getApp().globalData.isAdmin) {
      wx.showModal({ title: '无权限', content: '仅管理员可访问。', showCancel: false, success: () => wx.navigateBack() })
      return
    }
    this.initTmpl()
    this.loadSmsConfig()
    this.loadData()
  },

  initTmpl: function () {
    var saved = wx.getStorageSync('_feedbackTmpl')
    if (saved && saved.tmpl30) {
      this.setData({ tmpl30: saved.tmpl30, tmpl90: saved.tmpl90 })
      return
    }
    var t30 = []
    var t90 = []
    for (var i = 0; i < AREA_CONFIG_30.length; i++) {
      t30.push({ key: AREA_CONFIG_30[i].key, label: AREA_CONFIG_30[i].label })
    }
    for (var j = 0; j < AREA_CONFIG_90.length; j++) {
      t90.push({ key: AREA_CONFIG_90[j].key, label: AREA_CONFIG_90[j].label })
    }
    this.setData({ tmpl30: t30, tmpl90: t90 })
  },

  loadSmsConfig: function () {
    var saved = wx.getStorageSync('_smsConfig')
    if (saved) {
      this.setData({ sms30Enabled: saved.sms30 || false, sms90Enabled: saved.sms90 || false })
    }
  },

  toggleSms30: function (e) {
    var val = e.detail.value
    this.setData({ sms30Enabled: val })
    var cfg = wx.getStorageSync('_smsConfig') || {}
    cfg.sms30 = val
    wx.setStorageSync('_smsConfig', cfg)
    wx.showToast({ title: val ? '\u5df2\u5f00\u542f' : '\u5df2\u5173\u95ed', icon: 'none' })
  },

  toggleSms90: function (e) {
    var val = e.detail.value
    this.setData({ sms90Enabled: val })
    var cfg = wx.getStorageSync('_smsConfig') || {}
    cfg.sms90 = val
    wx.setStorageSync('_smsConfig', cfg)
    wx.showToast({ title: val ? '\u5df2\u5f00\u542f' : '\u5df2\u5173\u95ed', icon: 'none' })
  },

  loadData: function () {
    var self = this
    var app = getApp()
    var bookings = app.globalData.bookings || []

    // 优先从云数据库加载，降级到本地
    var db = app.globalData.db
    if (db) {
      var timer = setTimeout(function () {
        console.warn('[feedback] 查询超时，降级到本地数据')
        var localFbs = wx.getStorageSync('feedbacks') || []
        self._processData(localFbs, bookings)
      }, 4500)
      db.collection('feedbacks').where({}).limit(200).get()
        .then(function (res) {
          clearTimeout(timer)
          var cloudFbs = res.data || []
          // 合并本地数据（去重）
          var localFbs = wx.getStorageSync('feedbacks') || []
          var merged = self._mergeFeedbacks(cloudFbs, localFbs)
          // 缓存到本地
          wx.setStorageSync('feedbacks', merged)
          self._processData(merged, bookings)
        })
        .catch(function (err) {
          clearTimeout(timer)
          console.warn('[feedback] 云端读取失败，降级到本地:', err && err.message ? err.message : err)
          var localFbs = wx.getStorageSync('feedbacks') || []
          self._processData(localFbs, bookings)
        })
    } else {
      var localFbs2 = wx.getStorageSync('feedbacks') || []
      this._processData(localFbs2, bookings)
    }
  },

  _mergeFeedbacks: function (cloudList, localList) {
    var merged = []
    var seen = {}
    for (var i = 0; i < cloudList.length; i++) {
      var f = cloudList[i]
      var key = f.recordId + '_' + f.mode
      if (!seen[key]) {
        seen[key] = true
        merged.push(f)
      }
    }
    for (var j = 0; j < localList.length; j++) {
      var f2 = localList[j]
      var key2 = f2.recordId + '_' + f2.mode
      if (!seen[key2]) {
        seen[key2] = true
        merged.push(f2)
      }
    }
    return merged
  },

  _processData: function (localFbs, bookings) {
    var now = Date.now()
    var DAY = 86400000
    var pending30 = 0
    var pending90 = 0

    for (var bi = 0; bi < bookings.length; bi++) {
      var b = bookings[bi]
      if (b._status === 'visited' || b._status === 'in_experience' || b._status === 'completed') {
        var vd = new Date(b.visitDate)
        if (isNaN(vd.getTime())) continue
        var days = Math.floor((now - vd.getTime()) / DAY)
        var has30 = false
        var has90 = false
        for (var fi = 0; fi < localFbs.length; fi++) {
          if (localFbs[fi].recordId === b.id) {
            if (localFbs[fi].mode === '30') has30 = true
            if (localFbs[fi].mode === '90') has90 = true
          }
        }
        if (!has30 && days >= 25 && days <= 35) pending30++
        if (!has90 && days >= 85 && days <= 95) pending90++
      }
    }

    var list = []
    for (var li = 0; li < localFbs.length; li++) {
      var fb = {}
      for (var k in localFbs[li]) { fb[k] = localFbs[li][k] }
      fb.customerName = '\u672a\u77e5'
      for (var bi2 = 0; bi2 < bookings.length; bi2++) {
        if (bookings[bi2].id === fb.recordId) {
          fb.customerName = bookings[bi2].name || '\u672a\u77e5'
          break
        }
      }

      if (fb.submittedAt) {
        try {
          var d = new Date(fb.submittedAt)
          var m = d.getMonth() + 1
          var dd = d.getDate()
          var hh = String(d.getHours())
          var mm = String(d.getMinutes())
          if (hh.length < 2) hh = '0' + hh
          if (mm.length < 2) mm = '0' + mm
          fb.submittedAt = m + '\u6708' + dd + '\u65e5 ' + hh + ':' + mm
        } catch (e) {}
      }

      // 计算体验满意度平均分
      var expArr = fb.experience
      if (Array.isArray(expArr) && expArr.length > 0) {
        var rated = expArr.filter(function(e) { return e.score > 0 })
        if (rated.length > 0) {
          fb._avgScore = (rated.reduce(function(s, e) { return s + e.score }, 0) / rated.length).toFixed(1)
        } else {
          fb._avgScore = '-'
        }
      } else {
        fb._avgScore = '-'
      }

      list.push(fb)
    }

    list.sort(function (a, b) {
      return (b.submittedAt || '').localeCompare(a.submittedAt || '')
    })

    var f24l = []
    var f30l = []
    var f90l = []
    var totalRated = 0
    var sumScore = 0
    for (var ri = 0; ri < list.length; ri++) {
      if (list[ri].mode === '24h') f24l.push(list[ri])
      if (list[ri].mode === '30') f30l.push(list[ri])
      if (list[ri].mode === '90') f90l.push(list[ri])
      var expArr = list[ri].experience
      if (Array.isArray(expArr) && expArr.length > 0) {
        var rated = expArr.filter(function(e) { return e.score > 0 })
        if (rated.length > 0) {
          totalRated++
          var avgExp = rated.reduce(function(s, e) { return s + e.score }, 0) / rated.length
          sumScore += avgExp
        }
      }
    }

    var avg = '--'
    if (totalRated > 0) avg = (sumScore / totalRated).toFixed(1)

    this.setData({
      allFeedbacks: list,
      filteredFeedbacks: list,
      fb24Count: f24l.length,
      fb30Count: f30l.length,
      fb90Count: f90l.length,
      avgScore: avg,
      pendingCount: pending30 + pending90
    })

    this.applyFilter()
  },

  switchTab: function (e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab })
  },

  setFilter: function (e) {
    this.setData({ filterMode: e.currentTarget.dataset.mode })
    this.applyFilter()
  },

  applyFilter: function () {
    var mode = this.data.filterMode
    var list = this.data.allFeedbacks
    if (mode !== 'all') {
      var result = []
      for (var i = 0; i < list.length; i++) {
        if (list[i].mode === mode) result.push(list[i])
      }
      list = result
    }
    this.setData({ filteredFeedbacks: list })
  },

  viewDetail: function (e) {
    var idx = e.currentTarget.dataset.idx
    var item = this.data.filteredFeedbacks[idx]
    if (!item) return

    var lines = []
    var modeLabel = item.mode === '24h' ? '24小时' : (item.mode + '天')
    lines.push('\u56de\u8bbf\u7c7b\u578b\uff1a' + modeLabel)
    lines.push('\u5ba2\u6237\uff1a' + (item.customerName || ''))
    if (Array.isArray(item.areas)) {
      item.areas.forEach(function(a) {
        if (a.score > 0) lines.push(a.label + '\uff1a' + a.score + '\u5206')
      })
    }
    if (Array.isArray(item.experience)) {
      item.experience.forEach(function(exp) {
        if (exp.score > 0) lines.push(exp.label + '\uff1a' + exp.score + '\u5206')
      })
    }
    if (Array.isArray(item.therapist)) {
      lines.push('\u2500\u2500\u64cd\u4f5c\u5e08\u8bc4\u4ef7\u2500\u2500')
      item.therapist.forEach(function(t) {
        if (t.score > 0) lines.push(t.label + '\uff1a' + t.score + '\u5206')
      })
    }
    if (item._avgScore && item._avgScore !== '-') lines.push('\u4f53\u9a8c\u6ee1\u610f\u5ea6\u5747\u5206\uff1a' + item._avgScore + '\u5206')
    if (item.text) lines.push('\u6587\u5b57\u53cd\u9988\uff1a' + item.text)
    if (item.revisit !== undefined) lines.push('\u4e8c\u6b21\u4f53\u9a8c\uff1a' + (item.revisit ? '\u613f\u610f' : '\u4e0d\u613f\u610f'))

    wx.showModal({
      title: '\u56de\u8bbf\u8be6\u60c5',
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '\u5173\u95ed'
    })
  },

  preview30: function () {
    wx.navigateTo({ url: '/pages/feedback/feedback?mode=30&preview=1' })
  },

  preview90: function () {
    wx.navigateTo({ url: '/pages/feedback/feedback?mode=90&preview=1' })
  },

  editQuestion: function (e) {
    var type = e.currentTarget.dataset.type
    var idx = parseInt(e.currentTarget.dataset.idx)
    var tmplKey = type === '30' ? 'tmpl30' : 'tmpl90'
    var currentItem = this.data[tmplKey][idx]
    var self = this
    wx.showModal({
      title: '\u7f16\u8f91\u95ee\u9898',
      editable: true,
      placeholderText: '\u8f93\u5165\u95ee\u9898\u5185\u5bb9',
      content: currentItem.label,
      success: function (res) {
        if (res.confirm && res.content && res.content.trim()) {
          var updated = []
          for (var i = 0; i < self.data[tmplKey].length; i++) {
            updated.push({})
            for (var k in self.data[tmplKey][i]) { updated[i][k] = self.data[tmplKey][i][k] }
          }
          updated[idx].label = res.content.trim()

          var obj = {}
          obj[tmplKey] = updated
          self.setData(obj)

          wx.setStorageSync('_feedbackTmpl', {
            tmpl30: self.data.tmpl30,
            tmpl90: self.data.tmpl90
          })
          wx.showToast({ title: '\u5df2\u4fdd\u5b58', icon: 'success' })
        }
      }
    })
  }
})
