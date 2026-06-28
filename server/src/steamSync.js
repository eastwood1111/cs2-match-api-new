async function syncSteamShareCodes(store, userId, account, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 50)
  const steamId64 = account && account.steamId64
  const steamIdKey = account && account.matchAuthCode
  let knownCode = account && account.knownCode

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
      throw new Error(`Steam 返回了非 JSON 响应：${text.slice(0, 120)}`)
    }

    if (!response.ok) {
      throw new Error(extractSteamError(payload) || `Steam 接口请求失败：${response.status}`)
    }

    const nextCode = payload.result && payload.result.nextcode
      ? payload.result.nextcode
      : payload.response && payload.response.nextcode
        ? payload.response.nextcode
        : payload.nextcode

    return typeof nextCode === 'string' ? nextCode.trim() : ''
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Steam 接口超时，请稍后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function extractSteamError(payload) {
  return payload && (payload.message || payload.error || (payload.result && payload.result.message))
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
