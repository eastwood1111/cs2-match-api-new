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

    const isShareCodeOnly = match.source === 'steam' && match.parseStatus === 'sharecode'
    const score = splitScore(match.score)
    const resultText = getResultText(match.result, isShareCodeOnly)
    const players = buildPlayerRows(match, isShareCodeOnly)
    const currentPlayer = players.find((player) => player.isCurrentUser) || players[0]

    return {
      ...match,
      isShareCodeOnly,
      resultText,
      resultHeroClass: `hero-${match.result || 'pending'}`,
      teamResultText: isShareCodeOnly ? '待解析' : resultText,
      scoreLeft: isShareCodeOnly ? '--' : score.left,
      scoreRight: isShareCodeOnly ? '--' : score.right,
      roundLine: isShareCodeOnly ? '-- - -- / -- - --' : `${score.left} - ${score.right} / -- - --`,
      mapText: isShareCodeOnly ? '待解析' : match.mapName,
      modeText: isShareCodeOnly ? 'Steam 官匹' : match.mode,
      endedAtText: this.formatShortDate(match.startedAt),
      durationText: isShareCodeOnly ? '需解析' : formatDuration(match.durationSeconds),
      heroMeta: [
        { label: '结束时间', value: this.formatShortDate(match.startedAt) },
        { label: '比赛时长', value: isShareCodeOnly ? '需解析' : formatDuration(match.durationSeconds) },
        { label: '比赛地图', value: isShareCodeOnly ? '待解析' : match.mapName },
        { label: '匹配方式', value: isShareCodeOnly ? 'Steam 官匹' : match.mode }
      ],
      tabs: [
        { label: '数据总览', active: true },
        { label: '趣味数据', active: false },
        { label: '对位数据', active: false }
      ],
      currentPlayer,
      statBlocks: buildStatBlocks(match, isShareCodeOnly),
      playerRows: players,
      roundHeader: buildRoundHeader(),
      roundRows: buildRoundRows(isShareCodeOnly),
      shareCodeText: match.shareCode || '--'
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

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
      return
    }

    wx.redirectTo({
      url: '/pages/index/index'
    })
  },

  copyShareCode() {
    if (!this.data.match || !this.data.match.shareCode) {
      return
    }

    wx.setClipboardData({
      data: this.data.match.shareCode
    })
  },

  showDemoHint() {
    wx.showToast({
      title: 'DEMO 待接入',
      icon: 'none'
    })
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

function getResultText(result, isShareCodeOnly) {
  if (isShareCodeOnly || result === 'pending') {
    return '待解析'
  }
  if (result === 'win') {
    return '胜利'
  }
  if (result === 'loss') {
    return '失败'
  }
  if (result === 'draw') {
    return '平局'
  }
  return '待解析'
}

function formatDuration(seconds) {
  const value = Number(seconds || 0)
  if (!value) {
    return '--'
  }
  return `${Math.round(value / 60)}分钟`
}

function formatRating(value, isShareCodeOnly) {
  const rating = Number(value || 0)
  if (isShareCodeOnly || !rating) {
    return '--'
  }
  return rating.toFixed(2)
}

function buildStatBlocks(match, isShareCodeOnly) {
  if (isShareCodeOnly) {
    return [
      { value: '--', label: '2K' },
      { value: '--', label: '3K' },
      { value: '--', label: '4K' },
      { value: '--', label: '5K' },
      { value: '--', label: '1v2' },
      { value: '--', label: '1v3' },
      { value: '--', label: '1v4' },
      { value: '--', label: '1v5' },
      { value: '--', label: '助攻' },
      { value: '--', label: '爆头率' },
      { value: '--', label: '首杀' },
      { value: '--', label: '首死' },
      { value: '--', label: 'KAST' },
      { value: '--', label: 'Rating' },
      { value: '--', label: '手雷伤害' },
      { value: '--', label: '燃烧弹伤害' }
    ]
  }

  return [
    { value: match.kills || 0, label: '击杀' },
    { value: match.deaths || 0, label: '死亡' },
    { value: match.assists || 0, label: '助攻' },
    { value: match.adr || 0, label: 'ADR' },
    { value: formatRating(match.rating, false), label: 'Rating' },
    { value: '--', label: '爆头率' },
    { value: '--', label: '首杀' },
    { value: '--', label: '首死' },
    { value: '--', label: 'KAST' },
    { value: '--', label: 'RWS' },
    { value: '--', label: '下包次数' },
    { value: '--', label: '拆包次数' },
    { value: '--', label: '2K' },
    { value: '--', label: '残局' },
    { value: '--', label: '手雷伤害' },
    { value: '--', label: '燃烧弹伤害' }
  ]
}

function buildPlayerRows(match, isShareCodeOnly) {
  const players = Array.isArray(match.players) ? match.players : []
  if (players.length > 0) {
    return players.map((player, index) => ({
      name: player.name || `玩家 ${index + 1}`,
      avatarText: getAvatarText(player.name, index),
      kda: `${player.kills || 0}-${player.deaths || 0}`,
      adr: player.adr || 0,
      rws: '--',
      rating: '--',
      rankText: '占位',
      isCurrentUser: Boolean(player.isCurrentUser)
    }))
  }

  const names = isShareCodeOnly
    ? ['我的数据', '队友 1', '队友 2', '队友 3', '队友 4']
    : ['我的数据']

  return names.map((name, index) => ({
    name,
    avatarText: index === 0 ? '我' : `${index}`,
    kda: '--',
    adr: '--',
    rws: '--',
    rating: '--',
    rankText: '待解析',
    isCurrentUser: index === 0
  }))
}

function getAvatarText(name, index) {
  const text = String(name || '').trim()
  if (!text) {
    return `${index + 1}`
  }
  return text.slice(0, 1)
}

function buildRoundHeader() {
  return Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    label: `${index + 1}`
  }))
}

function buildRoundRows(isShareCodeOnly) {
  const pendingCells = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    text: '',
    className: ''
  }))

  if (isShareCodeOnly) {
    return [
      { team: 'A', cells: pendingCells },
      { team: 'B', cells: pendingCells }
    ]
  }

  const aPattern = ['●', '●', '●', '●', '●', '●', '', '', '', '', '●', '◆', '', '', '×', '×', '×', '']
  const bPattern = ['', '', '', '', '', '', '×', '×', '×', '●', '', '', '●', '●', '', '', '', '●']
  return [
    { team: 'A', cells: aPattern.map((text, index) => buildRoundCell(text, index)) },
    { team: 'B', cells: bPattern.map((text, index) => buildRoundCell(text, index)) }
  ]
}

function buildRoundCell(text, index) {
  return {
    id: index + 1,
    text,
    className: text === '●' ? 'round-win' : text === '×' ? 'round-loss' : text === '◆' ? 'round-special' : ''
  }
}
