import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { SCRIPT_DTS, getRenderer, listRenderers, parseSubscription, type ConversionProfile, type ScriptRunner } from '@subforge/core'
import type { NodeChecker } from '../health.js'
import type { AgentModelConfig, AgentRunner } from '../agent/index.js'
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
import type { Profile, StoredTemplate, Storage, Subscription } from '../storage/index.js'
import { buildTools } from '../tools/registry.js'
import {
  buildProfileOutput,
  collectRawSubscriptions,
  ensureSubscriptionContent,
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
}

/** 运行时能力（运行时 / 存储 / 沙箱）的只读自述，给设置页的诊断卡用。 */
export interface RuntimeInfo {
  runtime: string
  storage: string
  sandbox: string
}

const EMPTY_PROFILE: ConversionProfile = {
  groups: [{ name: '🚀 节点选择', type: 'select', includeAll: true, proxies: ['DIRECT'] }],
  rules: ['MATCH,🚀 节点选择'],
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

  // ---- 管理 API（鉴权：默认失败关闭） ----
  const api = new Hono()
  if (config.adminToken) {
    api.use('*', async (c, next) => {
      const auth = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') || c.req.header('X-Admin-Token')
      if (auth !== config.adminToken) return c.json({ error: '未授权' }, 401)
      await next()
    })
  } else if (!config.allowNoAuth) {
    // 未配置口令且未显式允许无鉴权 → 拒绝提供管理接口，避免任意跑脚本/抓 URL 的敞开风险。
    api.use('*', async (c, _next) =>
      c.json(
        {
          error:
            '本实例未配置 ADMIN_TOKEN，已拒绝以无鉴权方式提供管理接口。请设置 ADMIN_TOKEN；如确为本地自用需无鉴权，设 SUBFORGE_ALLOW_NO_AUTH=1。',
        },
        503,
      ),
    )
  } else {
    console.warn('⚠ SubForge 正在【无鉴权】模式运行（SUBFORGE_ALLOW_NO_AUTH=1）：任何人都可调用管理接口/执行脚本，切勿暴露到公网。')
  }

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
  // MCP 那侧的外部 agent 更不该。设置只经这几个受 ADMIN_TOKEN 保护的端点。
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

  // 转换档
  api.get('/profiles', async (c) => c.json(await storage.listProfiles()))
  api.get('/profiles/:id', async (c) => {
    const p = await storage.getProfile(c.req.param('id'))
    return p ? c.json(p) : c.json({ error: '不存在' }, 404)
  })
  api.post('/profiles', async (c) => {
    const body = await c.req.json<Partial<Profile>>()
    const p: Profile = {
      id: newId(),
      name: body.name || '未命名转换档',
      subscriptionIds: body.subscriptionIds || [],
      target: body.target || 'mihomo',
      script: body.script,
      profile: body.profile || structuredClone(EMPTY_PROFILE),
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
    if (!p) return c.json({ error: '转换档不存在' }, 404)
    await saveProfileWithVersion(storage, { ...p, profile: t.profile, script: t.script }, `套用模板「${t.name}」`)
    return c.json(await storage.getProfile(profileId))
  })

  // Agent
  api.get('/agent/messages/:threadId', async (c) => c.json(await storage.listMessages(c.req.param('threadId'))))
  api.post('/agent/chat', async (c) => {
    const agent = await agentOf()
    if (!agent) return c.json(AGENT_UNSET, 400)
    const { threadId, message, context } = await c.req.json<{ threadId: string; message: string; context?: string }>()
    if (!threadId || !message) return c.json({ error: '缺 threadId 或 message' }, 400)
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
    return streamSSE(c, async (stream) => {
      try {
        for await (const ev of agent.runStream(threadId, message, context)) {
          await stream.writeSSE({ data: JSON.stringify(ev) })
        }
      } catch (e) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: e instanceof Error ? e.message : String(e) }) })
      }
    })
  })

  app.route('/api', api)
  return app
}
