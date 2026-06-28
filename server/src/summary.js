function buildSummary(items) {
  const total = items.length
  const statItems = items.filter((item) => item.result === 'win' || item.result === 'loss' || item.result === 'draw')
  if (total === 0) {
    return {
      total: 0,
      winRate: '0%',
      avgKd: '0.00',
      avgAdr: '0'
    }
  }

  if (statItems.length === 0) {
    return {
      total,
      winRate: '0%',
      avgKd: '0.00',
      avgAdr: '0'
    }
  }

  const wins = statItems.filter((item) => item.result === 'win').length
  const kd = statItems.reduce((sum, item) => sum + item.kills / Math.max(item.deaths, 1), 0) / statItems.length
  const adr = statItems.reduce((sum, item) => sum + item.adr, 0) / statItems.length

  return {
    total,
    winRate: `${Math.round((wins / statItems.length) * 100)}%`,
    avgKd: kd.toFixed(2),
    avgAdr: `${Math.round(adr)}`
  }
}

module.exports = {
  buildSummary
}
