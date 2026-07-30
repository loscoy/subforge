# 账号密码登录 Implementation Plan

> 历史计划：后续实现已完全移除 `ADMIN_TOKEN`，本文保留当时的执行记录。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用「单账号 + Cookie 会话」完全替代 `ADMIN_TOKEN` 管理鉴权，首次访问走设置向导，会话 30 天。

**Architecture:** 账号与会话存 kv 表 `auth` 键（`Storage.getAuth/setAuth`，与 `settings` 同构）；密码用 WebCrypto PBKDF2-SHA256（10 万迭代）哈希；会话为 32 字节随机 token，库里只存 SHA-256 哈希，浏览器经 HttpOnly Cookie 携带，脚本可用 `Authorization: Bearer`。`ADMIN_TOKEN` 仅残余一个用途：存量部署初始化账号时的升级保护（防抢注）。

**Tech Stack:** Hono（`hono/cookie`）、WebCrypto（Node 22 / Workers 通用）、vitest、React 18 + Mantine v7。

规格：`docs/plans/2026-07-29-account-login-design.md`。

约定提醒（来自 CLAUDE.md）：代码标识符/日志/错误信息用英文或现状风格（本仓库错误文案是中文，保持一致）；注释与 UI 文案用简体中文；文件 UTF-8 无 BOM；前端改完不构建，只跑 typecheck 与测试。

---

### Task 1: Storage 增加 `getAuth`/`setAuth`

**Files:**
- Modify: `packages/server/src/storage/types.ts`（`Storage` 接口，`getSettings` 附近）
- Modify: `packages/server/src/storage/memory.ts`
- Modify: `packages/server/src/storage/sqlite.ts`
- Modify: `packages/server/src/storage/d1.ts`
- Test: `packages/server/src/storage/storage-contract.test.ts`

无需迁移文件：只是往已有 kv 表塞新键 `auth`（同 `settings` 的先例）。

- [ ] **Step 1: 在契约测试里加失败用例**

在 `storage-contract.test.ts` 的 `runContract` 内（`设置 kv` 或最后一个 `it` 之后，找到现有针对 settings 的用例，紧随其后）加：

```ts
    it('auth kv 读写', async () => {
      const s = make()
      expect(await s.getAuth()).toBeUndefined()
      await s.setAuth('{"sessions":[]}')
      expect(await s.getAuth()).toBe('{"sessions":[]}')
      await s.setAuth('{"sessions":[{"tokenHash":"x"}]}')
      expect(await s.getAuth()).toBe('{"sessions":[{"tokenHash":"x"}]}')
    })
```

- [ ] **Step 2: 跑测试确认失败（编译错：接口无此方法）**

```bash
npx vitest run packages/server/src/storage/storage-contract.test.ts
```

Expected: FAIL（`getAuth` 不存在，类型/运行错误）。

- [ ] **Step 3: 接口与三实现**

`types.ts` 的 `Storage` 接口中，`getSettings`/`setSettings` 之后加：

```ts
  // 账号与会话（原始 JSON 字符串）。语义在 auth.ts，存储层视为不透明数据。
  getAuth(): Promise<string | undefined>
  setAuth(json: string): Promise<void>
```

`memory.ts`：类字段区加 `private auth: string | undefined`，`setSettings` 方法后加：

```ts
  async getAuth() {
    return this.auth
  }
  async setAuth(json: string) {
    this.auth = json
  }
```

`sqlite.ts`：`setSettings` 方法后加（同款 SQL，键换 `auth`）：

```ts
  async getAuth(): Promise<string | undefined> {
    const r = this.db.prepare("SELECT v FROM kv WHERE k = 'auth'").get() as { v: string } | undefined
    return r?.v
  }
  async setAuth(json: string): Promise<void> {
    this.db.prepare("INSERT INTO kv (k,v) VALUES ('auth',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(json)
  }
```

`d1.ts`：`setSettings` 方法后加：

```ts
  async getAuth(): Promise<string | undefined> {
    const r = (await this.db.prepare("SELECT v FROM kv WHERE k = 'auth'").first('v')) as string | null
    return r ?? undefined
  }
  async setAuth(json: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO kv (k,v) VALUES ('auth',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(json)
      .run()
  }
```

- [ ] **Step 4: 跑契约测试确认通过**

```bash
npx vitest run packages/server/src/storage/storage-contract.test.ts
```

Expected: PASS（三个实现 × 同组用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/
git commit -m "feat(server): Storage 增加 auth kv 读写（三实现 + 契约测试）"
```

---

### Task 2: `auth.ts` 密码哈希与会话逻辑

**Files:**
- Create: `packages/server/src/auth.ts`
- Test: `packages/server/src/auth.test.ts`

只用 WebCrypto（同 `secrets.ts` 的可移植策略），**不要 import `node:crypto`**（`worker.ts` 会间接引用本模块）。

- [ ] **Step 1: 写失败测试**

`packages/server/src/auth.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  SESSION_TTL_MS,
  addSession,
  hashPassword,
  hasValidSession,
  loadAuthState,
  revokeSession,
  saveAuthState,
  verifyPassword,
  type AuthState,
} from './auth.js'
import { InMemoryStorage } from './storage/index.js'

describe('密码哈希', () => {
  it('正确密码通过、错误密码拒绝', async () => {
    const account = { username: 'admin', ...(await hashPassword('s3cret-pass')) }
    expect(await verifyPassword('s3cret-pass', account)).toBe(true)
    expect(await verifyPassword('wrong', account)).toBe(false)
  })

  it('同一密码两次哈希盐与结果都不同', async () => {
    const a = await hashPassword('p@ssw0rd!')
    const b = await hashPassword('p@ssw0rd!')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })
})

describe('会话', () => {
  it('建立 → 校验 → 吊销；过期与伪造 token 均拒绝', async () => {
    const state: AuthState = { sessions: [] }
    const token = await addSession(state, 1000)
    expect(await hasValidSession(state, token, 2000)).toBe(true)
    expect(await hasValidSession(state, 'bogus-token', 2000)).toBe(false)
    expect(await hasValidSession(state, token, 1000 + SESSION_TTL_MS + 1)).toBe(false)
    await revokeSession(state, token)
    expect(await hasValidSession(state, token, 2000)).toBe(false)
  })

  it('addSession 顺带清理过期会话', async () => {
    const state: AuthState = { sessions: [{ tokenHash: 'old', createdAt: 0, expiresAt: 10 }] }
    await addSession(state, 1000)
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]!.tokenHash).not.toBe('old')
  })

  it('状态经存储 round-trip 后会话仍有效', async () => {
    const storage = new InMemoryStorage()
    const state: AuthState = { account: { username: 'admin', ...(await hashPassword('p@ssw0rd!')) }, sessions: [] }
    const token = await addSession(state, 1)
    await saveAuthState(storage, state)
    const loaded = await loadAuthState(storage)
    expect(loaded.account?.username).toBe('admin')
    expect(await hasValidSession(loaded, token, 2)).toBe(true)
  })

  it('auth 键损坏时按未初始化处理（失败关闭同款语义）', async () => {
    const storage = new InMemoryStorage()
    await storage.setAuth('not-json{{{')
    const loaded = await loadAuthState(storage)
    expect(loaded.account).toBeUndefined()
    expect(loaded.sessions).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/server/src/auth.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `auth.ts`**

```ts
/**
 * 账号密码登录：密码哈希与会话管理。
 *
 * 只用 WebCrypto（Node 22 / Workers 都原生支持），边缘可移植——
 * 与 secrets.ts 同一策略，绝不 import node:crypto。
 *
 * 存储：kv 表 `auth` 键（Storage.getAuth/setAuth），存储层视为不透明 JSON。
 * 会话 token 只存 SHA-256 哈希，拖库拿不到可用会话。
 */
import { timingSafeEqual } from './security.js'
import type { Storage } from './storage/index.js'

/** Workers 对 PBKDF2 的迭代上限恰为 100000，取满。 */
const ITERATIONS = 100_000
const SALT_BYTES = 16
const TOKEN_BYTES = 32
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface AuthAccount {
  username: string
  salt: string
  hash: string
  /** 存下迭代数：将来上调时旧账号仍可校验 */
  iterations: number
}

export interface AuthSession {
  tokenHash: string
  createdAt: number
  expiresAt: number
}

export interface AuthState {
  account?: AuthAccount
  sessions: AuthSession[]
}

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<Pick<AuthAccount, 'salt' | 'hash' | 'iterations'>> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await deriveBits(password, salt, ITERATIONS)
  return { salt: toBase64(salt), hash: toBase64(hash), iterations: ITERATIONS }
}

export async function verifyPassword(password: string, account: AuthAccount): Promise<boolean> {
  const hash = await deriveBits(password, fromBase64(account.salt), account.iterations)
  return timingSafeEqual(toBase64(hash), account.hash)
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return toBase64(new Uint8Array(digest))
}

export async function loadAuthState(storage: Storage): Promise<AuthState> {
  const raw = await storage.getAuth()
  if (!raw) return { sessions: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<AuthState>
    return { account: parsed.account, sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] }
  } catch {
    // 损坏一律按未初始化处理（与 secrets.ts 解密失败同款语义：失败关闭）
    return { sessions: [] }
  }
}

export async function saveAuthState(storage: Storage, state: AuthState): Promise<void> {
  await storage.setAuth(JSON.stringify(state))
}

/** 建立新会话并顺带清理过期会话，返回 token 本体。调用方负责 saveAuthState。 */
export async function addSession(state: AuthState, at: number): Promise<string> {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  state.sessions = state.sessions.filter((s) => s.expiresAt > at)
  state.sessions.push({ tokenHash: await hashToken(token), createdAt: at, expiresAt: at + SESSION_TTL_MS })
  return token
}

export async function hasValidSession(state: AuthState, token: string, at: number): Promise<boolean> {
  const target = await hashToken(token)
  for (const s of state.sessions) {
    if (s.expiresAt > at && (await timingSafeEqual(target, s.tokenHash))) return true
  }
  return false
}

/** 吊销单个会话（登出）。调用方负责 saveAuthState。 */
export async function revokeSession(state: AuthState, token: string): Promise<void> {
  const target = await hashToken(token)
  state.sessions = state.sessions.filter((s) => s.tokenHash !== target)
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/server/src/auth.test.ts
```

Expected: PASS（PBKDF2 每次 10 万迭代，整个文件几百毫秒属正常）。

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth.ts packages/server/src/auth.test.ts
git commit -m "feat(server): auth 模块——PBKDF2 密码哈希与会话管理（WebCrypto，边缘可移植）"
```

---

### Task 3: `/api/auth/*` 路由与鉴权中间件改造

**Files:**
- Modify: `packages/server/src/routes/app.ts`（112–133 行的鉴权中间件块 + 新增 auth 子路由）
- Modify: `packages/server/src/config.ts`（`adminToken` 注释改为「升级保护残余用途」）
- Modify: `packages/server/src/routes/app.test.ts`（103–133 行「管理接口鉴权」describe 重写）
- Test: `packages/server/src/routes/auth-routes.test.ts`（新建）

- [ ] **Step 1: 写失败的路由测试**

`packages/server/src/routes/auth-routes.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { getConfig } from '../config.js'
import { NodeVmRunner } from '../sandbox/nodeVm.js'
import { InMemoryStorage } from '../storage/index.js'
import { createApp } from './app.js'

const mk = (over: Partial<ReturnType<typeof getConfig>> = {}) => {
  const storage = new InMemoryStorage()
  const app = createApp({
    storage,
    runner: new NodeVmRunner(),
    config: { ...getConfig(), adminToken: undefined, allowNoAuth: false, ...over },
  })
  return { app, storage }
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const json = (res: Response) => res.json() as Promise<any>

/** 从 Set-Cookie 头里取会话 Cookie 的 name=value 段 */
function cookieOf(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? ''
  return raw.split(';')[0] ?? ''
}

describe('账号初始化（setup）', () => {
  it('status：未初始化时 initialized=false，/api 其它路由 401 且 needsSetup', async () => {
    const { app } = mk()
    const st = await json(await app.fetch(new Request('http://x/api/auth/status')))
    expect(st.initialized).toBe(false)
    const res = await app.fetch(new Request('http://x/api/meta'))
    expect(res.status).toBe(401)
    expect((await json(res)).needsSetup).toBe(true)
  })

  it('setup 成功建号并直接进入登录态；二次 setup 409', async () => {
    const { app } = mk()
    const res = await app.fetch(post('/api/auth/setup', { username: 'admin', password: 'p@ssw0rd!' }))
    expect(res.status).toBe(201)
    const cookie = cookieOf(res)
    expect(cookie).toContain('subforge_session=')
    const meta = await app.fetch(new Request('http://x/api/meta', { headers: { cookie } }))
    expect(meta.status).toBe(200)
    const again = await app.fetch(post('/api/auth/setup', { username: 'x', password: 'p@ssw0rd!' }))
    expect(again.status).toBe(409)
  })

  it('弱密码/空用户名 400', async () => {
    const { app } = mk()
    expect((await app.fetch(post('/api/auth/setup', { username: '', password: 'p@ssw0rd!' }))).status).toBe(400)
    expect((await app.fetch(post('/api/auth/setup', { username: 'a', password: 'short' }))).status).toBe(400)
  })

  it('升级保护：环境仍有 ADMIN_TOKEN 时，setup 必须携带正确旧口令', async () => {
    const { app } = mk({ adminToken: 'legacy-secret' })
    const st = await json(await app.fetch(new Request('http://x/api/auth/status')))
    expect(st.legacyTokenRequired).toBe(true)
    const no = await app.fetch(post('/api/auth/setup', { username: 'admin', password: 'p@ssw0rd!' }))
    expect(no.status).toBe(401)
    const wrong = await app.fetch(
      post('/api/auth/setup', { username: 'admin', password: 'p@ssw0rd!', legacyToken: 'nope' }),
    )
    expect(wrong.status).toBe(401)
    const ok = await app.fetch(
      post('/api/auth/setup', { username: 'admin', password: 'p@ssw0rd!', legacyToken: 'legacy-secret' }),
    )
    expect(ok.status).toBe(201)
    // 建号后 ADMIN_TOKEN 不再参与 API 鉴权
    const meta = await app.fetch(new Request('http://x/api/meta', { headers: { 'X-Admin-Token': 'legacy-secret' } }))
    expect(meta.status).toBe(401)
  })
})

describe('登录与会话', () => {
  async function setupApp() {
    const ctx = mk()
    await ctx.app.fetch(post('/api/auth/setup', { username: 'admin', password: 'p@ssw0rd!' }))
    return ctx
  }

  it('正确密码换会话（Cookie 与 Bearer 都可用），错误密码 401', async () => {
    const { app } = await setupApp()
    const bad = await app.fetch(post('/api/auth/login', { username: 'admin', password: 'wrong-pass' }))
    expect(bad.status).toBe(401)
    const res = await app.fetch(post('/api/auth/login', { username: 'admin', password: 'p@ssw0rd!' }))
    expect(res.status).toBe(200)
    const { token } = await json(res)
    expect(token).toBeTruthy()
    const viaCookie = await app.fetch(new Request('http://x/api/meta', { headers: { cookie: cookieOf(res) } }))
    expect(viaCookie.status).toBe(200)
    const viaBearer = await app.fetch(
      new Request('http://x/api/meta', { headers: { Authorization: `Bearer ${token}` } }),
    )
    expect(viaBearer.status).toBe(200)
  })

  it('logout 后旧会话失效', async () => {
    const { app } = await setupApp()
    const login = await app.fetch(post('/api/auth/login', { username: 'admin', password: 'p@ssw0rd!' }))
    const cookie = cookieOf(login)
    expect((await app.fetch(new Request('http://x/api/meta', { headers: { cookie } }))).status).toBe(200)
    await app.fetch(post('/api/auth/logout', {}, { cookie }))
    expect((await app.fetch(new Request('http://x/api/meta', { headers: { cookie } }))).status).toBe(401)
  })

  it('改密码吊销所有会话，新密码可登录', async () => {
    const { app } = await setupApp()
    const a = cookieOf(await app.fetch(post('/api/auth/login', { username: 'admin', password: 'p@ssw0rd!' })))
    const b = cookieOf(await app.fetch(post('/api/auth/login', { username: 'admin', password: 'p@ssw0rd!' })))
    const res = await app.fetch(
      post('/api/auth/password', { oldPassword: 'p@ssw0rd!', newPassword: 'n3w-p@ssw0rd' }, { cookie: a }),
    )
    expect(res.status).toBe(200)
    expect((await app.fetch(new Request('http://x/api/meta', { headers: { cookie: a } }))).status).toBe(401)
    expect((await app.fetch(new Request('http://x/api/meta', { headers: { cookie: b } }))).status).toBe(401)
    const relogin = await app.fetch(post('/api/auth/login', { username: 'admin', password: 'n3w-p@ssw0rd' }))
    expect(relogin.status).toBe(200)
  })

  it('旧口令头 X-Admin-Token 不再有效', async () => {
    const { app } = await setupApp()
    const res = await app.fetch(new Request('http://x/api/meta', { headers: { 'X-Admin-Token': 'whatever' } }))
    expect(res.status).toBe(401)
  })
})

describe('逃生门与公开出口', () => {
  it('SUBFORGE_ALLOW_NO_AUTH=1 跳过会话校验', async () => {
    const { app } = mk({ allowNoAuth: true })
    expect((await app.fetch(new Request('http://x/api/meta'))).status).toBe(200)
  })

  it('/sub/:token 保持公开（未知 token → 404 而非 401）', async () => {
    const { app } = mk()
    expect((await app.fetch(new Request('http://x/sub/whatever'))).status).toBe(404)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/server/src/routes/auth-routes.test.ts
```

Expected: FAIL（无 auth 路由；`/api/meta` 现在返回 503 而非 401）。

- [ ] **Step 3: 改 `routes/app.ts`**

3a. 顶部 import 增改：

```ts
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import {
  SESSION_TTL_MS,
  addSession,
  hasValidSession,
  hashPassword,
  loadAuthState,
  revokeSession,
  saveAuthState,
  verifyPassword,
} from '../auth.js'
```

（`timingSafeEqual` 已有 import，保留。）

3b. 将 112–133 行的整块（`// ---- 管理 API（鉴权：默认失败关闭） ----` 到 `console.warn` 的 else 结束）替换为：

```ts
  // ---- 管理 API（鉴权：账号会话，默认失败关闭） ----
  const SESSION_COOKIE = 'subforge_session'
  const sessionTokenOf = (c: { req: { header: (name: string) => string | undefined; raw: Request } }) =>
    getCookie(c as never, SESSION_COOKIE) ?? c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const setSessionCookie = (c: never, token: string, url: string) =>
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: new URL(url).protocol === 'https:',
    })

  // 登录失败节流（进程内计数；Workers 多 isolate 下不完美，底线是 PBKDF2 慢哈希）
  let loginFailures = 0
  let loginLockedUntil = 0

  const api = new Hono()
  if (config.allowNoAuth) {
    console.warn(
      '⚠ SubForge 正在【无鉴权】模式运行（SUBFORGE_ALLOW_NO_AUTH=1）：任何人都可调用管理接口/执行脚本，切勿暴露到公网。',
    )
  } else {
    // 白名单：登录前必须可达的端点。/auth/logout 无会话时也应幂等成功。
    const PUBLIC_AUTH_PATHS = new Set(['/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/auth/logout'])
    api.use('*', async (c, next) => {
      if (PUBLIC_AUTH_PATHS.has(c.req.path)) return next()
      const state = await loadAuthState(storage)
      if (!state.account) return c.json({ error: '尚未初始化管理员账号', needsSetup: true }, 401)
      const token = sessionTokenOf(c)
      if (!token || !(await hasValidSession(state, token, now()))) return c.json({ error: '未授权' }, 401)
      await next()
    })
  }

  // ---- 账号登录（/api/auth/*） ----
  api.get('/auth/status', async (c) => {
    const state = await loadAuthState(storage)
    const token = sessionTokenOf(c)
    const authenticated = !!state.account && !!token && (await hasValidSession(state, token, now()))
    return c.json({
      initialized: !!state.account,
      authenticated: !!config.allowNoAuth || authenticated,
      username: authenticated ? state.account?.username : undefined,
      // 升级保护：存量部署环境仍设有 ADMIN_TOKEN 时，初始化需先验旧口令（防公网实例被抢注）
      legacyTokenRequired: !state.account && !!config.adminToken,
    })
  })

  api.post('/auth/setup', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!username || password.length < 8) return c.json({ error: '用户名不能为空，密码至少 8 位' }, 400)
    const state = await loadAuthState(storage)
    if (state.account) return c.json({ error: '账号已存在' }, 409)
    if (config.adminToken && !(await timingSafeEqual(String(body.legacyToken ?? ''), config.adminToken))) {
      return c.json({ error: '需要正确的 ADMIN_TOKEN 才能初始化账号', legacyTokenRequired: true }, 401)
    }
    state.account = { username, ...(await hashPassword(password)) }
    const token = await addSession(state, now())
    await saveAuthState(storage, state)
    setSessionCookie(c as never, token, c.req.url)
    return c.json({ ok: true, token }, 201)
  })

  api.post('/auth/login', async (c) => {
    if (now() < loginLockedUntil) return c.json({ error: '尝试过于频繁，请稍后再试' }, 429)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const state = await loadAuthState(storage)
    if (!state.account) return c.json({ error: '尚未初始化管理员账号', needsSetup: true }, 401)
    const ok =
      (await timingSafeEqual(String(body.username ?? ''), state.account.username)) &&
      (await verifyPassword(String(body.password ?? ''), state.account))
    if (!ok) {
      loginFailures += 1
      if (loginFailures >= 5) {
        loginFailures = 0
        loginLockedUntil = now() + 30_000
      }
      return c.json({ error: '用户名或密码错误' }, 401)
    }
    loginFailures = 0
    loginLockedUntil = 0
    const token = await addSession(state, now())
    await saveAuthState(storage, state)
    setSessionCookie(c as never, token, c.req.url)
    return c.json({ ok: true, token })
  })

  api.post('/auth/logout', async (c) => {
    const token = sessionTokenOf(c)
    if (token) {
      const state = await loadAuthState(storage)
      await revokeSession(state, token)
      await saveAuthState(storage, state)
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  // 改密码：受上方会话中间件保护（不在白名单），改完吊销所有会话
  api.post('/auth/password', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const state = await loadAuthState(storage)
    if (!state.account) return c.json({ error: '尚未初始化管理员账号', needsSetup: true }, 401)
    const next = typeof body.newPassword === 'string' ? body.newPassword : ''
    if (next.length < 8) return c.json({ error: '新密码至少 8 位' }, 400)
    if (!(await verifyPassword(String(body.oldPassword ?? ''), state.account))) {
      return c.json({ error: '旧密码错误' }, 401)
    }
    state.account = { username: state.account.username, ...(await hashPassword(next)) }
    state.sessions = []
    await saveAuthState(storage, state)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })
```

实现提示：
- `sessionTokenOf`/`setSessionCookie` 的类型如与 Hono `Context` 泛型打架，直接用 `import type { Context } from 'hono'` 并写 `(c: Context)`，不要用 `as never` 硬压——以 `npm run typecheck` 通过且无 eslint 抑制为准。
- `allowNoAuth` 分支下白名单中间件整个不装：auth 路由本身不依赖中间件，`/auth/password` 在该模式下由 handler 里 `state.account` 缺失 → 401 兜底（本地无鉴权模式没有账号概念，可接受）。
- 保留文件其余部分不动；`app.route('/api', api)`（约 410 行）不变。

3c. `config.ts`：`adminToken` 字段注释改为：

```ts
  /** （遗留）旧管理口令。仅剩一个用途：初始化账号时的升级保护校验，建号后可从环境移除。 */
  adminToken?: string
```

- [ ] **Step 4: 跑新测试确认通过**

```bash
npx vitest run packages/server/src/routes/auth-routes.test.ts
```

Expected: PASS。

- [ ] **Step 5: 重写 `app.test.ts` 的「管理接口鉴权」describe（103–133 行）**

替换为（`失败关闭` 语义从 503 变为 401+needsSetup）：

```ts
describe('管理接口鉴权（账号会话，失败关闭）', () => {
  const mk = (config: Parameters<typeof createApp>[0]['config']) =>
    createApp({ storage: new InMemoryStorage(), runner: new NodeVmRunner(), config })
  const base = { ...getConfig(), adminToken: undefined, allowNoAuth: false }

  it('未初始化账号 → /api 返回 401 且 needsSetup', async () => {
    const app = mk(base)
    const res = await app.fetch(new Request('http://x/api/meta'))
    expect(res.status).toBe(401)
    expect(((await res.json()) as any).needsSetup).toBe(true)
  })

  it('显式允许无鉴权 → 放行', async () => {
    const app = mk({ ...base, allowNoAuth: true })
    const res = await app.fetch(new Request('http://x/api/meta'))
    expect(res.status).toBe(200)
  })

  it('建号后：无会话 401，有会话放行', async () => {
    const app = mk(base)
    const setup = await app.fetch(
      new Request('http://x/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'p@ssw0rd!' }),
      }),
    )
    expect(setup.status).toBe(201)
    const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    expect((await app.fetch(new Request('http://x/api/meta'))).status).toBe(401)
    expect((await app.fetch(new Request('http://x/api/meta', { headers: { cookie } }))).status).toBe(200)
  })

  it('分享出口 /sub/:token 不受管理鉴权影响（仍公开）', async () => {
    const app = mk(base)
    const res = await app.fetch(new Request('http://x/sub/whatever'))
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 6: 跑 server 全部测试**

```bash
npx vitest run packages/server
```

Expected: 全部 PASS（其余用例本就用 `allowNoAuth: true`，不受影响）。

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/ packages/server/src/config.ts
git commit -m "feat(server): /api/auth 路由与会话鉴权中间件，替代 ADMIN_TOKEN（含升级保护）"
```

---

### Task 4: 前端——登录/初始化页、登出、改密码

**Files:**
- Modify: `packages/web/src/api.ts`（删 token 头，加 authApi）
- Create: `packages/web/src/components/AuthGate.tsx`
- Modify: `packages/web/src/App.tsx`（三态：setup / login / ready；顶栏登出）
- Modify: `packages/web/src/components/Settings.tsx`（「修改密码」卡片）

前端无单测基建（仅 `mcp.test.ts` 纯函数测试），本任务以 typecheck + 后端契约为验证；不构建项目（CLAUDE.md 约定）。

- [ ] **Step 1: `api.ts` 改造**

删除 15–21 行的 `getToken`/`setToken`；`req` 里去掉 `X-Admin-Token` 行；`agentStream` 的 headers 改回 `{ 'content-type': 'application/json' }`。在 `api` 对象定义之前加：

```ts
export interface AuthStatus {
  initialized: boolean
  authenticated: boolean
  username?: string
  legacyTokenRequired: boolean
}

export const authApi = {
  status: () => req<AuthStatus>('/auth/status'),
  setup: (b: { username: string; password: string; legacyToken?: string }) =>
    req<{ ok: boolean }>('/auth/setup', { method: 'POST', body: JSON.stringify(b) }),
  login: (b: { username: string; password: string }) =>
    req<{ ok: boolean }>('/auth/login', { method: 'POST', body: JSON.stringify(b) }),
  logout: () => req<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  changePassword: (b: { oldPassword: string; newPassword: string }) =>
    req<{ ok: boolean }>('/auth/password', { method: 'POST', body: JSON.stringify(b) }),
}

/** 从 req 抛出的 `${status}: ${body}` 错误里抠出服务端中文 error 文案 */
export function apiErrorText(e: unknown): string {
  const raw = String(e instanceof Error ? e.message : e)
  const body = raw.replace(/^\d+:\s*/, '')
  try {
    return (JSON.parse(body) as { error?: string }).error || raw
  } catch {
    return raw
  }
}
```

- [ ] **Step 2: 新建 `components/AuthGate.tsx`**

```tsx
import { Box, Button, Card, PasswordInput, Text, TextInput, Title } from '@mantine/core'
import { useState, type ReactNode } from 'react'
import { apiErrorText, authApi } from '../api'

/**
 * 登录 / 首次初始化的全屏门。mode 由 /api/auth/status 决定：
 * 未初始化 → setup（legacyTokenRequired 时多一个旧口令输入框），未登录 → login。
 */
export function AuthGate({
  mode,
  legacyTokenRequired,
  brand,
  onDone,
}: {
  mode: 'setup' | 'login'
  legacyTokenRequired?: boolean
  brand: ReactNode
  onDone: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [legacyToken, setLegacyToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    if (mode === 'setup' && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      if (mode === 'setup') {
        await authApi.setup({ username, password, ...(legacyTokenRequired ? { legacyToken } : {}) })
      } else {
        await authApi.login({ username, password })
      }
      onDone()
    } catch (e) {
      setError(apiErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void submit()
  }

  return (
    <Box style={{ display: 'grid', placeItems: 'center', minHeight: '100svh' }}>
      <Card w={{ base: 'calc(100% - 32px)', xs: 400 }} padding="xl">
        {brand}
        <Title order={3} mt="md">
          {mode === 'setup' ? '创建管理员账号' : '登录'}
        </Title>
        <Text c="dimmed" fz="sm" mt={4} mb="md">
          {mode === 'setup' ? '首次使用需要先创建账号，之后用它登录管理界面。' : '输入账号密码进入管理界面。'}
        </Text>
        <TextInput
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          onKeyDown={onEnter}
          autoFocus
        />
        <PasswordInput
          label="密码"
          mt="sm"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={onEnter}
          description={mode === 'setup' ? '至少 8 位' : undefined}
        />
        {mode === 'setup' && (
          <PasswordInput
            label="确认密码"
            mt="sm"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            onKeyDown={onEnter}
          />
        )}
        {mode === 'setup' && legacyTokenRequired && (
          <PasswordInput
            label="旧管理口令（ADMIN_TOKEN）"
            description="此实例环境仍设有 ADMIN_TOKEN，需验证后才能初始化账号。"
            mt="sm"
            value={legacyToken}
            onChange={(e) => setLegacyToken(e.currentTarget.value)}
            onKeyDown={onEnter}
          />
        )}
        {error && (
          <Text c="red" fz="sm" mt="sm">
            {error}
          </Text>
        )}
        <Button fullWidth mt="md" loading={busy} onClick={() => void submit()}>
          {mode === 'setup' ? '创建并进入' : '登录'}
        </Button>
      </Card>
    </Box>
  )
}
```

- [ ] **Step 3: 改 `App.tsx`**

3a. import 行改：`import { api, authApi } from './api'`，并加 `import { AuthGate } from './components/AuthGate'`；`IMoon/ISun` 等既有 import 不动，另从 `./icons` 里确认是否有可用的登出图标（如无合适图标，登出用文字按钮，不新增图标库——遵守「资产不外引」习惯）。

3b. 状态与启动流程：删除 `needToken`/`tokenInput` 两个 state（80–81 行），替换为：

```ts
  const [auth, setAuth] = useState<'loading' | 'setup' | 'setup-legacy' | 'login' | 'ready'>('loading')
```

`loadMeta` 里删掉 `setNeedToken(false)` 与 `401 → setNeedToken(true)` 分支，401 时改为 `setAuth('login')`（会话过期时任意 API 401 都落回登录页）：

```ts
  const loadMeta = () => {
    setMetaStatus('loading')
    setMetaError('')
    api
      .meta()
      .then((m) => {
        setMeta(m)
        setMetaStatus('success')
      })
      .catch((e) => {
        if (String(e).includes('401')) {
          setAuth('login')
          setMetaStatus('error')
          return
        }
        setMetaError(String(e))
        setMetaStatus('error')
      })
  }
```

启动 effect（107–109 行）改为先查 auth 状态：

```ts
  useEffect(() => {
    authApi
      .status()
      .then((s) => {
        if (!s.initialized) setAuth(s.legacyTokenRequired ? 'setup-legacy' : 'setup')
        else if (!s.authenticated) setAuth('login')
        else {
          setAuth('ready')
          loadMeta()
        }
      })
      .catch((e) => {
        setMetaError(String(e))
        setMetaStatus('error')
        setAuth('ready') // 状态接口都挂了 → 落到主界面的 LoadError 展示错误
      })
  }, [])
```

3c. 删除 124–159 行的 `if (needToken)` 整块，替换为：

```tsx
  if (auth === 'loading') {
    return null
  }
  if (auth !== 'ready') {
    return (
      <AuthGate
        mode={auth === 'login' ? 'login' : 'setup'}
        legacyTokenRequired={auth === 'setup-legacy'}
        brand={<Brand />}
        onDone={() => {
          setAuth('ready')
          loadMeta()
        }}
      />
    )
  }
```

3d. 顶栏 `<ThemeToggle />` 之后、Agent 按钮之前加登出按钮：

```tsx
          <Tooltip label="登出" withArrow>
            <Button
              variant="subtle"
              color="gray"
              h={34}
              radius={7}
              px={10}
              onClick={() => {
                void authApi.logout().finally(() => setAuth('login'))
              }}
            >
              登出
            </Button>
          </Tooltip>
```

- [ ] **Step 4: `Settings.tsx` 加「修改密码」卡片**

在「远端 MCP」`SectionCard`（503–538 行）之后、末尾的保存 `Card`（540 行）之前加一个新 SectionCard。组件顶部 import 区补 `PasswordInput`（如未引入）与 `authApi, apiErrorText`（来自 `../api`）。`Settings` 组件函数内加 state 与 handler：

```ts
  const [pwdOld, setPwdOld] = useState('')
  const [pwdNew, setPwdNew] = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [pwdBusy, setPwdBusy] = useState(false)

  const changePassword = async () => {
    if (pwdNew !== pwdConfirm) {
      notifications.show({ color: 'red', message: '两次输入的新密码不一致' })
      return
    }
    setPwdBusy(true)
    try {
      await authApi.changePassword({ oldPassword: pwdOld, newPassword: pwdNew })
      notifications.show({ color: 'teal', message: '密码已修改，请重新登录' })
      window.location.reload() // 所有会话已吊销，回登录页
    } catch (e) {
      notifications.show({ color: 'red', message: apiErrorText(e) })
    } finally {
      setPwdBusy(false)
    }
  }
```

JSX（图标沿用已 import 的 `IKey`；`SectionCard` 的 props 形状照 503 行的「远端 MCP」写法）：

```tsx
      <SectionCard icon={<IKey size={17} />} title="账号安全" sub="修改管理界面的登录密码，改完需重新登录">
        <PasswordInput label="旧密码" value={pwdOld} onChange={(e) => setPwdOld(e.currentTarget.value)} />
        <PasswordInput
          label="新密码"
          description="至少 8 位"
          mt="sm"
          value={pwdNew}
          onChange={(e) => setPwdNew(e.currentTarget.value)}
        />
        <PasswordInput
          label="确认新密码"
          mt="sm"
          value={pwdConfirm}
          onChange={(e) => setPwdConfirm(e.currentTarget.value)}
        />
        <Button mt="md" loading={pwdBusy} disabled={!pwdOld || !pwdNew} onClick={() => void changePassword()}>
          修改密码
        </Button>
      </SectionCard>
```

（`SectionCard` 内部布局如需 `<Box p="lg">` 包裹，参照相邻 SectionCard 的 children 结构对齐。）

- [ ] **Step 5: typecheck 与全量测试**

```bash
npm run typecheck
npx tsc --noEmit -p packages/web/tsconfig.json
npm test
```

Expected: 全部通过。

- [ ] **Step 6: 手工冒烟（dev 环境）**

```bash
npm run dev:server
```

另开终端 `npm run dev:web`，浏览器访问 `http://localhost:5173`：
1. 首次进入应见「创建管理员账号」（本地库无 auth 键时）。
2. 建号后自动进入主界面；登出 → 登录页；登录成功。
3. 设置页改密码 → 被踢回登录页 → 新密码可登录。
4. `/sub/<token>` 分享链接无 Cookie 也可访问。

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): 账号登录/初始化页、登出与修改密码，移除 X-Admin-Token"
```

---

### Task 5: 文档更新与收尾

**Files:**
- Modify: `CLAUDE.md`（「鉴权与安全」节）
- Modify: `docs/DEPLOY_CLOUDFLARE.md`（ADMIN_TOKEN secret 相关表述）
- Modify: `README.md`（如有 ADMIN_TOKEN 使用说明；先 `grep -n ADMIN_TOKEN README.md` 确认）

- [ ] **Step 1: CLAUDE.md 「鉴权与安全」节改写**

将首段「管理接口失败关闭：设了 ADMIN_TOKEN 则校验……」替换为：

```markdown
管理接口用**单账号 + Cookie 会话**（`auth.ts`）：账号与会话存 kv 表 `auth` 键，密码
PBKDF2-SHA256（WebCrypto，边缘可移植），会话 30 天、只存 token 哈希。未初始化时
`/api/*` 返回 401 + `needsSetup`，前端引导「创建管理员账号」。脚本/自动化用
`POST /api/auth/login` 换 token 后走 `Authorization: Bearer`。`SUBFORGE_ALLOW_NO_AUTH=1`
仍是本地无鉴权逃生门。`ADMIN_TOKEN` 只剩升级保护用途：环境里仍设有它时，初始化账号必须
先验旧口令（防存量公网实例被抢注），建号后可移除。分享出口 `/sub/:token` 始终公开。
```

- [ ] **Step 2: 部署文档**

`docs/DEPLOY_CLOUDFLARE.md` 与 `README.md` 中 grep `ADMIN_TOKEN`，把「必须设 ADMIN_TOKEN」类表述改为「首次访问网页创建管理员账号；存量部署升级时保留 ADMIN_TOKEN secret 直到建号完成，之后可删除」。CLAUDE.md 里「Cloudflare 部署的坑」提到的 `ADMIN_TOKEN 要用 wrangler secret put` 一句同步微调（改为「升级保护期间才需要」）。

- [ ] **Step 3: 最终验证**

```bash
npm run typecheck
npm test
```

Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/ README.md
git commit -m "docs: 账号登录取代 ADMIN_TOKEN 的鉴权说明与部署文档更新"
```

---

## Self-Review 已核对

- 规格逐节对照：存储（Task 1）、auth 模块（Task 2）、路由/中间件/升级保护/节流/Cookie（Task 3）、前端三态/登出/改密码（Task 4）、文档与兼容说明（Task 5）。
- 类型一致性：`AuthState/AuthAccount/AuthSession`、`addSession/hasValidSession/revokeSession/loadAuthState/saveAuthState/hashPassword/verifyPassword/SESSION_TTL_MS` 各任务间签名一致；web 侧 `authApi`/`AuthStatus`/`apiErrorText` 与 AuthGate/App/Settings 引用一致。
- 无占位符；所有代码块自包含。
