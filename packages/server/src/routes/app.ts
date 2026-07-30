import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { SCRIPT_DTS, getRenderer, listRenderers, parseSubscription, type ScriptRunner } from '@subforge/core'
import {
  SESSION_TTL_MS,
  addSession,
  hasValidSession,
  hashPassword,
  loginThrottleKey,
  loadAuthState,
  revokeSession,
  saveAuthState,
  verifyPassword,
} from '../auth.js'
import type { NodeChecker } from '../health.js'
import type { AgentModelConfig, AgentRunner } from '../agent/index.js'
import { fallbackTitle, generateSessionTitle } from '../agent/index.js'
import { probeAgentModel } from '../agent/probe.js'
import type { ServerConfig } from '../config.js'
import { handleMcpHttpRequest } from '../mcp/http.js'
import { timingSafeEqual } from '../security.js'
import {
  loadSettings,
  saveSettings,
  settingsPatchSchema,
  SettingsKeyMissingError,
  toAgentConfig,
  toSettingsView,
} from '../settings.js'
import type { Profile, Session, StoredTemplate, Storage, Subscription } from '../storage/index.js'
import { buildTools } from '../tools/registry.js'
import {
  buildProfileOutput,
  collectRawSubscriptions,
  ensureSubscriptionContent,
  newDefaultProfile,
  previewScript,
  rollbackProfile,
  saveProfileWithVersion,
} from '../service.js'
import { newId, newToken, now } from '../util.js'

export interface AppDeps {
  storage: Storage
  runner: ScriptRunner
  config: ServerConfig
  /**
   * 用运行时设置里的模型配置构建 agent。设置改了下一个请求就用新的，
   * 所以这里收参数而不是闭包捕获——两个运行时都按请求现造。
   */
  makeAgent?: (model: AgentModelConfig) => AgentRunner
  /** 测活能力（Node 注入；边缘缺省则该端点返回 501） */
  checkNodes?: NodeChecker
  /** 由入口自述当前跑在哪套实现上，供设置页的诊断卡展示 */
  runtimeInfo?: RuntimeInfo
  /** 由运行时提供真实对端 IP；Node 入口从 socket 读取，Workers 回退到 CF-Connecting-IP。 */
  getClientIp?: (c: Context) => string | undefined
}

/** 运行时能力（运行时 / 存储 / 沙箱）的只读自述，给设置页的诊断卡用。 */
export interface RuntimeInfo {
  runtime: string
  storage: string
  sandbox: string
}

export function createApp(deps: AppDeps): Hono {
  const { storage, runner, config } = deps
  const app = new Hono()
  const mcpTools = buildTools({ checkNodes: !!deps.checkNodes }).map(({ name, description }) => ({ name, description }))
  app.use('/api/*', cors())

  // 设置每次用时现读（单行查询）。分享出口 /sub/:token 这条热路径完全不碰它。
  const settingsOf = () => loadSettings(storage, config.settingsKey)
  /** 设置齐备且入口注入了 makeAgent 时才拿得到 agent，否则视为未配置。 */
  const agentOf = async (): Promise<AgentRunner | undefined> => {
    if (!deps.makeAgent) return undefined
    const model = toAgentConfig(await settingsOf())
    return model ? deps.makeAgent(model) : undefined
  }
  const AGENT_UNSET = { error: '未配置 Agent。请在「设置」页填写模型 Base URL / API Key / 模型名。' }

  // ---- 公开：分享出口 ----
  app.get('/sub/:token', async (c) => {
    const token = c.req.param('token')
    const profile = await storage.getProfileByToken(token)
    if (!profile) return c.text('订阅不存在', 404)
    const target = c.req.query('target') || profile.target
    const force = c.req.query('force') === '1'
    try {
      const out = await buildProfileOutput(storage, runner, { ...profile, target }, { force })
      const renderer = getRenderer(target)
      c.header('Content-Type', renderer?.contentType ?? 'text/plain; charset=utf-8')
      c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(profile.name)}.yaml"`)
      return c.body(out.config)
    } catch (e) {
      return c.text(`生成失败: ${e instanceof Error ? e.message : String(e)}`, 500)
    }
  })

  app.get('/healthz', (c) => c.json({ ok: true }))

  // ---- 远端 MCP（独立口令，始终失败关闭） ----
  app.all('/mcp', async (c) => {
    // 口令解不出来（没配 / SETTINGS_KEY 缺失或换过）一律当没配，拒绝服务。
    const mcpToken = (await settingsOf()).mcpToken
    if (!mcpToken) {
      return c.json({ error: 'Remote MCP is disabled because no MCP token is configured.' }, 503)
    }
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST')
      return c.json({ error: 'Method not allowed' }, 405)
    }

    const match = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)
    if (!(await timingSafeEqual(match?.[1] ?? '', mcpToken))) {
      c.header('WWW-Authenticate', 'Bearer')
      return c.json({ error: 'Unauthorized' }, 401)
    }

    return handleMcpHttpRequest(c.req.raw, { storage, runner, checkNodes: deps.checkNodes })
  })

  // ---- 管理 API（鉴权：账号会话，默认失败关闭） ----
  const SESSION_COOKIE = 'subforge_session'
  const sessionTokenOf = (c: Context) =>
    getCookie(c, SESSION_COOKIE) ?? c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const setSessionCookie = (c: Context, token: string) =>
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: new URL(c.req.url).protocol === 'https:',
    })
  const clientIpOf = (c: Context) =>
    deps.getClientIp?.(c)?.trim() || c.req.header('CF-Connecting-IP')?.trim() || 'unknown'
  const throttled = (c: Context, lockedUntil: number, at: number) => {
    c.header('Retry-After', String(Math.max(1, Math.ceil((lockedUntil - at) / 1000))))
    return c.json({ error: '尝试过于频繁，请稍后再试' }, 429)
  }

  const api = new Hono()
  if (config.allowNoAuth) {
    console.warn('⚠ SubForge 正在【无鉴权】模式运行（SUBFORGE_ALLOW_NO_AUTH=1）：任何人都可调用管理接口/执行脚本，切勿暴露到公网。')
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
    // 无鉴权模式下不存在账号概念，直接放行，前端不弹建号/登录门
    if (config.allowNoAuth) {
      return c.json({ initialized: true, authenticated: true })
    }
    const state = await loadAuthState(storage)
    const token = sessionTokenOf(c)
    const authenticated = !!state.account && !!token && (await hasValidSession(state, token, now()))
    return c.json({
      initialized: !!state.account,
      authenticated,
      username: authenticated ? state.account?.username : undefined,
    })
  })

  api.post('/auth/setup', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!username || password.length < 8) return c.json({ error: '用户名不能为空，密码至少 8 位' }, 400)
    const state = await loadAuthState(storage)
    if (state.account) return c.json({ error: '账号已存在' }, 409)
    state.account = { username, ...(await hashPassword(password)) }
    const token = await addSession(state, now())
    if (!(await storage.createAuthIfUninitialized(JSON.stringify(state)))) {
      return c.json({ error: '账号已存在或初始化状态已改变' }, 409)
    }
    setSessionCookie(c, token)
    return c.json({ ok: true, token }, 201)
  })

  api.post('/auth/login', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const state = await loadAuthState(storage)
    if (!state.account) return c.json({ error: '尚未初始化管理员账号', needsSetup: true }, 401)
    const at = now()
    const throttleKey = await loginThrottleKey(state.account.username, clientIpOf(c))
    const throttle = await storage.getLoginThrottle(throttleKey)
    if (throttle && at < throttle.lockedUntil) return throttled(c, throttle.lockedUntil, at)

    const usernameOk = await timingSafeEqual(String(body.username ?? ''), state.account.username)
    const passwordOk = await verifyPassword(String(body.password ?? ''), state.account)
    const ok = usernameOk && passwordOk
    if (!ok) {
      const next = await storage.recordLoginFailure(throttleKey, at)
      if (next.lockedUntil > at) return throttled(c, next.lockedUntil, at)
      return c.json({ error: '用户名或密码错误' }, 401)
    }
    await storage.clearLoginThrottle(throttleKey)
    const token = await addSession(state, now())
    await saveAuthState(storage, state)
    setSessionCookie(c, token)
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

  api.get('/meta', async (c) => {
    const settings = await settingsOf()
    return c.json({
      renderers: listRenderers(),
      hasAgent: !!deps.makeAgent && !!toAgentConfig(settings),
      scriptDts: SCRIPT_DTS,
      mcp: {
        enabled: !!settings.mcpToken,
        endpoint: '/mcp',
        transport: 'streamable-http' as const,
        tools: mcpTools,
      },
    })
  })

  // ---- 运行时设置 ----
  // 刻意不进 tools/registry.ts：模型不该能读写自己的 API key，
  // MCP 那侧的外部 agent 更不该。设置只经受登录会话保护的端点。
  // GET 与 PUT 回同一个形状，前端保存后可直接用返回值刷新界面。
  const settingsView = async () => ({
    ...toSettingsView(await settingsOf(), !!config.settingsKey),
    diagnostics: {
      ...(deps.runtimeInfo ?? { runtime: 'unknown', storage: 'unknown', sandbox: 'unknown' }),
      renderers: listRenderers(),
      healthcheck: !!deps.checkNodes,
    },
  })

  api.get('/settings', async (c) => c.json(await settingsView()))

  api.put('/settings', async (c) => {
    const parsed = settingsPatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: `设置格式不正确：${parsed.error.issues[0]?.message ?? ''}` }, 400)
    try {
      await saveSettings(storage, config.settingsKey, parsed.data)
      return c.json(await settingsView())
    } catch (e) {
      if (e instanceof SettingsKeyMissingError) return c.json({ error: e.message }, 409)
      throw e
    }
  })

  // 用请求体里的候选配置探测，允许先测再存；未传的字段回落到已存值。
  api.post('/settings/test', async (c) => {
    type Probe = { baseURL?: string; model?: string; apiKey?: string }
    const body = await c.req.json<Probe>().catch((): Probe => ({}))
    const saved = await settingsOf()
    const model: AgentModelConfig = {
      baseURL: body.baseURL?.trim() || saved.agent.baseURL || '',
      model: body.model?.trim() || saved.agent.model || '',
      apiKey: body.apiKey?.trim() || saved.agent.apiKey || '',
    }
    if (!model.baseURL || !model.model || !model.apiKey) {
      return c.json({ ok: false, latencyMs: 0, error: 'Base URL / 模型名 / API Key 三项都要有才能测试。' })
    }
    return c.json(await probeAgentModel(model))
  })

  // 订阅
  api.get('/subscriptions', async (c) => c.json(await storage.listSubscriptions()))
  api.post('/subscriptions', async (c) => {
    const body = await c.req.json<Partial<Subscription>>()
    const sub: Subscription = {
      id: newId(),
      name: body.name || '未命名订阅',
      url: body.url,
      content: body.content,
      createdAt: now(),
      updatedAt: now(),
    }
    await storage.upsertSubscription(sub)
    return c.json(sub, 201)
  })
  api.put('/subscriptions/:id', async (c) => {
    const cur = await storage.getSubscription(c.req.param('id'))
    if (!cur) return c.json({ error: '不存在' }, 404)
    const body = await c.req.json<Partial<Subscription>>()
    const next: Subscription = { ...cur, ...body, id: cur.id, updatedAt: now() }
    await storage.upsertSubscription(next)
    return c.json(next)
  })
  api.delete('/subscriptions/:id', async (c) => {
    await storage.deleteSubscription(c.req.param('id'))
    return c.json({ ok: true })
  })
  api.post('/subscriptions/:id/refresh', async (c) => {
    const sub = await storage.getSubscription(c.req.param('id'))
    if (!sub) return c.json({ error: '不存在' }, 404)
    try {
      await ensureSubscriptionContent(storage, sub, 0, true)
      return c.json(await storage.getSubscription(sub.id))
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  })

  // 配置
  api.get('/profiles', async (c) => c.json(await storage.listProfiles()))
  api.get('/profiles/:id', async (c) => {
    const p = await storage.getProfile(c.req.param('id'))
    return p ? c.json(p) : c.json({ error: '不存在' }, 404)
  })
  api.post('/profiles', async (c) => {
    const body = await c.req.json<Partial<Profile>>()
    const p: Profile = {
      id: newId(),
      name: body.name || '未命名配置',
      subscriptionIds: body.subscriptionIds || [],
      target: body.target || 'mihomo',
      script: body.script,
      profile: body.profile || newDefaultProfile(),
      token: newToken(),
      createdAt: now(),
      updatedAt: now(),
    }
    await storage.upsertProfile(p)
    return c.json(p, 201)
  })
  api.put('/profiles/:id', async (c) => {
    const cur = await storage.getProfile(c.req.param('id'))
    if (!cur) return c.json({ error: '不存在' }, 404)
    const body = await c.req.json<Partial<Profile>>()
    const next: Profile = { ...cur, ...body, id: cur.id, token: cur.token }
    await saveProfileWithVersion(storage, next, '手动保存')
    return c.json(await storage.getProfile(cur.id))
  })
  api.delete('/profiles/:id', async (c) => {
    await storage.deleteProfile(c.req.param('id'))
    return c.json({ ok: true })
  })

  // 预览 / 输出 / 版本
  api.post('/profiles/:id/preview', async (c) => {
    const p = await storage.getProfile(c.req.param('id'))
    if (!p) return c.json({ error: '不存在' }, 404)
    const { script } = await c.req.json<{ script: string }>()
    const r = await previewScript(storage, runner, p, script ?? p.script ?? '')
    return c.json(r)
  })
  api.get('/profiles/:id/output', async (c) => {
    const p = await storage.getProfile(c.req.param('id'))
    if (!p) return c.json({ error: '不存在' }, 404)
    try {
      const out = await buildProfileOutput(storage, runner, p)
      return c.json({ ok: true, config: out.config, stats: out.stats, logs: out.logs })
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
    }
  })
  api.post('/profiles/:id/healthcheck', async (c) => {
    if (!deps.checkNodes) return c.json({ error: '当前部署不支持测活（边缘运行时）' }, 501)
    const p = await storage.getProfile(c.req.param('id'))
    if (!p) return c.json({ error: '不存在' }, 404)
    const raws = await collectRawSubscriptions(storage, p)
    const nodes = raws.flatMap((r) => parseSubscription(r))
    const results = await deps.checkNodes(nodes)
    const alive = results.filter((r) => r.latency !== null).length
    return c.json({ total: results.length, alive, results })
  })
  api.get('/profiles/:id/versions', async (c) => c.json(await storage.listVersions(c.req.param('id'))))
  api.post('/profiles/:id/rollback', async (c) => {
    const { versionId } = await c.req.json<{ versionId: string }>()
    try {
      const restored = await rollbackProfile(storage, c.req.param('id'), versionId)
      return c.json(restored)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  // 模板
  api.get('/templates', async (c) => c.json(await storage.listTemplates()))
  api.post('/templates', async (c) => {
    const b = await c.req.json<Partial<StoredTemplate>>()
    const t: StoredTemplate = {
      id: newId(), name: b.name || '未命名模板', description: b.description,
      profile: b.profile || { groups: [], rules: [] }, script: b.script,
      createdAt: now(), updatedAt: now(),
    }
    await storage.upsertTemplate(t)
    return c.json(t, 201)
  })
  api.put('/templates/:id', async (c) => {
    const cur = await storage.getTemplate(c.req.param('id'))
    if (!cur) return c.json({ error: '不存在' }, 404)
    const b = await c.req.json<Partial<StoredTemplate>>()
    const next: StoredTemplate = { ...cur, ...b, id: cur.id, updatedAt: now() }
    await storage.upsertTemplate(next)
    return c.json(next)
  })
  api.delete('/templates/:id', async (c) => {
    await storage.deleteTemplate(c.req.param('id'))
    return c.json({ ok: true })
  })
  api.post('/templates/:id/apply', async (c) => {
    const t = await storage.getTemplate(c.req.param('id'))
    if (!t) return c.json({ error: '模板不存在' }, 404)
    const { profileId } = await c.req.json<{ profileId: string }>()
    const p = await storage.getProfile(profileId)
    if (!p) return c.json({ error: '配置不存在' }, 404)
    await saveProfileWithVersion(storage, { ...p, profile: t.profile, script: t.script }, `套用模板「${t.name}」`)
    return c.json(await storage.getProfile(profileId))
  })

  // Agent 会话（threadId = session.id）
  // 会话按「组」隔离：profileId 查询参数存在时取该配置档的会话组，否则取全局组。
  api.get('/agent/sessions', async (c) => {
    const profileId = c.req.query('profileId') || null
    return c.json(await storage.listSessions(profileId))
  })
  // 建会话时顺手起标题：等模型生成完再返回（带超时降级），不预建空会话——
  // 前端点「新对话」只是本地草稿态，发首条消息才落库，列表里不会堆没说过话的空壳。
  api.post('/agent/sessions', async (c) => {
    const { profileId, firstMessage } = await c.req.json<{ profileId?: string; firstMessage?: string }>()
    const first = (firstMessage ?? '').trim()
    if (!first) return c.json({ error: '缺 firstMessage' }, 400)
    const model = toAgentConfig(await settingsOf())
    const title = model ? await generateSessionTitle(model, first) : fallbackTitle(first)
    const ts = now()
    const session: Session = { id: newId(), title, profileId: profileId || undefined, createdAt: ts, updatedAt: ts }
    await storage.upsertSession(session)
    return c.json(session)
  })
  api.patch('/agent/sessions/:id', async (c) => {
    const session = await storage.getSession(c.req.param('id'))
    if (!session) return c.json({ error: '会话不存在' }, 404)
    const { title } = await c.req.json<{ title?: string }>()
    const next = (title ?? '').trim()
    if (!next) return c.json({ error: '标题不能为空' }, 400)
    const updated: Session = { ...session, title: next, updatedAt: now() }
    await storage.upsertSession(updated)
    return c.json(updated)
  })
  api.delete('/agent/sessions/:id', async (c) => {
    await storage.deleteSession(c.req.param('id'))
    return c.json({ ok: true })
  })

  // Agent
  api.get('/agent/messages/:threadId', async (c) => c.json(await storage.listMessages(c.req.param('threadId'))))
  api.post('/agent/chat', async (c) => {
    const agent = await agentOf()
    if (!agent) return c.json(AGENT_UNSET, 400)
    const { threadId, message, context } = await c.req.json<{ threadId: string; message: string; context?: string }>()
    if (!threadId || !message) return c.json({ error: '缺 threadId 或 message' }, 400)
    await storage.touchSession(threadId, now()) // 让会话浮到列表顶部；无对应会话则 no-op
    try {
      const reply = await agent.run(threadId, message, context)
      return c.json(reply)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
    }
  })
  api.post('/agent/stream', async (c) => {
    const agent = await agentOf()
    if (!agent) return c.json(AGENT_UNSET, 400)
    const { threadId, message, context } = await c.req.json<{ threadId: string; message: string; context?: string }>()
    if (!threadId || !message) return c.json({ error: '缺 threadId 或 message' }, 400)
    await storage.touchSession(threadId, now()) // 让会话浮到列表顶部；无对应会话则 no-op
    return streamSSE(c, async (stream) => {
      // 客户端断开（用户点了停止）时中止模型生成，别继续烧 token
      const ac = new AbortController()
      stream.onAbort(() => ac.abort())
      try {
        for await (const ev of agent.runStream(threadId, message, context, ac.signal)) {
          await stream.writeSSE({ data: JSON.stringify(ev) })
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: e instanceof Error ? e.message : String(e) }) })
        }
      }
    })
  })

  app.route('/api', api)
  return app
}
