import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebCapability, injectProviderTools, parseWebToolsEnv } from './webTools.js'

describe('parseWebToolsEnv', () => {
  it('未设置或值非法时不启用', () => {
    expect(parseWebToolsEnv({})).toBeUndefined()
    expect(parseWebToolsEnv({ AGENT_WEB_TOOLS: 'off' })).toBeUndefined()
    expect(parseWebToolsEnv({ AGENT_WEB_TOOLS: 'brave' })).toBeUndefined()
  })

  it('tavily 模式缺 key 时不启用（失败关闭）', () => {
    expect(parseWebToolsEnv({ AGENT_WEB_TOOLS: 'tavily' })).toBeUndefined()
    expect(parseWebToolsEnv({ AGENT_WEB_TOOLS: 'tavily', TAVILY_API_KEY: 'tk' })).toMatchObject({
      provider: 'tavily',
      apiKey: 'tk',
    })
  })

  it('openrouter 模式解析 engine 与上限（越界钳制、非法回退默认）', () => {
    const cfg = parseWebToolsEnv({
      AGENT_WEB_TOOLS: 'openrouter',
      AGENT_WEB_ENGINE: 'firecrawl',
      AGENT_WEB_MAX_TOOL_CALLS: '99',
      AGENT_WEB_MAX_RESULTS: 'abc',
    })!
    expect(cfg).toMatchObject({ provider: 'openrouter', engine: 'firecrawl', maxToolCalls: 25, maxResults: 5 })
  })
})

describe('buildWebCapability · openrouter', () => {
  it('产出 server tool 声明，无本地工具', () => {
    const cap = buildWebCapability({ provider: 'openrouter', engine: 'parallel', maxToolCalls: 5, maxResults: 3 })
    expect(cap.registryTools).toHaveLength(0)
    expect(cap.providerTools.map((t) => t.type)).toEqual(['openrouter:web_search', 'openrouter:web_fetch'])
    expect(cap.providerTools[0]).toMatchObject({ parameters: { engine: 'parallel', max_results: 3 } })
  })

  it('injectProviderTools 追加到已有 function tools 之后并带上调用上限', () => {
    const cap = buildWebCapability({ provider: 'openrouter', maxToolCalls: 5, maxResults: 5 })
    const raw = JSON.stringify({ model: 'm', tools: [{ type: 'function', function: { name: 'write_config' } }] })
    const body = JSON.parse(injectProviderTools(raw, cap))
    expect(body.tools).toHaveLength(3)
    expect(body.tools[0].type).toBe('function')
    expect(body.tools[1].type).toBe('openrouter:web_search')
    expect(body.max_tool_calls).toBe(5)
  })

  it('injectProviderTools 对无 tools 的请求体也生效，对非 JSON 原样返回', () => {
    const cap = buildWebCapability({ provider: 'openrouter', maxToolCalls: 5, maxResults: 5 })
    expect(JSON.parse(injectProviderTools('{"model":"m"}', cap)).tools).toHaveLength(2)
    expect(injectProviderTools('not json', cap)).toBe('not json')
  })
})

describe('buildWebCapability · tavily', () => {
  afterEach(() => vi.unstubAllGlobals())

  const cfg = { provider: 'tavily' as const, maxToolCalls: 5, maxResults: 3, apiKey: 'tk' }

  it('产出本地 web_search / web_fetch，无 server tool 声明', () => {
    const cap = buildWebCapability(cfg)
    expect(cap.providerTools).toHaveLength(0)
    expect(cap.registryTools.map((t) => t.name)).toEqual(['web_search', 'web_fetch'])
  })

  it('web_search 调用 Tavily API 并裁剪结果字段，条数受部署上限约束', async () => {
    const mock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          answer: 'A',
          results: [{ title: 'T', url: 'https://e.com', content: 'C', score: 0.9, extra: 'x' }],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', mock)
    const search = buildWebCapability(cfg).registryTools[0]!
    const r: any = await search.handler({ query: 'q', maxResults: 10 }, {} as never)
    expect(r).toEqual({ answer: 'A', results: [{ title: 'T', url: 'https://e.com', snippet: 'C' }] })
    const sent = JSON.parse((mock.mock.calls[0] as any)[1].body)
    expect(sent.max_results).toBe(3) // min(请求 10, 部署上限 3)
    expect((mock.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer tk')
  })

  it('web_fetch 失败时抛错（适配层会转成 { error } 结果）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ results: [], failed_results: [{ url: 'u', error: 'blocked' }] }), { status: 200 }),
      ),
    )
    const fetchTool = buildWebCapability(cfg).registryTools[1]!
    await expect(fetchTool.handler({ url: 'https://e.com/x' }, {} as never)).rejects.toThrow('blocked')
  })
})
