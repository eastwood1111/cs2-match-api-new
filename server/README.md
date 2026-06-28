# CS2 Match API

这是给微信小程序使用的最小后端。当前同步接口会生成测试比赛，用来跑通登录、绑定、列表和详情链路。

## 本地运行

```bash
npm install
npm run dev
```

健康检查：

```bash
curl http://127.0.0.1:3000/health
```

默认使用 `data/dev-db.json` 做本地存储。部署到微信云托管时，把 `DB_DIALECT` 改成 `mysql`，并配置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。

如果微信云托管模板提供的是 `MYSQL_ADDRESS=host:port` 和 `MYSQL_USERNAME`，也可以直接使用。服务启动时会自动创建 `MYSQL_DATABASE` 指定的库，默认是 `cs2_match`，并初始化业务表。手动 SQL 脚本在 `sql/schema.sql`。

## 微信云托管

云托管服务名建议使用：

```text
cs2-match-api-new
```

小程序的 `utils/config.js` 中对应：

```js
apiMode: 'cloud',
cloudEnv: '你的云开发环境 ID',
cloudService: 'cs2-match-api-new'
```

容器会监听 `PORT` 环境变量，镜像入口为 `node src/index.js`。
