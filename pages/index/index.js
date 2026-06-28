const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    syncing: false,
    error: '',
    steamAccount: null,
    matches: [],
    hasMatches: false,
    hasMockData: false,
    summary: {
      total: 0,
      winRate: '0%',
      avgKd: '0.00',
      avgAdr: '0'
    }
  },

  onLoad() {
    this._alive = true
    this._bootstrapped = false
    this._dashboardRequestId = 0
    this.bootstrap()
  },

  onShow() {
    if (this._bootstrapped && api.getToken()) {
      this.loadDashboard(false)
    }
  },

  onUnload() {
    this._alive = false
  },

  async bootstrap() {
    this.safeSetData({ loading: true, error: '' })
    try {
      await api.login()
      this._bootstrapped = true
      await this.loadDashboard(false)
    } catch (error) {
      this.safeSetData({
        error: error.message || '后端暂时不可用',
        loading: false
      })
    }
  },

  async loadDashboard(showLoading = true) {
    const requestId = ++this._dashboardRequestId
    if (showLoading) {
      this.safeSetData({ loading: true, error: '' })
    }

    try {
      const [accountResult, matchResult] = await Promise.all([
        api.request({ path: '/api/steam/account' }),
        api.request({ path: '/api/matches' })
      ])

      const matches = (matchResult.items || []).map((item) => this.formatMatch(item))
      if (!this._alive || requestId !== this._dashboardRequestId) {
        return
      }

      this.safeSetData({
        steamAccount: accountResult.account,
        matches,
        hasMatches: matches.length > 0,
        hasMockData: matches.some((item) => item.source === 'mock'),
        summary: matchResult.summary || this.data.summary,
        loading: false
      })
    } catch (error) {
      if (!this._alive || requestId !== this._dashboardRequestId) {
        return
      }

      this.safeSetData({
        error: error.message || '数据加载失败',
        loading: false
      })
    }
  },

  formatMatch(match) {
    const resultMap = {
      win: '胜利',
      loss: '失败',
      draw: '平局'
    }

    return {
      ...match,
      showSourceTag: match.source === 'mock',
      resultText: resultMap[match.result] || '未知',
      resultClass: `result-${match.result || 'unknown'}`,
      startedAtText: this.formatDate(match.startedAt)
    }
  },

  formatDate(value) {
    if (!value) {
      return '--'
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }

    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    const hour = `${date.getHours()}`.padStart(2, '0')
    const minute = `${date.getMinutes()}`.padStart(2, '0')
    return `${month}-${day} ${hour}:${minute}`
  },

  goBind() {
    wx.navigateTo({
      url: '/pages/bind/bind'
    })
  },

  goMatch(event) {
    const id = event.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/match/match?id=${id}`
    })
  },

  async syncMatches() {
    if (!this.data.steamAccount) {
      this.goBind()
      return
    }

    this.safeSetData({ syncing: true, error: '' })
    try {
      const result = await api.request({
        path: '/api/sync',
        method: 'POST'
      })
      wx.showToast({
        title: result.message || '同步完成',
        icon: 'success'
      })
      await this.loadDashboard(false)
    } catch (error) {
      this.safeSetData({
        error: error.message || '同步失败'
      })
    } finally {
      this.safeSetData({ syncing: false })
    }
  },

  safeSetData(data) {
    if (this._alive) {
      this.setData(data)
    }
  }
})
