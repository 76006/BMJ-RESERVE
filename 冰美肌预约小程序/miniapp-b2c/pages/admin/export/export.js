const exportFile = require('../../../utils/export-file')

function pad(value) {
  return String(value).padStart(2, '0')
}

function localDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fileTimestamp() {
  const now = new Date()
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

Page({
  data: {
    rows: [],
    total: 0,
    allTotal: 0,
    startDate: '',
    endDate: '',
    today: '',
    maxDate: '2099-12-31',
    allDates: false,
    rangePreset: 'month',
    rangeLabel: '',
    exportingTable: false,
    exportingArchive: false,
    tableReady: false,
    archiveReady: false
  },

  onLoad() {
    const now = new Date()
    this.setData({
      startDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      endDate: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      today: localDate(now)
    })
  },

  onShow() {
    const app = getApp()
    if (!app.globalData.isAdmin) {
      wx.showToast({ title: '仅工作人员可查看', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.loadData()
    const refreshSeq = (this._refreshSeq || 0) + 1
    this._refreshSeq = refreshSeq
    if (app._loadAllBookingsAsAdmin) {
      app._loadAllBookingsAsAdmin().then(() => {
        if (refreshSeq !== this._refreshSeq || !app.globalData.isAdmin) return
        this.loadData()
      })
    }
  },

  onUnload() {
    if (this._readyTableFile) exportFile.removeLocalFile(this._readyTableFile.filePath)
  },

  loadData() {
    const app = getApp()
    this._allBookings = app.getAllBookings()
    this.applyDateFilter()
  },

  applyDateFilter() {
    const all = Array.isArray(this._allBookings) ? this._allBookings : []
    const { allDates, startDate, endDate } = this.data
    const filtered = all.filter(booking => {
      if (allDates) return true
      const date = String(booking.visitDate || '')
      return date && (!startDate || date >= startDate) && (!endDate || date <= endDate)
    })
    const statusMap = {
      pending_confirm: '新预约',
      confirmed: '已预约',
      visited: '已到店',
      in_experience: '体验中',
      completed: '已体验',
      cancelled: '已取消',
      rejected: '已拒绝',
      expired: '已过期'
    }
    const channelMap = { direct: '直接', medical: '医疗', beauty: '生美' }
    const rows = filtered.map(booking => ({
      ...booking,
      statusLabel: statusMap[booking._status] || booking._status,
      channelLabel: channelMap[booking.channel] || booking.channel || '-',
      createdAtStr: booking.createdAt ? this.formatDate(booking.createdAt) : '-'
    }))
    this._filteredBookings = filtered
    this.setData({
      rows,
      total: rows.length,
      allTotal: all.length,
      rangeLabel: allDates ? '全部日期' : `${startDate || '最早'} 至 ${endDate || '最晚'}`
    })
  },

  onStartDateChange(e) {
    const startDate = e.detail.value
    if (this.data.endDate && startDate > this.data.endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
      return
    }
    this.dropPreparedFiles()
    this.setData({
      startDate,
      allDates: false,
      rangePreset: 'custom',
      tableReady: false,
      archiveReady: false
    }, () => this.applyDateFilter())
  },

  onEndDateChange(e) {
    const endDate = e.detail.value
    if (this.data.startDate && endDate < this.data.startDate) {
      wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' })
      return
    }
    this.dropPreparedFiles()
    this.setData({
      endDate,
      allDates: false,
      rangePreset: 'custom',
      tableReady: false,
      archiveReady: false
    }, () => this.applyDateFilter())
  },

  useCurrentMonth() {
    const now = new Date()
    this.dropPreparedFiles()
    this.setData({
      startDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      endDate: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      allDates: false,
      rangePreset: 'month',
      tableReady: false,
      archiveReady: false
    }, () => this.applyDateFilter())
  },

  useAllDates() {
    this.dropPreparedFiles()
    this.setData({
      allDates: true,
      rangePreset: 'all',
      tableReady: false,
      archiveReady: false
    }, () => this.applyDateFilter())
  },

  dropPreparedFiles() {
    if (this._readyTableFile) exportFile.removeLocalFile(this._readyTableFile.filePath)
    this._readyTableFile = null
    this._readyArchiveFile = null
    this._readyArchiveSummary = null
  },

  formatDate(ts) {
    if (!ts) return '-'
    const date = new Date(ts)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  exportTable() {
    if (this.data.exportingTable || this.data.exportingArchive) return
    if (this._readyTableFile) {
      this.sendPreparedTable()
      return
    }
    if (!this._filteredBookings || !this._filteredBookings.length) {
      wx.showToast({ title: '当前日期范围没有数据', icon: 'none' })
      return
    }
    const table = getApp().exportCSV(this._filteredBookings)
    const fileName = `冰美肌客户表格_${fileTimestamp()}.csv`
    this.setData({ exportingTable: true })
    wx.showLoading({ title: '生成表格中', mask: true })
    exportFile.writeTextFile(fileName, exportFile.buildCsv(table.headers, table.rows))
      .then(file => {
        wx.hideLoading()
        this._readyTableFile = file
        this.setData({ tableReady: true })
        wx.showToast({ title: '表格已生成，请再次点击发送', icon: 'none', duration: 2200 })
      })
      .catch(err => {
        wx.hideLoading()
        if (!exportFile.isCancelled(err)) {
          wx.showModal({ title: '导出失败', content: err.message || '表格导出失败，请重试', showCancel: false })
        }
      })
      .finally(() => this.setData({ exportingTable: false }))
  },

  sendPreparedTable() {
    const file = this._readyTableFile
    if (!file) return
    // 必须在本次点击事件中直接调用，不能放在文件生成的异步回调后。
    exportFile.shareFile(file.filePath, file.fileName)
      .then(() => {
        exportFile.removeLocalFile(file.filePath)
        this._readyTableFile = null
        this.setData({ tableReady: false })
        wx.showToast({ title: '表格已发送', icon: 'success' })
      })
      .catch(err => {
        if (!exportFile.isCancelled(err)) {
          wx.showModal({ title: '发送失败', content: exportFile.friendlyError(err, '表格发送失败，请重试'), showCancel: false })
        }
      })
  },

  exportPhotoArchive() {
    if (this.data.exportingTable || this.data.exportingArchive) return
    if (this._readyArchiveFile) {
      this.sendPreparedArchive()
      return
    }
    if (!this._filteredBookings || !this._filteredBookings.length) {
      wx.showToast({ title: '当前日期范围没有数据', icon: 'none' })
      return
    }
    const payload = {
      action: 'create',
      startDate: this.data.allDates ? '' : this.data.startDate,
      endDate: this.data.allDates ? '' : this.data.endDate
    }
    let archiveResult = null
    this.setData({ exportingArchive: true })
    wx.showLoading({ title: '整理资料中', mask: true })
    wx.cloud.callFunction({
      name: 'exportBookingArchive',
      data: payload
    }).then(res => {
      archiveResult = res.result || {}
      if (!archiveResult.success || !archiveResult.fileID) {
        throw new Error(archiveResult.error || '资料包生成失败')
      }
      wx.showLoading({ title: '下载资料中', mask: true })
      return exportFile.downloadCloudFile(archiveResult.fileID, archiveResult.fileName)
    }).then(file => {
      this.cleanupArchive(archiveResult.fileID)
      wx.hideLoading()
      this._readyArchiveFile = file
      this._readyArchiveSummary = archiveResult
      this.setData({ archiveReady: true })
      wx.showModal({
        title: '资料包已生成',
        content: '请再次点击黄色的“发送已生成资料包”按钮，然后选择文件传输助手。',
        showCancel: false
      })
    }).catch(err => {
      wx.hideLoading()
      if (archiveResult && archiveResult.fileID) this.cleanupArchive(archiveResult.fileID)
      if (!exportFile.isCancelled(err)) {
        wx.showModal({ title: '导出失败', content: exportFile.friendlyError(err, '照片资料包导出失败，请重试'), showCancel: false })
      }
    }).finally(() => this.setData({ exportingArchive: false }))
  },

  sendPreparedArchive() {
    const file = this._readyArchiveFile
    const summary = this._readyArchiveSummary || {}
    if (!file) return
    // 必须由用户的这次点击直接触发，微信才允许发送文件。
    exportFile.shareFile(file.filePath, file.fileName)
      .then(() => {
        const failedCount = (summary.failedPhotoCount || 0) + (summary.failedSignatureCount || 0)
        const failedText = failedCount
          ? `，${failedCount}个图片文件未能读取，详情见资料包内说明`
          : ''
        wx.showModal({
          title: '资料包已发送',
          content: `已整理${summary.bookingCount || 0}位客户、${summary.photoCount || 0}张照片、${summary.signatureCount || 0}份手写签名${failedText}`,
          showCancel: false
        })
      })
      .catch(err => {
        if (!exportFile.isCancelled(err)) {
          wx.showModal({ title: '发送失败', content: exportFile.friendlyError(err, '资料包发送失败，请重试'), showCancel: false })
        }
      })
  },

  cleanupArchive(fileID) {
    if (!fileID) return
    wx.cloud.callFunction({
      name: 'exportBookingArchive',
      data: { action: 'cleanup', fileID }
    }).catch(err => console.warn('[资料导出] 临时压缩包清理失败:', err))
  }
})
