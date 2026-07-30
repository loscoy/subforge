import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeAgentModel } from './probe.js'

afterEach(() => vi.unstubAllGlobals())

describe('probeAgentModel', () => {
  it('上游失败时不读取或回显响应正文，并禁用重定向', async () => {
    const text = vi.fn(async () => 'internal service secret')
    const mocked = vi.fn(async () => ({ ok: false, status: 500, text }))
    vi.stubGlobal('fetch', mocked)

    const result = await probeAgentModel({ baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'x', model: 'm' })

    expect(result).toMatchObject({ ok: false, status: 500, error: '模型服务返回 HTTP 500' })
    expect(text).not.toHaveBeenCalled()
    expect((mocked.mock.calls[0]![1] as RequestInit).redirect).toBe('manual')
  })
})
