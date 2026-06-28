const config = require('./config')

const TOKEN_KEY = 'cs2_api_token'
const TOKEN_SAVED_AT_KEY = 'cs2_api_token_saved_at'
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getToken() {
  const token = wx.getStorageSync(TOKEN_KEY)
  const savedAt = Number(wx.getStorageSync(TOKEN_SAVED_AT_KEY) || 0)
  if (!token) {
    return ''
  }

  if (!savedAt || Date.now() - savedAt > TOKEN_TTL_MS) {
    clearToken()
    return ''
  }

  return token
}

function setToken(token) {
  wx.setStorageSync(TOKEN_KEY, token)
  wx.setStorageSync(TOKEN_SAVED_AT_KEY, Date.now())
}

function clearToken() {
  wx.removeStorageSync(TOKEN_KEY)
  wx.removeStorageSync(TOKEN_SAVED_AT_KEY)
}

function request(options) {
  const method = options.method || 'GET'
  const path = options.path
  const data = options.data || {}
  const token = getToken()
  const header = {
    'content-type': 'application/json'
  }

  if (token) {
    header.Authorization = `Bearer ${token}`
  }

  if (config.apiMode === 'cloud') {
    return new Promise((resolve, reject) => {
      const callOptions = {
        path,
        method,
        data,
        header: {
          ...header,
          'X-WX-SERVICE': config.cloudService
        },
        success(res) {
          handleResponse(res, resolve, reject)
        },
        fail(error) {
          reject(normalizeRequestError(error))
        }
      }

      if (config.cloudEnv) {
        callOptions.config = {
          env: config.cloudEnv
        }
      }

      wx.cloud.callContainer(callOptions)
    })
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.localBaseURL}${path}`,
      method,
      data,
      header,
      success(res) {
        handleResponse(res, resolve, reject)
      },
      fail(error) {
        reject(normalizeRequestError(error))
      }
    })
  })
}

function handleResponse(res, resolve, reject) {
  const statusCode = res.statusCode || 200
  if (statusCode >= 200 && statusCode < 300) {
    resolve(res.data)
    return
  }

  if (statusCode === 401) {
    clearToken()
  }

  reject({
    statusCode,
    message: res.data && res.data.message ? res.data.message : '请求失败'
  })
}

function normalizeRequestError(error) {
  const rawMessage = error && (error.message || error.errMsg) ? (error.message || error.errMsg) : '请求失败'
  const code = error && (error.errCode || error.code)

  if (code === 102002 || /102002/.test(rawMessage)) {
    return {
      ...error,
      message: '云托管调用超时或服务临时异常，请稍后重试；同步会分批进行，已保存的数据不会丢失'
    }
  }

  return {
    ...error,
    message: rawMessage
  }
}

function login() {
  const cachedToken = getToken()
  if (cachedToken) {
    return Promise.resolve({
      token: cachedToken,
      cached: true
    })
  }

  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        request({
          path: '/api/login',
          method: 'POST',
          data: {
            code: res.code
          }
        }).then((data) => {
          if (data.token) {
            setToken(data.token)
          }
          resolve(data)
        }).catch(reject)
      },
      fail: reject
    })
  })
}

module.exports = {
  request,
  login,
  getToken,
  setToken,
  clearToken
}
