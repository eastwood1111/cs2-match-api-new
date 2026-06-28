const express = require('express')
const cors = require('cors')
const config = require('./config')
const { signToken, verifyToken, getBearerToken } = require('./auth')
const { createStore } = require('./store')
const { buildSummary } = require('./summary')
const { syncSteamShareCodes } = require('./steamSync')

async function main() {
  const store = createStore(config)
  await store.init()

  const app = express()
  if (config.trustProxy) {
    app.set('trust proxy', 1)
  }

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      storage: store.kind,
      demoMode: config.demoMode,
      now: new Date().toISOString()
    })
  })

  app.post('/api/login', asyncHandler(async (req, res) => {
    const openid = await resolveOpenid(req)
    const user = await store.getOrCreateUser(openid, '微信用户')
    const token = signToken({ openid: user.openid }, config.sessionSecret)

    res.json({
      token,
      user: {
        id: user.id,
        openid: user.openid,
        nickname: user.nickname
      }
    })
  }))

  app.use('/api', authMiddleware(store))

  app.get('/api/steam/account', asyncHandler(async (req, res) => {
    const account = await store.getSteamAccount(req.currentUser.id)
    const privateAccount = await store.getPrivateSteamAccount(req.currentUser.id)
    res.json({
      account,
      syncReady: Boolean(privateAccount && privateAccount.steamId64 && privateAccount.matchAuthCode && privateAccount.knownCode),
      credentialStatus: {
        hasSteamId64: Boolean(privateAccount && privateAccount.steamId64),
        hasMatchAuthCode: Boolean(privateAccount && privateAccount.matchAuthCode),
        hasKnownCode: Boolean(privateAccount && privateAccount.knownCode)
      }
    })
  }))

  app.post('/api/steam/bind', asyncHandler(async (req, res) => {
    const payload = {
      steamId64: String(req.body.steamId64 || '').trim(),
      steamName: String(req.body.steamName || '').trim(),
      matchAuthCode: String(req.body.matchAuthCode || '').trim(),
      knownCode: String(req.body.knownCode || '').trim(),
      premierUrl: String(req.body.premierUrl || '').trim(),
      competitiveUrl: String(req.body.competitiveUrl || '').trim()
    }

    payload.steamId64 = payload.steamId64 || extractSteamId64(payload.premierUrl) || extractSteamId64(payload.competitiveUrl)

    if (!/^\d{17}$/.test(payload.steamId64)) {
      res.status(400).json({ message: 'SteamID64 需要是 17 位数字' })
      return
    }

    const account = await store.upsertSteamAccount(req.currentUser.id, payload)
    res.json({ account })
  }))

  app.post('/api/steam/import-gcpd', asyncHandler(async (req, res) => {
    const account = await store.getSteamAccount(req.currentUser.id)
    if (!account) {
      res.status(400).json({ message: '请先绑定 Steam 数据页' })
      return
    }

    res.status(501).json({
      message: 'Steam 个人游戏数据页需要登录 Steam 后才能查看，云托管无法匿名抓取。请后续改用比赛授权码/分享码同步，或提供导出的页面数据。'
    })
  }))

  app.post('/api/sync', asyncHandler(async (req, res) => {
    const account = await store.getSteamAccount(req.currentUser.id)
    if (!account) {
      res.status(400).json({ message: '请先绑定 Steam' })
      return
    }

    if (config.demoMode) {
      const result = await store.ensureMockMatches(req.currentUser.id)
      res.json({
        inserted: result.inserted,
        source: 'mock',
        message: result.inserted > 0 ? '已生成测试数据' : '暂无新的测试数据'
      })
      return
    }

    const privateAccount = await store.getPrivateSteamAccount(req.currentUser.id)
    const result = await syncSteamShareCodes(store, req.currentUser.id, privateAccount, {
      limit: req.body.limit || 10,
      apiKey: config.steam.apiKey
    })

    if (result.needsCredentials) {
      res.status(400).json({
        message: result.message,
        missingFields: result.missingFields
      })
      return
    }

    res.json({
      inserted: result.inserted,
      fetched: result.fetched,
      source: 'steam',
      latestKnownCode: result.latestKnownCode,
      message: result.message
    })
  }))

  app.get('/api/matches', asyncHandler(async (req, res) => {
    const allItems = await store.listMatches(req.currentUser.id)
    const items = config.demoMode ? allItems : allItems.filter((item) => item.source !== 'mock')
    res.json({
      items,
      summary: buildSummary(items)
    })
  }))

  app.get('/api/matches/:id', asyncHandler(async (req, res) => {
    const match = await store.getMatch(req.currentUser.id, req.params.id)
    if (!match) {
      res.status(404).json({ message: '比赛不存在' })
      return
    }

    if (!config.demoMode && match.source === 'mock') {
      res.status(404).json({ message: '比赛不存在' })
      return
    }

    res.json({ match })
  }))

  app.use((error, req, res, next) => {
    console.error(error)
    res.status(500).json({
      message: process.env.NODE_ENV === 'production' ? '服务内部错误' : error.message
    })
  })

  app.listen(config.port, () => {
    console.log(`CS2 match API listening on ${config.port}, storage=${store.kind}`)
  })
}

function authMiddleware(store) {
  return asyncHandler(async (req, res, next) => {
    const token = getBearerToken(req)
    const payload = verifyToken(token, config.sessionSecret)
    if (!payload || !payload.openid) {
      res.status(401).json({ message: '登录已失效' })
      return
    }

    const user = await store.getUserByOpenid(payload.openid)
      || await store.getOrCreateUser(payload.openid, '微信用户')

    req.currentUser = user
    next()
  })
}

async function resolveOpenid(req) {
  const cloudOpenid = req.get('x-wx-openid')
  if (cloudOpenid) {
    return cloudOpenid
  }

  if (config.wechat.appId && config.wechat.appSecret && req.body.code) {
    const params = new URLSearchParams({
      appid: config.wechat.appId,
      secret: config.wechat.appSecret,
      js_code: req.body.code,
      grant_type: 'authorization_code'
    })
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`)
    const data = await response.json()
    if (data.openid) {
      return data.openid
    }
    throw new Error(data.errmsg || '微信登录失败')
  }

  return 'dev-openid'
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

function extractSteamId64(value) {
  const match = String(value || '').match(/\/profiles\/(\d{17})(?:\/|$)/)
  return match ? match[1] : ''
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
