const config = require('./utils/config')

App({
  onLaunch() {
    if (config.apiMode === 'cloud' && wx.cloud) {
      const cloudOptions = {
        traceUser: true
      }

      if (config.cloudEnv) {
        cloudOptions.env = config.cloudEnv
      }

      wx.cloud.init(cloudOptions)
    }
  },
  globalData: {
    user: null
  }
})
