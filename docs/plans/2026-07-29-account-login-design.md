# 账号密码登录（替代 ADMIN_TOKEN）设计

> 历史设计：后续实现已完全移除 `ADMIN_TOKEN`，本文保留当时的决策记录。

日期：2026-07-29
状态：已确认需求，待实现

## 背景与目标

现状：管理接口靠环境变量 `ADMIN_TOKEN` 鉴权，前端把口令存 localStorage、每请求带
`X-Admin-Token` 头。口令难记、不可改（改需重启）、localStorage 存明文口令可被 XSS 窃取。

目标：改为**单账号（用户名 + 密码）登录**，Cookie 会话保持 30 天，**完全替代**
`ADMIN_TOKEN`。Node（SQLite）与 Cloudflare Workers（D1）双运行时行为一致。

需求决策（已与用户确认）：

- 单账号，不做多用户。
- 完全替代 ADMIN_TOKEN（保留其唯一残余用途：升级保护，见下）。
- 初始密码来自「首次访问设置向导」，之后可在设置页修改。
- 会话 30 天；登出、改密码即吊销。
- 明确不做：多用户、找回密码（忘了删库中 `auth` 键重走向导，文档写明）、2FA。

## 方案选型

会话机制选 **数据库存储的不透明会话 token + HttpOnly Cookie**：

- 对比无状态 JWT：可吊销（登出/改密码立即生效）、不依赖 `SETTINGS_KEY`。
- 对比 localStorage 长效 token：HttpOnly Cookie 不可被脚本读取，抗 XSS。

密码哈希选 **WebCrypto PBKDF2-SHA256，100000 次迭代 + 每密码随机盐**：

- 只用 WebCrypto，Node / Workers 双运行时通用（同 `secrets.ts` 的可移植性策略）。
- Workers 对 PBKDF2 的迭代上限恰为 100000，取满。
- bcrypt / argon2 在 Workers 无原生实现，不选。

## 存储

沿用「kv 表塞新键 + Storage 接口专用方法」的既有约定（同 `settings`）：

- 新键 `auth`，值为 JSON：

  ```jsonc
  {
    "account": { "username": "...", "salt": "<base64>", "hash": "<base64>", "iterations": 100000 },
    "sessions": [ { "tokenHash": "<sha256 base64>", "createdAt": 0, "expiresAt": 0 } ]
  }
  ```

- `Storage` 接口加一对方法（与 `getSettings`/`setSettings` 同构，存储层视为不透明字符串）：

  ```ts
  getAuth(): Promise<string | undefined>
  setAuth(json: string): Promise<void>
  ```

- 三个实现（memory / sqlite / d1）各加读写，契约测试补用例。**无需迁移文件**
  （只是 kv 表新行）。
- 会话 token 为 32 字节随机数（base64url），库里只存其 SHA-256 哈希——拖库拿不到
  可用会话。写入时顺带清理过期会话。
- Node 服务器部署落在本地 SQLite 文件（`DB_PATH`），CF 部署落在 D1，同一套调用代码。
- 单账号场景写入频率极低，账号与会话同键无并发问题。

## 后端（packages/server）

新模块 `auth.ts`（纯 WebCrypto，边缘可移植）：hash/verify 密码、生成/校验会话、
`auth` JSON 的读写与过期清理。复用 `security.ts::timingSafeEqual`。

新路由（挂在 `/api/auth/*`，位于鉴权中间件**之外**或白名单）：

| 路由 | 鉴权 | 行为 |
|---|---|---|
| `GET /api/auth/status` | 无 | `{ initialized, authenticated, username?, legacyTokenRequired }` |
| `POST /api/auth/setup` | 见升级保护 | 账号不存在时创建账号并直接建立会话；已存在则 409 |
| `POST /api/auth/login` | 无 | 校验用户名密码，成功则 Set-Cookie 并返回 `{ token }`（供脚本用 Bearer） |
| `POST /api/auth/logout` | 需会话 | 吊销当前会话，清 Cookie |
| `POST /api/auth/password` | 需会话 | 校验旧密码后改密码，吊销**所有**会话（含当前，前端引导重新登录） |

鉴权中间件改造（替换 `routes/app.ts` 中 `config.adminToken` 分支）：

- `/api/*`（除 `auth/status`、`auth/setup`、`auth/login`）要求有效会话：
  优先 Cookie `subforge_session`，其次 `Authorization: Bearer <session token>`
  （给脚本/自动化留的口子；`/api/auth/login` 返回 token 本体即为此用途）。
- 未初始化（无账号）时，非 auth 路由一律 401 且响应体带 `{ needsSetup: true }`。
- `/sub/:token` 分享出口保持公开；`/mcp` 沿用独立 `mcpToken`，不受影响。
- `SUBFORGE_ALLOW_NO_AUTH=1` 保留：跳过会话校验（本地开发/测试逃生门），语义不变。

Cookie 属性：`HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`，请求为 https 时加
`Secure`。登录失败做常数时间比较 + 进程内简单节流（如同 IP 连续失败 5 次后延迟响应；
Workers 多 isolate 下不完美，可接受——底线仍是 PBKDF2 慢哈希）。

### 升级保护（防抢注）

存量部署升级后库里无 `auth` 键，会进入设置向导。若实例暴露公网，先到者可抢注。
规则：

- 若环境变量 `ADMIN_TOKEN` 仍设置：`/api/auth/setup` 必须额外携带
  `legacyToken` 字段且与之匹配（`status` 端点用 `legacyTokenRequired: true` 提示前端
  渲染该输入框）。
- 全新部署（无 `ADMIN_TOKEN`、无账号）：直接允许 setup（trust-on-first-use，
  与主流自托管软件一致）。
- 账号创建后 `ADMIN_TOKEN` 不再参与任何鉴权。`config.ts` 保留读取该环境变量仅为
  升级保护用；文档更新为「可在建号后移除」。

## 前端（packages/web）

- `api.ts`：删除 `getToken`/`setToken` 与 `X-Admin-Token` 头；同源请求自动带 Cookie，
  无需 `credentials` 特殊处理。401 且 `needsSetup` → 进向导；401 其它 → 进登录页。
- `App.tsx` 三态：
  1. **未初始化** → 「创建管理员账号」向导（用户名、密码、确认密码；
     `legacyTokenRequired` 时多一个旧口令输入框）。
  2. **未登录** → 登录页（用户名 + 密码）。
  3. **已登录** → 现有界面；顶栏加登出按钮。
- 设置页加「修改密码」（旧密码 + 新密码 + 确认）；成功后跳登录页。
- 视觉沿用 `theme.ts` 既有设计语言。

## 测试

- `auth.ts` 单测：hash/verify、会话生成校验、过期清理。
- 路由测试：setup（首次成功 / 二次 409 / 升级保护校验）、login（成功 / 错密码 401）、
  会话过期、logout 后旧 Cookie 失效、改密码吊销全部会话、Bearer 口子、
  `ALLOW_NO_AUTH` 逃生门、未初始化时 `needsSetup` 提示。
- 存量 `app.test.ts` 从 `adminToken` 改为会话鉴权（或 `allowNoAuth`）。
- 契约测试补 `getAuth`/`setAuth` 用例（三实现同组用例）。

## 兼容性影响

- 外部脚本若在用 `X-Admin-Token` 调 `/api/*`：升级后失效，需改为
  `POST /api/auth/login` 换 token 后走 `Authorization: Bearer`。
- Workers 部署：`wrangler secret` 里的 `ADMIN_TOKEN` 建号后可删除。
- MCP（`/mcp`）与分享出口（`/sub/:token`）零变化。
