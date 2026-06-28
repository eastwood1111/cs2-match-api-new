const api = require('../../utils/api')

Page({
  data: {
    steamId64: '',
    steamName: '',
    matchAuthCode: '',
    knownCode: '',
    premierUrl: '',
    competitiveUrl: '',
    credentialStatus: {
      hasSteamId64: false,
      hasMatchAuthCode: false,
      hasKnownCode: false
    },
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
          competitiveUrl: account.competitiveUrl || '',
          credentialStatus: result.credentialStatus || this.data.credentialStatus
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
    const knownCode = this.data.knownCode.trim()
    if (!/^\d{17}$/.test(steamId64)) {
      this.safeSetData({ error: 'SteamID64 需要是 17 位数字' })
      return
    }

    if (knownCode && !/^CSGO(-[A-Z0-9]+){5}$/i.test(knownCode)) {
      this.safeSetData({ error: '最近比赛分享码需要是 CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx 格式，不是 Steam 网页链接' })
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
          knownCode,
          premierUrl: this.data.premierUrl.trim(),
          competitiveUrl: this.data.competitiveUrl.trim()
        }
      })

      wx.showToast({
        title: '已保存',
        icon: 'success'
      })

      this.safeSetData({
        credentialStatus: {
          hasSteamId64: Boolean(steamId64),
          hasMatchAuthCode: Boolean(this.data.matchAuthCode.trim()) || this.data.credentialStatus.hasMatchAuthCode,
          hasKnownCode: Boolean(knownCode)
        }
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
