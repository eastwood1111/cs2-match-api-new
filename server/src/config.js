const path = require('node:path')
require('dotenv').config()

const rootDir = path.resolve(__dirname, '..')
const mysqlAddress = parseMysqlAddress(process.env.MYSQL_ADDRESS || '')
const mysqlHost = process.env.MYSQL_HOST || mysqlAddress.host
const mysqlPort = process.env.MYSQL_PORT || mysqlAddress.port || 3306

function bool(value) {
  return value === '1' || value === 'true'
}

function parseMysqlAddress(value) {
  const address = String(value || '').trim()
  if (!address) {
    return {}
  }

  const [host, port] = address.split(':')
  return {
    host,
    port
  }
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret',
  trustProxy: bool(process.env.TRUST_PROXY),
  demoMode: bool(process.env.ENABLE_MOCK_SYNC) || process.env.NODE_ENV !== 'production',
  dataFile: path.resolve(rootDir, process.env.DATA_FILE || './data/dev-db.json'),
  db: {
    dialect: process.env.DB_DIALECT || (mysqlHost ? 'mysql' : 'json'),
    mysql: {
      host: mysqlHost,
      port: Number(mysqlPort),
      user: process.env.MYSQL_USER || process.env.MYSQL_USERNAME,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || process.env.MYSQL_DB || 'cs2_match'
    }
  },
  wechat: {
    appId: process.env.WECHAT_APP_ID,
    appSecret: process.env.WECHAT_APP_SECRET
  }
}
