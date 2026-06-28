const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    error: '',
    expandedPlayerKey: '',
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
        expandedPlayerKey: '',
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
    const teamSections = buildTeamSections(match, isShareCodeOnly, score)

    return {
      ...match,
      isShareCodeOnly,
      resultText,
      resultHeroClass: `hero-${match.result || 'pending'}`,
      scoreLeft: isShareCodeOnly ? '--' : score.left,
      scoreRight: isShareCodeOnly ? '--' : score.right,
      mapText: isShareCodeOnly ? '待解析' : match.mapName,
      modeText: isShareCodeOnly ? 'Steam 官匹' : match.mode,
      kdaText: isShareCodeOnly ? '--/--/--' : `${match.kills || 0}/${match.deaths || 0}/${match.assists || 0}`,
      adrText: isShareCodeOnly ? '--' : `${match.adr || 0}`,
      heroMeta: [
        { label: '结束时间', value: this.formatShortDate(match.startedAt) },
        { label: '比赛时长', value: isShareCodeOnly ? '待解析' : formatDuration(match.durationSeconds) },
        { label: '比赛地图', value: isShareCodeOnly ? '待解析' : match.mapName },
        { label: '基础同步', value: '最多100场' }
      ],
      basicCards: [
        { label: '比分', value: isShareCodeOnly ? '-- : --' : `${score.left} : ${score.right}` },
        { label: '地图', value: isShareCodeOnly ? '待解析' : match.mapName },
        { label: '模式', value: isShareCodeOnly ? 'Steam 官匹' : match.mode },
        { label: '状态', value: isShareCodeOnly ? '待解析' : resultText }
      ],
      teamSections,
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

  togglePlayer(event) {
    const key = event.currentTarget.dataset.key
    const expandable = event.currentTarget.dataset.expandable
    if (expandable !== true && expandable !== 'true') {
      wx.showToast({
        title: '仅自己的数据可展开',
        icon: 'none'
      })
      return
    }

    const expandedPlayerKey = this.data.expandedPlayerKey === key ? '' : key
    this.setData({
      expandedPlayerKey,
      match: {
        ...this.data.match,
        teamSections: markExpanded(this.data.match.teamSections, expandedPlayerKey)
      }
    })
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

function getOpponentResultText(result, isShareCodeOnly) {
  if (isShareCodeOnly || result === 'pending') {
    return '待解析'
  }
  if (result === 'win') {
    return '失败'
  }
  if (result === 'loss') {
    return '胜利'
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

function buildTeamSections(match, isShareCodeOnly, score) {
  const rows = buildPlayerRows(match, isShareCodeOnly, score)
  const ownRows = rows.filter((row) => row.side === 'own')
  const opponentRows = rows.filter((row) => row.side === 'opponent')

  return [
    {
      id: 'own',
      name: 'TEAM-A',
      resultText: getResultText(match.result, isShareCodeOnly),
      rows: fillRows(ownRows, 'own')
    },
    {
      id: 'opponent',
      name: '对手',
      resultText: getOpponentResultText(match.result, isShareCodeOnly),
      rows: fillRows(opponentRows, 'opponent')
    }
  ]
}

function buildPlayerRows(match, isShareCodeOnly, score) {
  const players = Array.isArray(match.players) ? match.players : []
  if (players.length === 0) {
    const currentKda = isShareCodeOnly ? '--/--/--' : `${match.kills || 0}/${match.deaths || 0}/${match.assists || 0}`
    const currentAdr = isShareCodeOnly ? '--' : `${match.adr || 0}`
    return [
      playerRow('own-0', '我的数据', '我', 'own', true, currentKda, currentAdr, score, isShareCodeOnly),
      ...Array.from({ length: 4 }, (_, index) => playerRow(`own-${index + 1}`, `队友 ${index + 1}`, `${index + 1}`, 'own', false, '--/--/--', '--', score, isShareCodeOnly)),
      ...Array.from({ length: 5 }, (_, index) => playerRow(`opponent-${index}`, `对手 ${index + 1}`, `${index + 1}`, 'opponent', false, '--/--/--', '--', score, isShareCodeOnly))
    ]
  }

  const currentPlayer = players.find((player) => player.isCurrentUser) || players[0]
  const ownTeam = currentPlayer && currentPlayer.team ? currentPlayer.team : players[0].team
  const mappedPlayers = players.map((player, index) => {
    const side = player.team === ownTeam ? 'own' : 'opponent'
    return playerRow(
      player.steamId64 || `${side}-${index}`,
      player.isCurrentUser ? (player.name || '我的数据') : (player.name || `玩家 ${index + 1}`),
      getAvatarText(player.name, index),
      side,
      Boolean(player.isCurrentUser),
      `${player.kills || 0}/${player.deaths || 0}/${player.assists || 0}`,
      `${player.adr || 0}`,
      score,
      false
    )
  })

  if (!mappedPlayers.some((row) => row.side === 'opponent')) {
    mappedPlayers.push(...Array.from({ length: 5 }, (_, index) => playerRow(`opponent-${index}`, `对手 ${index + 1}`, `${index + 1}`, 'opponent', false, '--/--/--', '--', score, true)))
  }

  return mappedPlayers
}

function playerRow(key, name, avatarText, side, isCurrentUser, kda, adr, score, isPlaceholder) {
  const scoreText = score.left === '--' || score.right === '--' ? '-- : --' : `${score.left} : ${score.right}`
  return {
    key,
    name,
    avatarText,
    side,
    isCurrentUser,
    isPlaceholder,
    isExpanded: false,
    kda,
    adr,
    scoreText,
    detailRows: [
      { label: '比分', value: scoreText },
      { label: 'KDA', value: kda },
      { label: 'ADR', value: adr },
      { label: '数据状态', value: isPlaceholder ? '待解析' : '基础数据' }
    ]
  }
}

function fillRows(rows, side) {
  if (rows.length >= 5) {
    return rows.slice(0, 5)
  }

  const filled = [...rows]
  const start = filled.length
  for (let index = start; index < 5; index += 1) {
    filled.push(playerRow(`${side}-placeholder-${index}`, side === 'own' ? `队友 ${index + 1}` : `对手 ${index + 1}`, `${index + 1}`, side, false, '--/--/--', '--', { left: '--', right: '--' }, true))
  }
  return filled
}

function markExpanded(sections, expandedKey) {
  return sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      isExpanded: row.key === expandedKey
    }))
  }))
}

function getAvatarText(name, index) {
  const text = String(name || '').trim()
  if (!text) {
    return `${index + 1}`
  }
  return text.slice(0, 1)
}
