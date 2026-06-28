function buildSummary(items) {
  const total = items.length
  const statItems = items.filter((item) => item.result === 'win' || item.result === 'loss' || item.result === 'draw')
  const pendingTotal = items.filter((item) => item.result === 'pending' || item.parseStatus === 'sharecode').length
  const steamTotal = items.filter((item) => item.source === 'steam').length
  const mockTotal = items.filter((item) => item.source === 'mock').length
  const latestSyncAt = items.reduce((latest, item) => {
    const time = new Date(item.startedAt).getTime()
    if (Number.isNaN(time) || time <= latest.time) {
      return latest
    }
    return { time, value: item.startedAt }
  }, { time: 0, value: '' }).value

  if (total === 0) {
    return {
      total: 0,
      parsedTotal: 0,
      pendingTotal: 0,
      steamTotal: 0,
      mockTotal: 0,
      latestSyncAt: '',
      winRate: '0%',
      avgKd: '0.00',
      avgAdr: '0'
    }
  }

  if (statItems.length === 0) {
    return {
      total,
      parsedTotal: 0,
      pendingTotal,
      steamTotal,
      mockTotal,
      latestSyncAt,
      winRate: '--',
      avgKd: '--',
      avgAdr: '--'
    }
  }

  const wins = statItems.filter((item) => item.result === 'win').length
  const kd = statItems.reduce((sum, item) => sum + item.kills / Math.max(item.deaths, 1), 0) / statItems.length
  const adr = statItems.reduce((sum, item) => sum + item.adr, 0) / statItems.length

  return {
    total,
    parsedTotal: statItems.length,
    pendingTotal,
    steamTotal,
    mockTotal,
    latestSyncAt,
    winRate: `${Math.round((wins / statItems.length) * 100)}%`,
    avgKd: kd.toFixed(2),
    avgAdr: `${Math.round(adr)}`
  }
}

module.exports = {
  buildSummary
}
