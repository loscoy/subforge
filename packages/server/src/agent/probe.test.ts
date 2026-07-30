import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeAgentModel } from './probe.js'

afterEach(() => vi.unstubAllGlobals())

describe('probeAgentModel', () => {
  it('上游失败时不读取或回显响应正文，并禁用重定向', async () => {
    const text = vi.fn(async () => 'internal service secret')
    const mocked = vi.fn(async () => ({ ok: false, status: 500, text }))
    vi.stubGlobal('fetch', mocked)

    const result = await probeAgentModel({ baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'x', model: 'm' })

    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(result.error).not.toContain('secret')
    expect(text).not.toHaveBeenCalled()
    expect((mocked.mock.calls[0]![1] as RequestInit).redirect).toBe('manual')
  })

  it('按状态码给出可操作提示（仍不读正文）', async () => {
    const text = vi.fn(async () => 'leaky body')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text })))
    const result = await probeAgentModel({ baseURL: 'https://api.example.com/v1', apiKey: 'x', model: 'm' })
    expect(result.error).toContain('API Key')
    expect(text).not.toHaveBeenCalled()
  })
})
