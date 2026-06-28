async function syncSteamShareCodes(store, userId, account, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 100)
  const steamId64 = account && account.steamId64
  const steamIdKey = account && account.matchAuthCode
  let knownCode = normalizeShareCode(account && account.knownCode)

  if (!steamId64 || !steamIdKey || !knownCode) {
    const missingFields = getMissingCredentialFields({ steamId64, steamIdKey, knownCode })
    return {
      needsCredentials: true,
      missingFields,
      inserted: 0,
      fetched: 0,
      latestKnownCode: knownCode || '',
      message: `真实同步缺少：${missingFields.join('、')}`
    }
  }

  if (!options.apiKey) {
    return {
      serverConfigError: true,
      inserted: 0,
      fetched: 0,
      latestKnownCode: knownCode || '',
      message: '服务缺少 Steam Web API Key，请在云托管环境变量 STEAM_WEB_API_KEY 中配置'
    }
  }

  if (!/^CSGO(-[A-Z0-9]+){5}$/i.test(knownCode)) {
    return {
      needsCredentials: true,
      missingFields: ['最近比赛分享码 knowncode'],
      inserted: 0,
      fetched: 0,
      latestKnownCode: knownCode || '',
      message: '最近比赛分享码格式不正确，需要 CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx'
    }
  }

  const shareCodes = []
  for (let index = 0; index < limit; index += 1) {
    const nextCode = await getNextMatchSharingCode({
      steamId64,
      steamIdKey,
      knownCode,
      apiKey: options.apiKey
    })

    if (!nextCode || nextCode === knownCode || shareCodes.includes(nextCode)) {
      break
    }

    shareCodes.push(nextCode)
    knownCode = nextCode
  }

  const result = await store.insertSteamShareCodes(userId, shareCodes)
  if (shareCodes.length > 0) {
    await store.updateSteamKnownCode(userId, knownCode)
  }

  return {
    inserted: result.inserted,
    fetched: shareCodes.length,
    latestKnownCode: knownCode,
    message: buildSyncMessage(result.inserted, shareCodes.length)
  }
}

function getMissingCredentialFields({ steamId64, steamIdKey, knownCode }) {
  const fields = []
  if (!steamId64) {
    fields.push('SteamID64')
  }
  if (!steamIdKey) {
    fields.push('比赛授权码 steamidkey')
  }
  if (!knownCode) {
    fields.push('最近比赛分享码 knowncode')
  }
  return fields
}

function normalizeShareCode(value) {
  const text = String(value || '').trim()
  const match = text.match(/CSGO(-[A-Z0-9]+){5}/i)
  return match ? match[0] : text
}

async function getNextMatchSharingCode({ steamId64, steamIdKey, knownCode, apiKey }) {
  const params = new URLSearchParams({
    steamid: steamId64,
    steamidkey: steamIdKey,
    knowncode: knownCode
  })

  if (apiKey) {
    params.set('key', apiKey)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)

  try {
    const response = await fetch(`https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/?${params}`, {
      signal: controller.signal
    })
    const text = await response.text()
    let payload = {}

    try {
      payload = text ? JSON.parse(text) : {}
    } catch (error) {
      if (/verify your key|access is denied|forbidden/i.test(text)) {
        throw publicError('Steam 拒绝访问，请检查云托管环境变量 STEAM_WEB_API_KEY 是否已配置且有效')
      }

      throw publicError(`Steam 返回了非 JSON 响应，通常是参数错误或 Steam 暂时拒绝请求：${text.slice(0, 120)}`)
    }

    if (!response.ok) {
      if (response.status === 403) {
        const keyStatus = await validateSteamWebApiKey({ apiKey, steamId64 })
        throw publicError(buildForbiddenMessage(keyStatus))
      }

      throw publicError(extractSteamError(payload) || `Steam 接口请求失败：${response.status}`)
    }

    const nextCode = payload.result && payload.result.nextcode
      ? payload.result.nextcode
      : payload.response && payload.response.nextcode
        ? payload.response.nextcode
        : payload.nextcode

    return typeof nextCode === 'string' ? nextCode.trim() : ''
  } catch (error) {
    if (error.name === 'AbortError') {
      throw publicError('Steam 接口超时，请稍后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function publicError(message, statusCode = 400) {
  const error = new Error(message)
  error.publicMessage = message
  error.statusCode = statusCode
  return error
}

function extractSteamError(payload) {
  return payload && (payload.message || payload.error || (payload.result && payload.result.message))
}

async function validateSteamWebApiKey({ apiKey, steamId64 }) {
  if (!apiKey) {
    return 'missing'
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const params = new URLSearchParams({
      key: apiKey,
      steamids: steamId64
    })
    const response = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?${params}`, {
      signal: controller.signal
    })

    if (!response.ok) {
      return 'invalid'
    }

    const payload = await response.json()
    const players = payload && payload.response && Array.isArray(payload.response.players)
      ? payload.response.players
      : []

    return players.length > 0 ? 'valid' : 'unknown'
  } catch (error) {
    return 'unknown'
  } finally {
    clearTimeout(timer)
  }
}

function buildForbiddenMessage(keyStatus) {
  if (keyStatus === 'missing') {
    return '服务缺少 Steam Web API Key，请配置 STEAM_WEB_API_KEY'
  }

  if (keyStatus === 'invalid') {
    return 'Steam Web API Key 无效或未生效，请重新检查 STEAM_WEB_API_KEY'
  }

  if (keyStatus === 'valid') {
    return 'Steam 拒绝比赛同步：SteamID64、比赛授权码 steamidkey、最近比赛分享码 knowncode 三者不匹配，请重新获取并保存'
  }

  return 'Steam 拒绝访问：请检查 STEAM_WEB_API_KEY、steamidkey 和 knowncode 是否正确'
}

function buildSyncMessage(inserted, fetched) {
  if (inserted > 0) {
    return `已同步 ${inserted} 场真实比赛分享码`
  }

  if (fetched > 0) {
    return '没有新的比赛分享码'
  }

  return 'Steam 暂无下一场比赛分享码'
}

module.exports = {
  syncSteamShareCodes
}
