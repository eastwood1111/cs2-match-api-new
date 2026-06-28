const fs = require('node:fs/promises')
const path = require('node:path')
const mysql = require('mysql2/promise')
const { buildMockMatches } = require('./mockData')

function createStore(config) {
  if (config.db.dialect === 'mysql') {
    return new MySqlStore(config)
  }
  return new JsonStore(config)
}

class JsonStore {
  constructor(config) {
    this.kind = 'json'
    this.file = config.dataFile
    this.data = {
      users: [],
      steamAccounts: [],
      matches: [],
      matchPlayers: [],
      ids: {
        users: 1,
        steamAccounts: 1,
        matches: 1,
        matchPlayers: 1
      }
    }
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      this.data = JSON.parse(raw)
    } catch (error) {
      await this.save()
    }
  }

  async save() {
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2))
  }

  nextId(name) {
    const id = this.data.ids[name]
    this.data.ids[name] += 1
    return id
  }

  async getUserByOpenid(openid) {
    return this.data.users.find((user) => user.openid === openid) || null
  }

  async getOrCreateUser(openid, nickname) {
    const existing = await this.getUserByOpenid(openid)
    if (existing) {
      return existing
    }

    const user = {
      id: this.nextId('users'),
      openid,
      nickname: nickname || '微信用户',
      createdAt: new Date().toISOString()
    }
    this.data.users.push(user)
    await this.save()
    return user
  }

  async upsertSteamAccount(userId, payload) {
    let account = this.data.steamAccounts.find((item) => item.userId === userId)
    if (!account) {
      account = {
        id: this.nextId('steamAccounts'),
        userId,
        createdAt: new Date().toISOString()
      }
      this.data.steamAccounts.push(account)
    }

    account.steamId64 = payload.steamId64
    account.steamName = payload.steamName || ''
    account.knownCode = payload.knownCode || ''
    account.premierUrl = payload.premierUrl || ''
    account.competitiveUrl = payload.competitiveUrl || ''
    if (payload.matchAuthCode) {
      account.matchAuthCode = payload.matchAuthCode
    }
    account.updatedAt = new Date().toISOString()
    await this.save()
    return publicSteamAccount(account)
  }

  async getSteamAccount(userId) {
    const account = this.data.steamAccounts.find((item) => item.userId === userId)
    return account ? publicSteamAccount(account) : null
  }

  async getPrivateSteamAccount(userId) {
    return this.data.steamAccounts.find((item) => item.userId === userId) || null
  }

  async ensureMockMatches(userId) {
    const steamAccount = await this.getPrivateSteamAccount(userId)
    if (!steamAccount) {
      return { inserted: 0 }
    }

    const existingCount = this.data.matches.filter((match) => match.userId === userId).length
    if (existingCount > 0) {
      return { inserted: 0 }
    }

    const matches = buildMockMatches(userId, steamAccount)
    for (const match of matches) {
      const matchId = this.nextId('matches')
      this.data.matches.push({
        id: matchId,
        userId,
        shareCode: match.shareCode,
        mapName: match.mapName,
        mode: match.mode,
        startedAt: match.startedAt,
        score: match.score,
        result: match.result,
        durationSeconds: match.durationSeconds,
        kills: match.kills,
        deaths: match.deaths,
        assists: match.assists,
        adr: match.adr,
        rating: match.rating,
        parseStatus: match.parseStatus,
        source: match.source
      })

      for (const player of match.players) {
        this.data.matchPlayers.push({
          id: this.nextId('matchPlayers'),
          matchId,
          ...player
        })
      }
    }

    await this.save()
    return { inserted: matches.length }
  }

  async insertSteamShareCodes(userId, shareCodes) {
    let inserted = 0
    for (const shareCode of shareCodes) {
      const exists = this.data.matches.some((match) => match.userId === userId && match.shareCode === shareCode)
      if (exists) {
        continue
      }

      this.data.matches.push(createSteamShareCodeMatch(this.nextId('matches'), userId, shareCode))
      inserted += 1
    }

    await this.save()
    return { inserted }
  }

  async updateSteamKnownCode(userId, knownCode) {
    const account = this.data.steamAccounts.find((item) => item.userId === userId)
    if (!account) {
      return null
    }

    account.knownCode = knownCode
    account.updatedAt = new Date().toISOString()
    await this.save()
    return publicSteamAccount(account)
  }

  async listMatches(userId) {
    return this.data.matches
      .filter((match) => match.userId === userId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  }

  async getMatch(userId, id) {
    const match = this.data.matches.find((item) => item.userId === userId && `${item.id}` === `${id}`)
    if (!match) {
      return null
    }

    return {
      ...match,
      players: this.data.matchPlayers.filter((player) => player.matchId === match.id)
    }
  }
}

class MySqlStore {
  constructor(config) {
    this.kind = 'mysql'
    this.config = config.db.mysql
    this.pool = null
  }

  async init() {
    await ensureMysqlDatabase(this.config)

    this.pool = mysql.createPool({
      ...this.config,
      waitForConnections: true,
      connectionLimit: 8,
      namedPlaceholders: true,
      multipleStatements: false
    })

    for (const statement of schemaStatements) {
      await this.pool.execute(statement)
    }

    await ensureMysqlMigrations(this.pool)
  }

  async getUserByOpenid(openid) {
    const [rows] = await this.pool.execute('SELECT id, openid, nickname, created_at AS createdAt FROM users WHERE openid = ?', [openid])
    return rows[0] || null
  }

  async getOrCreateUser(openid, nickname) {
    const existing = await this.getUserByOpenid(openid)
    if (existing) {
      return existing
    }

    const [result] = await this.pool.execute(
      'INSERT INTO users (openid, nickname) VALUES (?, ?)',
      [openid, nickname || '微信用户']
    )
    return {
      id: result.insertId,
      openid,
      nickname: nickname || '微信用户'
    }
  }

  async upsertSteamAccount(userId, payload) {
    await this.pool.execute(
      `INSERT INTO steam_accounts
        (user_id, steam_id64, steam_name, match_auth_code, known_code, premier_url, competitive_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        steam_id64 = VALUES(steam_id64),
        steam_name = VALUES(steam_name),
        match_auth_code = IF(VALUES(match_auth_code) = '', match_auth_code, VALUES(match_auth_code)),
        known_code = VALUES(known_code),
        premier_url = VALUES(premier_url),
        competitive_url = VALUES(competitive_url),
        updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        payload.steamId64,
        payload.steamName || '',
        payload.matchAuthCode || '',
        payload.knownCode || '',
        payload.premierUrl || '',
        payload.competitiveUrl || ''
      ]
    )
    return this.getSteamAccount(userId)
  }

  async getSteamAccount(userId) {
    const [rows] = await this.pool.execute(
      `SELECT id, user_id AS userId, steam_id64 AS steamId64, steam_name AS steamName,
        known_code AS knownCode, premier_url AS premierUrl, competitive_url AS competitiveUrl,
        created_at AS createdAt, updated_at AS updatedAt
       FROM steam_accounts
       WHERE user_id = ?`,
      [userId]
    )
    return rows[0] || null
  }

  async getPrivateSteamAccount(userId) {
    const [rows] = await this.pool.execute(
      `SELECT id, user_id AS userId, steam_id64 AS steamId64, steam_name AS steamName,
        match_auth_code AS matchAuthCode, known_code AS knownCode,
        premier_url AS premierUrl, competitive_url AS competitiveUrl
       FROM steam_accounts
       WHERE user_id = ?`,
      [userId]
    )
    return rows[0] || null
  }

  async ensureMockMatches(userId) {
    const steamAccount = await this.getPrivateSteamAccount(userId)
    if (!steamAccount) {
      return { inserted: 0 }
    }

    const [countRows] = await this.pool.execute('SELECT COUNT(*) AS count FROM matches WHERE user_id = ?', [userId])
    if (countRows[0].count > 0) {
      return { inserted: 0 }
    }

    const matches = buildMockMatches(userId, steamAccount)
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      for (const match of matches) {
        const [matchResult] = await connection.execute(
          `INSERT INTO matches
            (user_id, share_code, map_name, mode, started_at, score, result, duration_seconds,
             kills, deaths, assists, adr, rating, parse_status, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            match.shareCode,
            match.mapName,
            match.mode,
            toMysqlDate(match.startedAt),
            match.score,
            match.result,
            match.durationSeconds,
            match.kills,
            match.deaths,
            match.assists,
            match.adr,
            match.rating,
            match.parseStatus,
            match.source
          ]
        )

        for (const player of match.players) {
          await connection.execute(
            `INSERT INTO match_players
              (match_id, steam_id64, name, team, kills, deaths, assists, adr, is_current_user)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              matchResult.insertId,
              player.steamId64,
              player.name,
              player.team,
              player.kills,
              player.deaths,
              player.assists,
              player.adr,
              player.isCurrentUser ? 1 : 0
            ]
          )
        }
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }

    return { inserted: matches.length }
  }

  async insertSteamShareCodes(userId, shareCodes) {
    if (shareCodes.length === 0) {
      return { inserted: 0 }
    }

    let inserted = 0
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      for (const shareCode of shareCodes) {
        const [result] = await connection.execute(
          `INSERT IGNORE INTO matches
            (user_id, share_code, map_name, mode, started_at, score, result, duration_seconds,
             kills, deaths, assists, adr, rating, parse_status, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            shareCode,
            '待解析',
            'Steam',
            toMysqlDate(new Date().toISOString()),
            '--',
            'pending',
            0,
            0,
            0,
            0,
            0,
            0,
            'sharecode',
            'steam'
          ]
        )
        inserted += result.affectedRows
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }

    return { inserted }
  }

  async updateSteamKnownCode(userId, knownCode) {
    await this.pool.execute(
      'UPDATE steam_accounts SET known_code = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [knownCode, userId]
    )
    return this.getSteamAccount(userId)
  }

  async listMatches(userId) {
    const [rows] = await this.pool.execute(
      `SELECT id, share_code AS shareCode, map_name AS mapName, mode, started_at AS startedAt,
        score, result, duration_seconds AS durationSeconds, kills, deaths, assists, adr, rating,
        parse_status AS parseStatus, source
       FROM matches
       WHERE user_id = ?
       ORDER BY started_at DESC`,
      [userId]
    )
    return rows.map(mapDates)
  }

  async getMatch(userId, id) {
    const [rows] = await this.pool.execute(
      `SELECT id, share_code AS shareCode, map_name AS mapName, mode, started_at AS startedAt,
        score, result, duration_seconds AS durationSeconds, kills, deaths, assists, adr, rating,
        parse_status AS parseStatus, source
       FROM matches
       WHERE user_id = ? AND id = ?`,
      [userId, id]
    )

    if (!rows[0]) {
      return null
    }

    const [players] = await this.pool.execute(
      `SELECT steam_id64 AS steamId64, name, team, kills, deaths, assists, adr,
        is_current_user AS isCurrentUser
       FROM match_players
       WHERE match_id = ?
       ORDER BY is_current_user DESC, kills DESC`,
      [id]
    )

    return {
      ...mapDates(rows[0]),
      players: players.map((player) => ({
        ...player,
        isCurrentUser: Boolean(player.isCurrentUser)
      }))
    }
  }
}

function publicSteamAccount(account) {
  return {
    id: account.id,
    userId: account.userId,
    steamId64: account.steamId64,
    steamName: account.steamName,
    knownCode: account.knownCode,
    premierUrl: account.premierUrl,
    competitiveUrl: account.competitiveUrl,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }
}

function mapDates(row) {
  return {
    ...row,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt
  }
}

function toMysqlDate(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ')
}

function createSteamShareCodeMatch(id, userId, shareCode) {
  return {
    id,
    userId,
    shareCode,
    mapName: '待解析',
    mode: 'Steam',
    startedAt: new Date().toISOString(),
    score: '--',
    result: 'pending',
    durationSeconds: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    adr: 0,
    rating: 0,
    parseStatus: 'sharecode',
    source: 'steam'
  }
}

async function ensureMysqlDatabase(config) {
  if (!config.host || !config.user) {
    throw new Error('MySQL connection is missing MYSQL_HOST/MYSQL_ADDRESS or MYSQL_USER/MYSQL_USERNAME')
  }

  const database = escapeIdentifier(config.database)
  let connection

  try {
    connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password
    })
    await connection.execute(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  } catch (error) {
    console.warn(`Could not create database ${config.database}; continuing with existing database. ${error.message}`)
  } finally {
    if (connection) {
      await connection.end()
    }
  }
}

function escapeIdentifier(value) {
  const identifier = String(value || '').trim()
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error('MYSQL_DATABASE can only contain letters, numbers, and underscores')
  }

  return `\`${identifier}\``
}

async function ensureMysqlMigrations(pool) {
  await addColumnIfMissing(pool, 'steam_accounts', 'premier_url', "VARCHAR(512) NOT NULL DEFAULT ''")
  await addColumnIfMissing(pool, 'steam_accounts', 'competitive_url', "VARCHAR(512) NOT NULL DEFAULT ''")
}

async function addColumnIfMissing(pool, table, column, definition) {
  try {
    await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') {
      throw error
    }
  }
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    openid VARCHAR(128) NOT NULL UNIQUE,
    nickname VARCHAR(128) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS steam_accounts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL UNIQUE,
    steam_id64 VARCHAR(32) NOT NULL,
    steam_name VARCHAR(128) NOT NULL DEFAULT '',
    match_auth_code VARCHAR(255) NOT NULL DEFAULT '',
    known_code VARCHAR(255) NOT NULL DEFAULT '',
    premier_url VARCHAR(512) NOT NULL DEFAULT '',
    competitive_url VARCHAR(512) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_steam_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_steam_id64 (steam_id64)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS matches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    share_code VARCHAR(128) NOT NULL,
    map_name VARCHAR(64) NOT NULL,
    mode VARCHAR(32) NOT NULL,
    started_at DATETIME NOT NULL,
    score VARCHAR(16) NOT NULL,
    result VARCHAR(16) NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 0,
    kills INT NOT NULL DEFAULT 0,
    deaths INT NOT NULL DEFAULT 0,
    assists INT NOT NULL DEFAULT 0,
    adr INT NOT NULL DEFAULT 0,
    rating DECIMAL(4,2) NOT NULL DEFAULT 0,
    parse_status VARCHAR(32) NOT NULL DEFAULT 'pending',
    source VARCHAR(32) NOT NULL DEFAULT 'mock',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_matches_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_user_share_code (user_id, share_code),
    INDEX idx_user_started_at (user_id, started_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS match_players (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    match_id BIGINT UNSIGNED NOT NULL,
    steam_id64 VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    team VARCHAR(16) NOT NULL,
    kills INT NOT NULL DEFAULT 0,
    deaths INT NOT NULL DEFAULT 0,
    assists INT NOT NULL DEFAULT 0,
    adr INT NOT NULL DEFAULT 0,
    is_current_user TINYINT(1) NOT NULL DEFAULT 0,
    CONSTRAINT fk_match_players_match FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    INDEX idx_match_players_match (match_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
]

module.exports = {
  createStore
}
