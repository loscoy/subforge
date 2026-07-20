import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { SCRIPT_DTS, getRenderer, listRenderers, parseSubscription, type ConversionProfile, type ScriptRunner } from '@subforge/core'
import { checkNodes } from '../health.js'
import type { AgentRunner } from '../agent/index.js'
import type { ServerConfig } from '../config.js'
import type { Profile, Storage, Subscription } from '../storage/index.js'
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
  /** 构建 agent（config.agent 存在时提供） */
  makeAgent?: () => AgentRunner
}

const EMPTY_PROFILE: ConversionProfile = {
  groups: [{ name: '🚀 节点选择', type: 'select', includeAll: true, proxies: ['DIRECT'] }],
  rules: ['MATCH,🚀 节点选择'],
}

export function createApp(deps: AppDeps): Hono {
  const { storage, runner, config } = deps
  const app = new Hono()
  app.use('/api/*', cors())

  // ---- 公开：分享出口 ----
  app.get('/sub/:token', async (c) => {
    const token = c.req.param('token')
    const profile = storage.getProfileByToken(token)
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

  // ---- 管理 API（可选鉴权） ----
  const api = new Hono()
  if (config.adminToken) {
    api.use('*', async (c, next) => {
      const auth = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') || c.req.header('X-Admin-Token')
      if (auth !== config.adminToken) return c.json({ error: '未授权' }, 401)
      await next()
    })
  }

  api.get('/meta', (c) =>
    c.json({ renderers: listRenderers(), hasAgent: !!deps.makeAgent, scriptDts: SCRIPT_DTS }),
  )

  // 订阅
  api.get('/subscriptions', (c) => c.json(storage.listSubscriptions()))
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
    storage.upsertSubscription(sub)
    return c.json(sub, 201)
  })
  api.put('/subscriptions/:id', async (c) => {
    const cur = storage.getSubscription(c.req.param('id'))
    if (!cur) return c.json({ error: '不存在' }, 404)
    const body = await c.req.json<Partial<Subscription>>()
    const next: Subscription = { ...cur, ...body, id: cur.id, updatedAt: now() }
    storage.upsertSubscription(next)
    return c.json(next)
  })
  api.delete('/subscriptions/:id', (c) => {
    storage.deleteSubscription(c.req.param('id'))
    return c.json({ ok: true })
  })
  api.post('/subscriptions/:id/refresh', async (c) => {
    const sub = storage.getSubscription(c.req.param('id'))
    if (!sub) return c.json({ error: '不存在' }, 404)
    try {
      await ensureSubscriptionContent(storage, sub, 0, true)
      return c.json(storage.getSubscription(sub.id))
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  })

  // 转换档
  api.get('/profiles', (c) => c.json(storage.listProfiles()))
  api.get('/profiles/:id', (c) => {
    const p = storage.getProfile(c.req.param('id'))
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
    storage.upsertProfile(p)
    return c.json(p, 201)
  })
  api.put('/profiles/:id', async (c) => {
    const cur = storage.getProfile(c.req.param('id'))
    if (!cur) return c.json({ error: '不存在' }, 404)
    const body = await c.req.json<Partial<Profile>>()
    const next: Profile = { ...cur, ...body, id: cur.id, token: cur.token }
    saveProfileWithVersion(storage, next, '手动保存')
    return c.json(storage.getProfile(cur.id))
  })
  api.delete('/profiles/:id', (c) => {
    storage.deleteProfile(c.req.param('id'))
    return c.json({ ok: true })
  })

  // 预览 / 输出 / 版本
  api.post('/profiles/:id/preview', async (c) => {
    const p = storage.getProfile(c.req.param('id'))
    if (!p) return c.json({ error: '不存在' }, 404)
    const { script } = await c.req.json<{ script: string }>()
    const r = await previewScript(storage, runner, p, script ?? p.script ?? '')
    return c.json(r)
  })
  api.get('/profiles/:id/output', async (c) => {
    const p = storage.getProfile(c.req.param('id'))
    if (!p) return c.json({ error: '不存在' }, 404)
    try {
      const out = await buildProfileOutput(storage, runner, p)
      return c.json({ ok: true, config: out.config, stats: out.stats, logs: out.logs })
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
    }
  })
  api.post('/profiles/:id/healthcheck', async (c) => {
    const p = storage.getProfile(c.req.param('id'))
    if (!p) return c.json({ error: '不存在' }, 404)
    const raws = await collectRawSubscriptions(storage, p)
    const nodes = raws.flatMap((r) => parseSubscription(r))
    const results = await checkNodes(nodes)
    const alive = results.filter((r) => r.latency !== null).length
    return c.json({ total: results.length, alive, results })
  })
  api.get('/profiles/:id/versions', (c) => c.json(storage.listVersions(c.req.param('id'))))
  api.post('/profiles/:id/rollback', async (c) => {
    const { versionId } = await c.req.json<{ versionId: string }>()
    try {
      const restored = rollbackProfile(storage, c.req.param('id'), versionId)
      return c.json(restored)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  // Agent
  api.get('/agent/messages/:threadId', (c) => c.json(storage.listMessages(c.req.param('threadId'))))
  api.post('/agent/chat', async (c) => {
    if (!deps.makeAgent) return c.json({ error: '未配置 Agent（缺 OPENAI_* 环境变量）' }, 400)
    const { threadId, message } = await c.req.json<{ threadId: string; message: string }>()
    if (!threadId || !message) return c.json({ error: '缺 threadId 或 message' }, 400)
    try {
      const reply = await deps.makeAgent().run(threadId, message)
      return c.json(reply)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
    }
  })

  app.route('/api', api)
  return app
}
