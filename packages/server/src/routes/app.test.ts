import * as yaml from 'js-yaml'
import { describe, expect, it, beforeEach } from 'vitest'
import { getConfig } from '../config.js'
import { NodeVmRunner } from '../sandbox/nodeVm.js'
import { saveSettings } from '../settings.js'
import { InMemoryStorage } from '../storage/index.js'
import { createApp } from './app.js'

const SUB = ['trojan://p1@hk.com:443#🇭🇰 HK 01', 'trojan://p2@us.com:443#🇺🇸 US 01'].join('\n')

describe('HTTP app', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    // 本地自用：显式允许无鉴权，便于测试管理接口
    app = createApp({ storage: new InMemoryStorage(), runner: new NodeVmRunner(), config: { ...getConfig(), allowNoAuth: true } })
  })

  async function json(res: Response) {
    return res.json() as Promise<any>
  }

  it('健康检查', async () => {
    const res = await app.fetch(new Request('http://x/healthz'))
    expect(res.status).toBe(200)
  })

  it('全流程：建订阅 → 建转换档 → /sub/:token 输出可用配置', async () => {
    const subRes = await app.fetch(
      new Request('http://x/api/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 's', content: SUB }),
      }),
    )
    const sub = await json(subRes)
    expect(subRes.status).toBe(201)

    const profRes = await app.fetch(
      new Request('http://x/api/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'p',
          subscriptionIds: [sub.id],
          profile: {
            groups: [{ name: '🚀', type: 'select', includeAll: true }, { name: '🇭🇰', type: 'url-test', filter: 'HK' }],
            rules: ['MATCH,🚀'],
          },
        }),
      }),
    )
    const prof = await json(profRes)
    expect(prof.token).toBeTruthy()

    const outRes = await app.fetch(new Request(`http://x/sub/${prof.token}`))
    expect(outRes.status).toBe(200)
    const text = await outRes.text()
    const cfg = yaml.load(text) as any
    expect(cfg.proxies).toHaveLength(2)
    expect(cfg['proxy-groups'][1].proxies).toEqual(['🇭🇰 HK 01'])
  })

  it('预览脚本返回前后节点', async () => {
    const sub = await json(
      await app.fetch(
        new Request('http://x/api/subscriptions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 's', content: SUB }),
        }),
      ),
    )
    const prof = await json(
      await app.fetch(
        new Request('http://x/api/profiles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'p', subscriptionIds: [sub.id] }),
        }),
      ),
    )
    const prev = await json(
      await app.fetch(
        new Request(`http://x/api/profiles/${prof.id}/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ script: `return utils.keep(nodes, 'HK')` }),
        }),
      ),
    )
    expect(prev.ok).toBe(true)
    expect(prev.before).toHaveLength(2)
    expect(prev.after).toHaveLength(1)
  })

  it('未知 token 返回 404', async () => {
    const res = await app.fetch(new Request('http://x/sub/nope'))
    expect(res.status).toBe(404)
  })
})

describe('管理接口鉴权（失败关闭）', () => {
  const mk = (config: Parameters<typeof createApp>[0]['config']) =>
    createApp({ storage: new InMemoryStorage(), runner: new NodeVmRunner(), config })
  const base = { ...getConfig(), adminToken: undefined, allowNoAuth: false }

  it('未设口令且未允许无鉵权 → /api 返回 503', async () => {
    const app = mk(base)
    const res = await app.fetch(new Request('http://x/api/meta'))
    expect(res.status).toBe(503)
  })

  it('显式允许无鉴权 → 放行', async () => {
    const app = mk({ ...base, allowNoAuth: true })
    const res = await app.fetch(new Request('http://x/api/meta'))
    expect(res.status).toBe(200)
  })

  it('设了口令 → 无/错口令 401，正确口令放行', async () => {
    const app = mk({ ...base, adminToken: 'secret' })
    expect((await app.fetch(new Request('http://x/api/meta'))).status).toBe(401)
    expect((await app.fetch(new Request('http://x/api/meta', { headers: { 'X-Admin-Token': 'wrong' } }))).status).toBe(401)
    expect((await app.fetch(new Request('http://x/api/meta', { headers: { 'X-Admin-Token': 'secret' } }))).status).toBe(200)
  })

  it('分享出口 /sub/:token 不受管理鉵权影响（仍公开）', async () => {
    const app = mk(base) // 无鉴权禁用管理接口，但分享出口应仍可访问（这里未知 token → 404 而非 503/401）
    const res = await app.fetch(new Request('http://x/sub/whatever'))
    expect(res.status).toBe(404)
  })
})

describe('远端 MCP', () => {
  const base = { ...getConfig(), adminToken: undefined, allowNoAuth: true }
  const json = (res: Response) => res.json() as Promise<any>
  const mcpRequest = (body: unknown, token?: string) =>
    new Request('http://x/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1.0.0' },
    },
  }
  const toolsList = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }

  // MCP 口令现在存数据库（加密），不再来自环境变量
  const MASTER_KEY = 'test-master-key'
  const mk = async (mcpToken?: string, checkNodes?: Parameters<typeof createApp>[0]['checkNodes']) => {
    const storage = new InMemoryStorage()
    if (mcpToken) await saveSettings(storage, MASTER_KEY, { mcpToken })
    return createApp({
      storage,
      runner: new NodeVmRunner(),
      config: { ...base, settingsKey: MASTER_KEY },
      checkNodes,
    })
  }

  it('未配置 MCP 口令时失败关闭', async () => {
    const res = await (await mk()).fetch(mcpRequest(initialize, 'anything'))
    expect(res.status).toBe(503)
  })

  it('配置了 SETTINGS_KEY 但口令存不进去时同样失败关闭', async () => {
    // 模拟部署漏设 SETTINGS_KEY：库里有密文，但解不开 → 视为未配置
    const storage = new InMemoryStorage()
    await saveSettings(storage, MASTER_KEY, { mcpToken: 'mcp-secret' })
    const app = createApp({ storage, runner: new NodeVmRunner(), config: { ...base, settingsKey: undefined } })
    const res = await app.fetch(mcpRequest(initialize, 'mcp-secret'))
    expect(res.status).toBe(503)
  })

  it('换过 SETTINGS_KEY 后旧密文解不开，也失败关闭', async () => {
    const storage = new InMemoryStorage()
    await saveSettings(storage, MASTER_KEY, { mcpToken: 'mcp-secret' })
    const app = createApp({ storage, runner: new NodeVmRunner(), config: { ...base, settingsKey: 'another-key' } })
    expect((await app.fetch(mcpRequest(initialize, 'mcp-secret'))).status).toBe(503)
  })

  it('配置 MCP 口令后要求正确的 Bearer token', async () => {
    const app = await mk('mcp-secret')
    const missing = await app.fetch(mcpRequest(initialize))
    const wrong = await app.fetch(mcpRequest(initialize, 'wrong'))

    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')
    expect(wrong.status).toBe(401)
  })

  it('正确 token 可以初始化 MCP', async () => {
    const res = await (await mk('mcp-secret')).fetch(mcpRequest(initialize, 'mcp-secret'))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.result.serverInfo.name).toBe('subforge')
  })

  it('无状态端点仅接受 POST', async () => {
    const app = await mk('mcp-secret')
    for (const method of ['GET', 'DELETE']) {
      const res = await app.fetch(
        new Request('http://x/mcp', {
          method,
          headers: {
            accept: 'application/json, text/event-stream',
            authorization: 'Bearer mcp-secret',
          },
        }),
      )
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    }
  })

  it('按运行时能力裁剪工具', async () => {
    const edgeRes = await (await mk('mcp-secret')).fetch(mcpRequest(toolsList, 'mcp-secret'))
    const nodeRes = await (await mk('mcp-secret', async () => [])).fetch(mcpRequest(toolsList, 'mcp-secret'))
    expect(edgeRes.status).toBe(200)
    expect(nodeRes.status).toBe(200)
    const edgeTools = (await json(edgeRes)).result.tools.map((tool: { name: string }) => tool.name)
    const nodeTools = (await json(nodeRes)).result.tools.map((tool: { name: string }) => tool.name)

    expect(edgeTools).toContain('list_profiles')
    expect(edgeTools).not.toContain('test_nodes')
    expect(nodeTools).toContain('test_nodes')
  })

  it('管理元数据公开连接信息但不泄露 token', async () => {
    const res = await (await mk('mcp-secret')).fetch(new Request('http://x/api/meta'))
    const meta = await json(res)

    expect(meta.mcp).toMatchObject({
      enabled: true,
      endpoint: '/mcp',
      transport: 'streamable-http',
    })
    expect(meta.mcp.tools.some((tool: { name: string }) => tool.name === 'list_profiles')).toBe(true)
    expect(meta.mcp.tools.some((tool: { name: string }) => tool.name === 'test_nodes')).toBe(false)
    expect(JSON.stringify(meta)).not.toContain('mcp-secret')
  })
})

describe('运行时设置端点', () => {
  const MASTER_KEY = 'test-master-key'
  const base = { ...getConfig(), adminToken: undefined, allowNoAuth: true }
  // 不给 settingsKey 设默认值：显式传入的 undefined 会被默认参数吃掉，
  // 「未配置主密钥」这条用例就会静默失效（同 AgentChatPanel 的 height 坑）。
  const mk = (settingsKey: string | undefined) => {
    const storage = new InMemoryStorage()
    return {
      storage,
      app: createApp({ storage, runner: new NodeVmRunner(), config: { ...base, settingsKey } }),
    }
  }
  const put = (body: unknown) =>
    new Request('http://x/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const read = async (res: Response) => res.json() as Promise<any>

  it('保存后即时生效，且响应不含明文密钥', async () => {
    const { app } = mk(MASTER_KEY)
    const saved = await read(
      await app.fetch(put({ agent: { baseURL: 'https://a/v1', model: 'm', apiKey: 'sk-abcdefghijkl' } })),
    )
    expect(saved.agent.apiKey).toEqual({ configured: true, hint: 'sk-…ijkl' })
    expect(JSON.stringify(saved)).not.toContain('sk-abcdefghijkl')

    // 同一实例下一个请求就能看到新配置（无需重启）
    const meta = await read(await app.fetch(new Request('http://x/api/meta')))
    expect(meta.hasAgent).toBe(false) // 未注入 makeAgent 的部署仍算不可用
    const got = await read(await app.fetch(new Request('http://x/api/settings')))
    expect(got.agent.model).toBe('m')
  })

  it('未配置 SETTINGS_KEY 时拒绝存密钥，但非密钥项照常保存', async () => {
    const { app } = mk(undefined)
    const rejected = await app.fetch(put({ mcpToken: 'x' }))
    expect(rejected.status).toBe(409)

    const ok = await app.fetch(put({ agent: { model: 'm' } }))
    expect(ok.status).toBe(200)
    const view = await read(ok)
    expect(view.canStoreSecrets).toBe(false)
    expect(view.agent.model).toBe('m')
  })

  it('非法引擎名被拒绝（perplexity 不能用于抓取）', async () => {
    const { app } = mk(MASTER_KEY)
    expect((await app.fetch(put({ web: { fetchEngine: 'perplexity' } }))).status).toBe(400)
    expect((await app.fetch(put({ web: { searchEngine: 'perplexity' } }))).status).toBe(200)
  })

  it('诊断信息回传运行时自述', async () => {
    const storage = new InMemoryStorage()
    const app = createApp({
      storage,
      runner: new NodeVmRunner(),
      config: { ...base, settingsKey: MASTER_KEY },
      checkNodes: async () => [],
      runtimeInfo: { runtime: 'node', storage: 'sqlite', sandbox: 'node:vm' },
    })
    const view = await read(await app.fetch(new Request('http://x/api/settings')))
    expect(view.diagnostics).toMatchObject({ runtime: 'node', storage: 'sqlite', sandbox: 'node:vm', healthcheck: true })
    expect(view.diagnostics.renderers.length).toBeGreaterThan(0)
  })
})

describe('Agent 会话端点', () => {
  // 不注入 makeAgent / 不配模型：建会话时起标题走「截断首句」降级路径，标题可预测。
  const mkApp = () =>
    createApp({ storage: new InMemoryStorage(), runner: new NodeVmRunner(), config: { ...getConfig(), allowNoAuth: true } })
  const body = (b: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  const j = (res: Response) => res.json() as Promise<any>

  it('建会话未配模型时用截断首句作标题；缺 firstMessage 报 400', async () => {
    const app = mkApp()
    const bad = await app.fetch(new Request('http://x/api/agent/sessions', body({ firstMessage: '   ' })))
    expect(bad.status).toBe(400)

    const res = await app.fetch(new Request('http://x/api/agent/sessions', body({ firstMessage: '帮我把香港节点单独分一组' })))
    const s = await j(res)
    expect(s.id).toBeTruthy()
    expect(s.title).toBe('帮我把香港节点单独分一组')
    expect(s.profileId).toBeUndefined()
  })

  it('会话按组隔离（全局 vs 配置档）', async () => {
    const app = mkApp()
    await app.fetch(new Request('http://x/api/agent/sessions', body({ firstMessage: '全局的事' })))
    await app.fetch(new Request('http://x/api/agent/sessions', body({ profileId: 'p1', firstMessage: '档内的事' })))

    const global = await j(await app.fetch(new Request('http://x/api/agent/sessions')))
    expect(global.map((s: any) => s.title)).toEqual(['全局的事'])
    const scoped = await j(await app.fetch(new Request('http://x/api/agent/sessions?profileId=p1')))
    expect(scoped.map((s: any) => s.title)).toEqual(['档内的事'])
  })

  it('重命名与删除（删除连带清消息）', async () => {
    const app = mkApp()
    const s = await j(await app.fetch(new Request('http://x/api/agent/sessions', body({ firstMessage: '原始标题' }))))

    // 空标题被拒
    expect((await app.fetch(new Request(`http://x/api/agent/sessions/${s.id}`, body({ title: '  ' }, 'PATCH')))).status).toBe(400)
    const renamed = await j(await app.fetch(new Request(`http://x/api/agent/sessions/${s.id}`, body({ title: '新标题' }, 'PATCH'))))
    expect(renamed.title).toBe('新标题')

    const del = await app.fetch(new Request(`http://x/api/agent/sessions/${s.id}`, { method: 'DELETE' }))
    expect(del.status).toBe(200)
    expect(await j(await app.fetch(new Request('http://x/api/agent/sessions')))).toEqual([])
  })

  it('重命名不存在的会话报 404', async () => {
    const app = mkApp()
    const res = await app.fetch(new Request('http://x/api/agent/sessions/nope', body({ title: 'x' }, 'PATCH')))
    expect(res.status).toBe(404)
  })
})
