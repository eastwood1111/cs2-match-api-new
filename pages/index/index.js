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
    dashboard: {
      total: 0,
      pendingTotal: 0,
      parsedTotal: 0,
      latestText: '--'
    },
    summary: {
      total: 0,
      parsedTotal: 0,
      pendingTotal: 0,
      winRate: '--',
      avgKd: '--',
      avgAdr: '--'
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
      const summary = this.normalizeSummary(matchResult.summary, matches)
      if (!this._alive || requestId !== this._dashboardRequestId) {
        return
      }

      this.safeSetData({
        steamAccount: accountResult.account,
        matches,
        hasMatches: matches.length > 0,
        hasMockData: matches.some((item) => item.source === 'mock'),
        dashboard: this.buildDashboard(matches, summary),
        summary,
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

  normalizeSummary(summary = {}, matches) {
    const total = Number.isFinite(summary.total) ? summary.total : matches.length
    const pendingTotal = Number.isFinite(summary.pendingTotal)
      ? summary.pendingTotal
      : matches.filter((item) => item.isShareCodeOnly || item.result === 'pending').length
    const parsedTotal = Number.isFinite(summary.parsedTotal)
      ? summary.parsedTotal
      : Math.max(total - pendingTotal, 0)

    return {
      total,
      parsedTotal,
      pendingTotal,
      steamTotal: Number.isFinite(summary.steamTotal)
        ? summary.steamTotal
        : matches.filter((item) => item.source === 'steam').length,
      latestSyncAt: summary.latestSyncAt || (matches[0] && matches[0].startedAt) || '',
      winRate: summary.winRate || '--',
      avgKd: summary.avgKd || '--',
      avgAdr: summary.avgAdr || '--'
    }
  },

  buildDashboard(matches, summary) {
    return {
      total: summary.total || matches.length,
      pendingTotal: summary.pendingTotal || 0,
      parsedTotal: summary.parsedTotal || 0,
      latestText: this.formatShortDate(summary.latestSyncAt)
    }
  },

  formatMatch(match) {
    const isShareCodeOnly = match.source === 'steam' && match.parseStatus === 'sharecode'
    const scoreParts = splitScore(match.score)

    return {
      ...match,
      isShareCodeOnly,
      resultLabel: getResultLabel(match.result, isShareCodeOnly),
      resultBadgeClass: `badge-${match.result || 'pending'}`,
      resultDate: this.formatShortDate(match.startedAt),
      scoreLeft: isShareCodeOnly ? '--' : scoreParts.left,
      scoreRight: isShareCodeOnly ? '--' : scoreParts.right,
      scoreClass: `score-${match.result || 'pending'}`,
      mapText: isShareCodeOnly ? '待解析' : match.mapName,
      modeText: isShareCodeOnly ? 'Steam 官匹' : match.mode,
      kdaText: isShareCodeOnly ? '--/--/--' : `${match.kills}/${match.deaths}/${match.assists}`,
      adrText: isShareCodeOnly ? '--' : `${match.adr || 0}`,
      isMvp: !isShareCodeOnly && match.result === 'win' && Number(match.kills || 0) >= 18
    }
  },

  formatShortDate(value) {
    if (!value) {
      return '--'
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }

    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${month}-${day}`
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
        method: 'POST',
        data: {
          limit: 100
        }
      })
      wx.showToast({
        title: result.message || '同步完成',
        icon: 'success'
      })
      await this.loadDashboard(false)
    } catch (error) {
      this.safeSetData({
        error: error.message ? `同步失败：${error.message}` : '同步失败'
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

function splitScore(value) {
  const text = String(value || '--').trim()
  const match = text.match(/^(\d+)\s*[-:]\s*(\d+)$/)
  if (!match) {
    return { left: '--', right: '--' }
  }
  return { left: match[1], right: match[2] }
}

function getResultLabel(result, isShareCodeOnly) {
  if (isShareCodeOnly || result === 'pending') {
    return '待'
  }
  if (result === 'win') {
    return '胜'
  }
  if (result === 'loss') {
    return '负'
  }
  if (result === 'draw') {
    return '平'
  }
  return '待'
}
