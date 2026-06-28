const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    error: '',
    match: null
  },

  onLoad(options) {
    this.matchId = options.id
    this.loadMatch()
  },

  async loadMatch() {
    this.setData({ loading: true, error: '' })
    try {
      const result = await api.request({
        path: `/api/matches/${this.matchId}`
      })
      this.setData({
        match: this.formatMatch(result.match),
        loading: false
      })
    } catch (error) {
      this.setData({
        error: error.message || '比赛读取失败',
        loading: false
      })
    }
  },

  formatMatch(match) {
    if (!match) {
      return null
    }

    return {
      ...match,
      isShareCodeOnly: match.source === 'steam' && match.parseStatus === 'sharecode',
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

    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    const hour = `${date.getHours()}`.padStart(2, '0')
    const minute = `${date.getMinutes()}`.padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}`
  }
})
