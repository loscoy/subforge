import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSubscriptionContent } from './service.js'

afterEach(() => vi.unstubAllGlobals())

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
