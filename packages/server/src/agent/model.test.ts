import { describe, expect, it } from 'vitest'
import { injectSessionId, isOpenRouterBaseUrl } from './model.js'

describe('isOpenRouterBaseUrl', () => {
  it('识别 openrouter 域名（含子域）', () => {
    expect(isOpenRouterBaseUrl('https://openrouter.ai/api/v1')).toBe(true)
    expect(isOpenRouterBaseUrl('https://openrouter.ai')).toBe(true)
    expect(isOpenRouterBaseUrl('https://gateway.openrouter.ai/api/v1')).toBe(true)
  })
  it('直连 OpenAI / 本地 / 非法 URL 一律 false（→ 不注入，其它 provider 零影响）', () => {
    expect(isOpenRouterBaseUrl('https://api.openai.com/v1')).toBe(false)
    expect(isOpenRouterBaseUrl('http://localhost:11434/v1')).toBe(false)
    // 防子域名伪造：openrouter.ai.evil.com 不应命中
    expect(isOpenRouterBaseUrl('https://openrouter.ai.evil.com/v1')).toBe(false)
    expect(isOpenRouterBaseUrl('not a url')).toBe(false)
  })
})

describe('injectSessionId', () => {
  it('把 session_id 注入请求体顶层，且保留其它字段', () => {
    const out = JSON.parse(injectSessionId(JSON.stringify({ model: 'm', messages: [] }), 'thread-1')) as Record<
      string,
      unknown
    >
    expect(out.session_id).toBe('thread-1')
    expect(out.model).toBe('m')
    expect(out.messages).toEqual([])
  })
  it('截断到 256 字符', () => {
    const out = JSON.parse(injectSessionId(JSON.stringify({}), 'x'.repeat(300))) as { session_id: string }
    expect(out.session_id).toHaveLength(256)
  })
  it('已存在 session_id 时不覆盖', () => {
    const out = JSON.parse(injectSessionId(JSON.stringify({ session_id: 'keep' }), 'new')) as { session_id: string }
    expect(out.session_id).toBe('keep')
  })
  it('空 sessionId / 非 JSON 请求体原样返回', () => {
    expect(injectSessionId('not json', 'x')).toBe('not json')
    expect(injectSessionId(JSON.stringify({ a: 1 }), '')).toBe(JSON.stringify({ a: 1 }))
  })
})
