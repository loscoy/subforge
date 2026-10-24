import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProfileOutput, collectRawSubscriptions, ensureSubscriptionContent, fetchSubscriptionContent, previewScript, refreshDueSubscriptions, rollbackProfile, saveProfileWithVersion, updateSubscription } from './service.js'
import { InMemoryStorage, type Profile, type Subscription } from './storage/index.js'
import { QuickJsRunner } from './sandbox/quickjs.js'

afterEach(() => vi.unstubAllGlobals())

describe('订阅与管线回归', () => {
  const raw = 'trojan://secret@example.com:443#A\ntrojan://secret@example.org:443#B'
  const sub: Subscription = { id: 's', name: 'source', url: 'https://example.com/sub', content: raw, fetchedAt: 1, createdAt: 1, updatedAt: 1 }
  const profile: Profile = { id: 'p', name: 'profile', token: 't', target: 'mihomo', subscriptionIds: ['s'], profile: { groups: [], rules: [], operations: [{ op: 'rename', from: 'A', to: 'C' }, { op: 'keep', pattern: 'C' }] }, createdAt: 1, updatedAt: 1 }

  it('定时刷新默认关闭、遵守间隔，失败保留缓存并告警，恢复记录节点差异', async () => {
    const storage = new InMemoryStorage()
    await storage.upsertSubscription(sub)
    const fetcher = vi.fn(async () => new Response('failure', { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    await refreshDueSubscriptions(storage)
    expect(fetcher).not.toHaveBeenCalled()
    const enabled = { ...sub, fetchPolicy: { autoRefresh: true, intervalMinutes: 5, failureThreshold: 2, dropPercent: 50 } }
    await storage.upsertSubscription(enabled)
    await refreshDueSubscriptions(storage)
    await refreshDueSubscriptions(storage)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await storage.getRefreshState('s'))!.alerts).toEqual([])
    await expect(ensureSubscriptionContent(storage, enabled, 0, true)).rejects.toThrow('503')
    expect((await storage.getRefreshState('s'))!.failures).toBe(2)
    expect((await storage.getRefreshState('s'))!.alerts[0]).toContain('连续刷新失败 2 次')
    expect((await storage.getSubscription('s'))!.content).toBe(raw)
    fetcher.mockImplementation(async () => new Response('trojan://secret@example.com:443#A'))
    await ensureSubscriptionContent(storage, enabled, 0, true)
    const status = (await storage.getRefreshState('s'))!
    expect(status.failures).toBe(0)
    expect(status.alerts[0]).toContain('2 → 1')
    expect(status.history[0]!.delta?.removed.map(n => n.name)).toEqual(['B'])
    expect(JSON.stringify(status)).not.toContain('secret')
    expect(status.history.map(h => h.ok)).toEqual([true, false, false])
  })

  it('无效成功响应不覆盖有效缓存；URL 改动清除旧缓存', async () => {
    const storage = new InMemoryStorage()
    await storage.upsertSubscription(sub)
    vi.stubGlobal('fetch', async () => new Response('<html>upstream error</html>'))
    await expect(ensureSubscriptionContent(storage, sub, 0, true)).rejects.toThrow('no valid nodes')
    expect(await storage.getSubscription('s')).toEqual(sub)
    const next = await updateSubscription(storage, sub, { url: 'https://example.org/sub' })
    expect(next.content).toBeUndefined()
    expect(next.fetchedAt).toBeUndefined()
    const manual = await updateSubscription(storage, next, { url: '', content: raw })
    expect(manual.content).toBe(raw)
  })

  it('合并同源请求、限制并发并保留关联顺序', async () => {
    const storage = new InMemoryStorage()
    let active = 0
    let peak = 0
    const fetcher = vi.fn(async () => {
      peak = Math.max(peak, ++active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return new Response(raw)
    })
    vi.stubGlobal('fetch', fetcher)
    for (let i = 0; i < 9; i++) await storage.upsertSubscription({ ...sub, id: `s${i}` })
    const p = { ...profile, subscriptionIds: Array.from({ length: 9 }, (_, i) => `s${i}`) }
    const [a, b] = await Promise.all([collectRawSubscriptions(storage, p), collectRawSubscriptions(storage, p)])
    expect(a).toEqual(Array(9).fill(raw))
    expect(b).toEqual(a)
    expect(fetcher).toHaveBeenCalledTimes(9)
    expect(peak).toBe(4)
  })

  it('按每源策略过期，UA 改动失效且新请求携带新 UA', async () => {
    const storage = new InMemoryStorage()
    const cached = { ...sub, fetchedAt: Date.now() - 90_000, fetchPolicy: { maxAgeMinutes: 2, userAgent: 'source-agent' } }
    await storage.upsertSubscription(cached)
    const mocked = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('user-agent')).toBe('next-agent')
      return new Response(raw)
    })
    vi.stubGlobal('fetch', mocked)
    expect(await collectRawSubscriptions(storage, profile)).toEqual([raw])
    expect(mocked).not.toHaveBeenCalled()
    const next = await updateSubscription(storage, cached, { fetchPolicy: { maxAgeMinutes: 1, userAgent: 'next-agent' } })
    expect(next.content).toBeUndefined()
    await collectRawSubscriptions(storage, profile)
    expect(mocked).toHaveBeenCalledTimes(1)
    await expect(updateSubscription(storage, next, { fetchPolicy: { userAgent: 'bad\r\nHeader: x' } })).rejects.toThrow()
  })

  it('预览和正式输出使用相同操作顺序；空脚本仍应用操作', async () => {
    const storage = new InMemoryStorage()
    await storage.upsertSubscription({ ...sub, url: undefined })
    const runner = new QuickJsRunner()
    for (const script of ['', 'return nodes.map(n => ({...n, name: n.name + "!"}))']) {
      const preview = await previewScript(storage, runner, profile, script)
      const output = await buildProfileOutput(storage, runner, { ...profile, script })
      expect(preview.ok).toBe(true)
      expect(preview.after.map(n => n.name)).toEqual([script ? 'C!' : 'C'])
      expect(preview.config).toBe(output.config)
    }
    const override = await previewScript(storage, runner, { ...profile, target: 'singbox' }, 'function main(config) { return config }')
    expect(override.ok).toBe(false)
    expect(override.error).toContain('mihomo')
    const clash = await previewScript(storage, runner, { ...profile, target: 'clash' }, 'function main(config) { config.proxies = []; return config }')
    expect(clash.ok).toBe(true)
    expect(clash.after).toEqual([])
  })

  it('回滚恢复来源和空脚本，保留当前分享 token', async () => {
    const storage = new InMemoryStorage()
    await storage.upsertSubscription(sub)
    await storage.upsertSubscription({ ...sub, id: 'other' })
    await storage.upsertProfile(profile)
    const saved = await saveProfileWithVersion(storage, profile, { ...profile, subscriptionIds: ['other'], script: 'return []' })
    await storage.replaceProfile(saved, { ...saved, token: 'rotated' })
    const [version] = await storage.listVersions(profile.id)
    const restored = await rollbackProfile(storage, profile.id, version!.id)
    expect(restored.subscriptionIds).toEqual(['s'])
    expect(restored.script).toBeUndefined()
    expect(restored.token).toBe('rotated')
  })
})

describe('fetchSubscriptionContent', () => {
  it('禁用自动重定向并为整次抓取设置中止信号', async () => {
    const mocked = vi.fn(async () => new Response('trojan://secret@example.com:443'))
    vi.stubGlobal('fetch', mocked)

    await fetchSubscriptionContent('https://sub.example.com/list')

    const init = mocked.mock.calls[0]![1] as RequestInit
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('每一跳重定向都重新拒绝内网目标', async () => {
    const mocked = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    )
    vi.stubGlobal('fetch', mocked)

    await expect(fetchSubscriptionContent('https://sub.example.com/list')).rejects.toThrow('内网/保留地址')
    expect(mocked).toHaveBeenCalledTimes(1)
  })

  it('保留合法的公网相对重定向与流量信息', async () => {
    const mocked = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/final' } }))
      .mockResolvedValueOnce(
        new Response('trojan://secret@example.com:443', {
          headers: { 'subscription-userinfo': 'upload=1; download=2; total=10' },
        }),
      )
    vi.stubGlobal('fetch', mocked)

    const result = await fetchSubscriptionContent('https://sub.example.com/list')
    expect(result.content).toContain('trojan://')
    expect(result.userInfo).toMatchObject({ upload: 1, download: 2, total: 10 })
    expect(String(mocked.mock.calls[1]![0])).toBe('https://sub.example.com/final')
  })

  it('流式读取并拒绝超过上限的响应体', async () => {
    const mocked = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('1234'))
          controller.enqueue(new TextEncoder().encode('5678'))
          controller.close()
        },
      })
      return new Response(body)
    })
    vi.stubGlobal('fetch', mocked)

    await expect(
      fetchSubscriptionContent('https://sub.example.com/list', { maxBytes: 5 }),
    ).rejects.toThrow('响应体过大')
  })

  it('超时后中止仍未完成的抓取', async () => {
    const fetchImpl = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    ) as unknown as typeof fetch

    await expect(
      fetchSubscriptionContent('https://sub.example.com/list', { fetchImpl, timeoutMs: 10 }),
    ).rejects.toThrow('抓取订阅超时')
  })
})
