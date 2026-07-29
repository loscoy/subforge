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

  it('无鉴权模式下 status 直接放行，前端不弹建号/登录门', async () => {
    const { app } = mk({ allowNoAuth: true })
    const st = await json(await app.fetch(new Request('http://x/api/auth/status')))
    expect(st.initialized).toBe(true)
    expect(st.authenticated).toBe(true)
  })

  it('/sub/:token 保持公开（未知 token → 404 而非 401）', async () => {
    const { app } = mk()
    expect((await app.fetch(new Request('http://x/sub/whatever'))).status).toBe(404)
  })
})
