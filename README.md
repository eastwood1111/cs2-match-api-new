# cs2-match-api-new

当前是最小可跑通版本：

- 微信小程序原生 JS 页面。
- Node.js Express 后端。
- 本地默认 JSON 存储，微信云托管部署时切换 MySQL。
- 同步接口当前生成测试比赛，后续替换为 Steam match history + demo parser。

## 目录

```text
.
├── app.js / app.json / app.wxss
├── pages
│   ├── index     首页、统计、最近比赛
│   ├── bind      Steam 绑定
│   └── match     比赛详情
├── utils
│   ├── api.js    小程序 API 封装
│   └── config.js 本地/云托管切换
└── server        微信云托管 Node 服务
```

## 本地运行后端

```bash
cd server
npm install
npm run dev
```

接口地址：

```text
http://127.0.0.1:3000
```

小程序本地调试时，`utils/config.js` 保持：

```js
apiMode: 'local'
```

微信开发者工具里需要打开“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。

## 微信云托管部署

云托管服务名建议：

```text
cs2-match-api-new
```

如果使用一键部署或模板构建，云托管通常会在代码仓库根目录寻找 `Dockerfile`。本项目根目录已经放置了 `Dockerfile`，它会只打包 `server` 后端代码。

如果云托管界面支持设置构建目录，也可以选择 `server` 目录并使用 `server/Dockerfile`。

云托管容器默认监听 `80` 端口，根目录和 `server` 目录的 Dockerfile 已经设置：

```text
PORT=80
```

云托管环境变量：

```text
DB_DIALECT=mysql
MYSQL_HOST=你的数据库地址
MYSQL_PORT=3306
MYSQL_USER=你的数据库用户
MYSQL_PASSWORD=你的数据库密码
MYSQL_DATABASE=cs2_match
STEAM_WEB_API_KEY=你的 Steam Web API Key
SESSION_SECRET=一串长随机字符串
```

云托管生产环境默认不生成测试比赛。如果要临时演示 mock 数据，再额外设置：

```text
ENABLE_MOCK_SYNC=true
```

如果云托管模板自动生成的是下面这组变量，也可以直接使用，代码已经兼容：

```text
DB_DIALECT=mysql
MYSQL_ADDRESS=数据库地址:3306
MYSQL_USERNAME=数据库用户
MYSQL_PASSWORD=数据库密码
MYSQL_DATABASE=cs2_match
STEAM_WEB_API_KEY=你的 Steam Web API Key
SESSION_SECRET=一串长随机字符串
```

### 数据库创建

推荐数据库名：

```text
cs2_match
```

服务启动时会自动执行：

```sql
CREATE DATABASE IF NOT EXISTS `cs2_match`;
```

并自动创建这些表：

```text
users
steam_accounts
matches
match_players
```

如果你想在数据库控制台里手动初始化，也可以执行：

```text
server/sql/schema.sql
```

重新部署后访问健康检查，如果返回 `storage=mysql`，说明已经切到数据库存储。

部署后把 `utils/config.js` 改成：

```js
apiMode: 'cloud',
cloudEnv: '你的云开发环境 ID',
cloudService: 'cs2-match-api-new'
```

## 下一步

当前已经接入真实 Steam 分享码同步：

1. 绑定页填写 SteamID64。
2. 填写比赛授权码 `steamidkey`。
3. 填写当前最新比赛分享码 `knowncode`，格式通常是 `CSGO-...`。
4. 首页点击同步后，服务会调用 Steam `ICSGOPlayers_730/GetNextMatchSharingCode`，把真实比赛分享码写入数据库。

云托管必须配置 `STEAM_WEB_API_KEY`。Steam Web API Key 在这里申请：

```text
https://steamcommunity.com/dev/apikey
```

如果同步返回 403，通常是两类问题：

```text
STEAM_WEB_API_KEY 无效
```

或：

```text
SteamID64、steamidkey、knowncode 三者不匹配
```

其中 `knowncode` 必须是这个 Steam 账号当前最新一场的 `CSGO-...` 比赛分享码。

注意：这个阶段只拿到真实比赛分享码。每场 K/D、ADR、玩家列表、回合数据需要下一阶段解析 demo。

下一阶段建议继续做：

1. 根据分享码定位并下载 demo。
2. 接入 CS2 demo parser。
3. 把 kill、damage、round 数据落到独立表。
