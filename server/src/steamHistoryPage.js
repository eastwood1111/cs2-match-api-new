async function syncSteamHistoryPages(store, userId, account, options = {}) {
  const urls = [account && account.premierUrl, account && account.competitiveUrl]
    .map((url) => String(url || '').trim())
    .filter(Boolean)

  if (urls.length === 0) {
    return {
      attempted: false,
      inserted: 0,
      fetched: 0,
      message: ''
    }
  }

  const matches = []
  const reasons = []
  for (const url of urls) {
    try {
      const result = await fetchHistoryPage(url, Number(options.timeoutMs || 6000))
      if (!result.available) {
        reasons.push(result.message)
        continue
      }

      matches.push(...parseHistoryHtml(result.html, url))
    } catch (error) {
      reasons.push(error.publicMessage || error.message || 'Steam 战绩网页读取失败')
    }
  }

  if (matches.length === 0) {
    return {
      attempted: true,
      inserted: 0,
      fetched: 0,
      unavailable: true,
      message: unique(reasons).join('；') || 'Steam 战绩网页没有可读取的基础字段'
    }
  }

  const result = await store.insertParsedSteamMatches(userId, dedupeMatches(matches))
  return {
    attempted: true,
    inserted: result.inserted,
    fetched: matches.length,
    message: result.inserted > 0
      ? `已从 Steam 网页读取 ${result.inserted} 场基础数据`
      : 'Steam 网页基础数据已是最新'
  }
}

async function fetchHistoryPage(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 CS2MatchPulse/1.0',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    })
    const html = await response.text()
    const finalUrl = response.url || url

    if (!response.ok) {
      return {
        available: false,
        message: `Steam 战绩网页请求失败：${response.status}`
      }
    }

    if (!/\/gcpd\/730/i.test(finalUrl) || /<title>\s*Steam Community\s*::/i.test(html)) {
      return {
        available: false,
        message: 'Steam 战绩网页需要浏览器登录态，云托管匿名访问会被重定向，无法直接读取字段'
      }
    }

    return {
      available: true,
      html
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw publicError('Steam 战绩网页读取超时')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function parseHistoryHtml(html, sourceUrl) {
  const rows = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || []
  const matches = []

  for (const row of rows) {
    const text = normalizeText(stripTags(row))
    if (!text) {
      continue
    }

    const score = parseScore(text)
    if (score.text === '--') {
      continue
    }

    const kda = parseKda(text)
    const adr = parseAdr(text)
    const mapName = parseMapName(text)
    const startedAt = parseDate(text)
    const shareCode = parseShareCode(row) || buildSyntheticShareCode(sourceUrl, text)

    matches.push({
      shareCode,
      mapName,
      mode: /premier/i.test(sourceUrl) ? 'Premier' : 'Competitive',
      startedAt,
      score: score.text,
      result: score.result,
      durationSeconds: 0,
      kills: kda.kills,
      deaths: kda.deaths,
      assists: kda.assists,
      adr,
      rating: 0,
      parseStatus: 'basic',
      source: 'steam-web'
    })
  }

  return matches
}

function stripTags(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function normalizeText(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim()
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function parseScore(text) {
  const match = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/)
    || text.match(/(?:比分|score)\s*[:：]?\s*(\d{1,2})\s*-\s*(\d{1,2})/i)
  if (!match) {
    return { text: '--', result: 'pending' }
  }

  const left = Number(match[1])
  const right = Number(match[2])
  return {
    text: `${left}:${right}`,
    result: left > right ? 'win' : left < right ? 'loss' : 'draw'
  }
}

function parseKda(text) {
  const match = text.match(/(?:KDA|K\/D\/A|击杀|K\s*D\s*A)?\s*(\d{1,3})\s*[\/\-]\s*(\d{1,3})\s*[\/\-]\s*(\d{1,3})/i)
  if (!match) {
    return { kills: 0, deaths: 0, assists: 0 }
  }

  return {
    kills: Number(match[1]),
    deaths: Number(match[2]),
    assists: Number(match[3])
  }
}

function parseAdr(text) {
  const match = text.match(/ADR\s*[:：]?\s*(\d{1,3})/i)
  return match ? Number(match[1]) : 0
}

function parseMapName(text) {
  const maps = [
    ['远古遗迹', '远古遗迹'],
    ['阿努比斯', '阿努比斯'],
    ['死亡游乐园', '死亡游乐园'],
    ['炙热沙城', '炙热沙城II'],
    ['荒漠迷城', '荒漠迷城'],
    ['Mirage', 'Mirage'],
    ['Ancient', 'Ancient'],
    ['Inferno', 'Inferno'],
    ['Anubis', 'Anubis'],
    ['Nuke', 'Nuke'],
    ['Dust', 'Dust2'],
    ['Overpass', 'Overpass']
  ]
  const found = maps.find(([pattern]) => text.includes(pattern))
  return found ? found[1] : 'Steam 网页'
}

function parseDate(text) {
  const match = text.match(/(\d{1,2})[\/\-月](\d{1,2})/)
  if (!match) {
    return new Date().toISOString()
  }

  const now = new Date()
  const month = Number(match[1]) - 1
  const day = Number(match[2])
  return new Date(now.getFullYear(), month, day).toISOString()
}

function parseShareCode(text) {
  const match = String(text || '').match(/CSGO(-[A-Z0-9]+){5}/i)
  return match ? match[0] : ''
}

function buildSyntheticShareCode(sourceUrl, text) {
  let hash = 0
  const value = `${sourceUrl}:${text}`
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return `web-${Math.abs(hash)}`
}

function dedupeMatches(matches) {
  const seen = new Set()
  return matches.filter((match) => {
    if (seen.has(match.shareCode)) {
      return false
    }
    seen.add(match.shareCode)
    return true
  })
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function publicError(message) {
  const error = new Error(message)
  error.publicMessage = message
  return error
}

module.exports = {
  syncSteamHistoryPages
}
