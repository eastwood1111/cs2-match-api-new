const api = require('../../utils/api')

Page({
  data: {
    steamId64: '',
    steamName: '',
    matchAuthCode: '',
    knownCode: '',
    premierUrl: '',
    competitiveUrl: '',
    saving: false,
    error: ''
  },

  onLoad() {
    this._alive = true
    this.loadAccount()
  },

  onUnload() {
    this._alive = false
  },

  async loadAccount() {
    try {
      const result = await api.request({ path: '/api/steam/account' })
      const account = result.account
      if (account) {
        this.safeSetData({
          steamId64: account.steamId64 || '',
          steamName: account.steamName || '',
          knownCode: account.knownCode || '',
          premierUrl: account.premierUrl || '',
          competitiveUrl: account.competitiveUrl || ''
        })
      }
    } catch (error) {
      this.safeSetData({
        error: error.message || '账号读取失败'
      })
    }
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    const data = {
      [field]: event.detail.value
    }

    if ((field === 'premierUrl' || field === 'competitiveUrl') && !this.data.steamId64) {
      const steamId64 = extractSteamId64(value)
      if (steamId64) {
        data.steamId64 = steamId64
      }
    }

    this.setData(data)
  },

  async save() {
    const steamId64 = this.data.steamId64.trim()
    if (!/^\d{17}$/.test(steamId64)) {
      this.safeSetData({ error: 'SteamID64 需要是 17 位数字' })
      return
    }

    this.safeSetData({ saving: true, error: '' })
    try {
      await api.request({
        path: '/api/steam/bind',
        method: 'POST',
        data: {
          steamId64,
          steamName: this.data.steamName.trim(),
          matchAuthCode: this.data.matchAuthCode.trim(),
          knownCode: this.data.knownCode.trim(),
          premierUrl: this.data.premierUrl.trim(),
          competitiveUrl: this.data.competitiveUrl.trim()
        }
      })

      wx.showToast({
        title: '已保存',
        icon: 'success'
      })

      setTimeout(() => {
        const pages = getCurrentPages()
        if (pages.length > 1) {
          wx.navigateBack()
          return
        }

        wx.redirectTo({
          url: '/pages/index/index'
        })
      }, 400)
    } catch (error) {
      this.safeSetData({
        error: error.message || '保存失败'
      })
    } finally {
      this.safeSetData({ saving: false })
    }
  },

  safeSetData(data) {
    if (this._alive) {
      this.setData(data)
    }
  }
})

function extractSteamId64(value) {
  const match = String(value || '').match(/\/profiles\/(\d{17})(?:\/|$)/)
  return match ? match[1] : ''
}
