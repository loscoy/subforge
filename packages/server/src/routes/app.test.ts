import yaml from 'js-yaml'
import { describe, expect, it, beforeEach } from 'vitest'
import { getConfig } from '../config.js'
import { NodeVmRunner } from '../sandbox/nodeVm.js'
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
