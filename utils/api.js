const config = require('./config')

const TOKEN_KEY = 'cs2_api_token'

function getToken() {
  return wx.getStorageSync(TOKEN_KEY)
}

function setToken(token) {
  wx.setStorageSync(TOKEN_KEY, token)
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
        fail: reject
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
      fail: reject
    })
  })
}

function handleResponse(res, resolve, reject) {
  const statusCode = res.statusCode || 200
  if (statusCode >= 200 && statusCode < 300) {
    resolve(res.data)
    return
  }

  reject({
    statusCode,
    message: res.data && res.data.message ? res.data.message : '请求失败'
  })
}

function login() {
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
  setToken
}
