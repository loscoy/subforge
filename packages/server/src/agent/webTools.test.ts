import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebCapability, injectProviderTools, type WebToolsConfig } from './webTools.js'

const base = { maxToolCalls: 5, maxResults: 3 }
/** 断言用：能力必然存在时取出来 */
const build = (cfg: WebToolsConfig) => {
  const cap = buildWebCapability(cfg)
  if (!cap) throw new Error('期望产出 WebCapability')
  return cap
}
const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('buildWebCapability · 能力开关', () => {
  it('两个能力都没选供应商 → 不联网', () => {
    expect(buildWebCapability({ ...base })).toBeUndefined()
  })

  it('选了供应商但缺 key → 该能力被跳过（失败关闭）', () => {
    expect(buildWebCapability({ ...base, searchProvider: 'tavily' })).toBeUndefined()
    expect(buildWebCapability({ ...base, searchProvider: 'exa' })).toBeUndefined()
    // 只有 fetch 有 key 时，只装 fetch
    const cap = build({ ...base, searchProvider: 'exa', fetchProvider: 'exa', exaApiKey: 'ek' })
    expect(cap.registryTools.map((t) => t.name)).toEqual(['web_search', 'web_fetch'])
  })

  it('只开搜索时系统提示不提 web_fetch，免得模型去调不存在的工具', () => {
    const cap = build({ ...base, searchProvider: 'openrouter' })
    expect(cap.systemHint).toContain('web_search')
    expect(cap.systemHint).not.toContain('web_fetch')
  })
})

describe('buildWebCapability · 混搭供应商', () => {
  it('search 走 OpenRouter 服务端工具、fetch 走 Exa 本地工具', () => {
    const cap = build({ ...base, searchProvider: 'openrouter', fetchProvider: 'exa', exaApiKey: 'ek' })
    expect(cap.providerTools.map((t) => t.type)).toEqual(['openrouter:web_search'])
    expect(cap.registryTools.map((t) => t.name)).toEqual(['web_fetch'])
    // 同名工具只能来自一个供应商，否则模型会看到两个 web_fetch
    expect(cap.registryTools.filter((t) => t.name === 'web_fetch')).toHaveLength(1)
  })

  it('search 走 Tavily、fetch 走 OpenRouter', () => {
    const cap = build({ ...base, searchProvider: 'tavily', fetchProvider: 'openrouter', tavilyApiKey: 'tk' })
    expect(cap.registryTools.map((t) => t.name)).toEqual(['web_search'])
    expect(cap.providerTools.map((t) => t.type)).toEqual(['openrouter:web_fetch'])
  })
})

describe('buildWebCapability · openrouter', () => {
  it('产出 server tool 声明，无本地工具', () => {
    const cap = build({
      ...base,
      searchProvider: 'openrouter',
      fetchProvider: 'openrouter',
      searchEngine: 'parallel',
      fetchEngine: 'exa',
    })
    expect(cap.registryTools).toHaveLength(0)
    expect(cap.providerTools.map((t) => t.type)).toEqual(['openrouter:web_search', 'openrouter:web_fetch'])
    expect(cap.providerTools[0]).toMatchObject({ parameters: { engine: 'parallel', max_results: 3 } })
    expect(cap.providerTools[1]).toMatchObject({ parameters: { engine: 'exa', max_content_tokens: 8000 } })
  })

  it('auto 表示不下发 engine 参数，交给 OpenRouter 自选', () => {
    const cap = build({
      ...base,
      searchProvider: 'openrouter',
      fetchProvider: 'openrouter',
      searchEngine: 'auto',
      fetchEngine: 'auto',
    })
    expect(cap.providerTools[0]!.parameters).not.toHaveProperty('engine')
    expect(cap.providerTools[1]!.parameters).not.toHaveProperty('engine')
  })

  it('injectProviderTools 追加到已有 function tools 之后并带上调用上限', () => {
    const cap = build({ ...base, searchProvider: 'openrouter', fetchProvider: 'openrouter' })
    const raw = JSON.stringify({ model: 'm', tools: [{ type: 'function', function: { name: 'write_config' } }] })
    const body = JSON.parse(injectProviderTools(raw, cap))
    expect(body.tools).toHaveLength(3)
    expect(body.tools[0].type).toBe('function')
    expect(body.tools[1].type).toBe('openrouter:web_search')
    expect(body.max_tool_calls).toBe(5)
  })

  it('injectProviderTools 对无 tools 的请求体也生效，对非 JSON 原样返回', () => {
    const cap = build({ ...base, searchProvider: 'openrouter', fetchProvider: 'openrouter' })
    expect(JSON.parse(injectProviderTools('{"model":"m"}', cap)).tools).toHaveLength(2)
    expect(injectProviderTools('not json', cap)).toBe('not json')
  })
})

describe('buildWebCapability · tavily', () => {
  afterEach(() => vi.unstubAllGlobals())
  const cfg: WebToolsConfig = { ...base, searchProvider: 'tavily', fetchProvider: 'tavily', tavilyApiKey: 'tk' }

  it('产出本地 web_search / web_fetch，无 server tool 声明', () => {
    const cap = build(cfg)
    expect(cap.providerTools).toHaveLength(0)
    expect(cap.registryTools.map((t) => t.name)).toEqual(['web_search', 'web_fetch'])
  })

  it('web_search 调用 Tavily API 并裁剪结果字段，条数受部署上限约束', async () => {
    const mock = vi.fn(async () =>
      jsonRes({ answer: 'A', results: [{ title: 'T', url: 'https://e.com', content: 'C', score: 0.9, extra: 'x' }] }),
    )
    vi.stubGlobal('fetch', mock)
    const search = build(cfg).registryTools[0]!
    const r: any = await search.handler({ query: 'q', maxResults: 10 }, {} as never)
    expect(r).toEqual({ answer: 'A', results: [{ title: 'T', url: 'https://e.com', snippet: 'C' }] })
    const sent = JSON.parse((mock.mock.calls[0] as any)[1].body)
    expect(sent.max_results).toBe(3) // min(请求 10, 部署上限 3)
    expect((mock.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer tk')
  })

  it('web_fetch 失败时抛错（适配层会转成 { error } 结果）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonRes({ results: [], failed_results: [{ url: 'u', error: 'blocked' }] })),
    )
    const fetchTool = build(cfg).registryTools[1]!
    await expect(fetchTool.handler({ url: 'https://e.com/x' }, {} as never)).rejects.toThrow('blocked')
  })
})

describe('buildWebCapability · exa', () => {
  afterEach(() => vi.unstubAllGlobals())
  const cfg: WebToolsConfig = { ...base, searchProvider: 'exa', fetchProvider: 'exa', exaApiKey: 'ek' }

  it('web_search 打 /search，用 x-api-key 鉴权，条数受部署上限约束', async () => {
    const mock = vi.fn(async () =>
      jsonRes({
        requestId: 'r1',
        results: [{ title: 'T', url: 'https://e.com', text: 'BODY', publishedDate: '2026-01-01', id: 'x' }],
        costDollars: { total: 0.001 },
      }),
    )
    vi.stubGlobal('fetch', mock)
    const search = build(cfg).registryTools[0]!
    const r: any = await search.handler({ query: 'q', maxResults: 10 }, {} as never)
    expect(r.results).toEqual([
      { title: 'T', url: 'https://e.com', snippet: 'BODY', publishedDate: '2026-01-01' },
    ])
    const [url, init] = mock.mock.calls[0] as any
    expect(url).toBe('https://api.exa.ai/search')
    expect(init.headers['x-api-key']).toBe('ek')
    const sent = JSON.parse(init.body)
    expect(sent.numResults).toBe(3) // min(请求 10, 部署上限 3)
    expect(sent.contents.text).toBeTruthy()
  })

  it('web_search 缺 title 时回落成 URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ results: [{ url: 'https://e.com/a', text: 'B' }] })))
    const r: any = await build(cfg).registryTools[0]!.handler({ query: 'q' }, {} as never)
    expect(r.results[0].title).toBe('https://e.com/a')
  })

  it('web_fetch 打 /contents 并返回正文', async () => {
    const mock = vi.fn(async () =>
      jsonRes({ results: [{ url: 'https://e.com/x', title: 'T', text: 'CONTENT' }], statuses: [{ status: 'success' }] }),
    )
    vi.stubGlobal('fetch', mock)
    const r: any = await build(cfg).registryTools[1]!.handler({ url: 'https://e.com/x' }, {} as never)
    expect(r).toEqual({ url: 'https://e.com/x', content: 'CONTENT' })
    const [url, init] = mock.mock.calls[0] as any
    expect(url).toBe('https://api.exa.ai/contents')
    expect(JSON.parse(init.body)).toMatchObject({ urls: ['https://e.com/x'], text: true })
  })

  it('web_fetch 抓不到内容时抛错并带上 Exa 的原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonRes({ results: [], statuses: [{ status: 'error', error: { tag: 'CRAWL_NOT_FOUND' } }] })),
    )
    await expect(build(cfg).registryTools[1]!.handler({ url: 'https://e.com/x' }, {} as never)).rejects.toThrow(
      'CRAWL_NOT_FOUND',
    )
  })

  it('HTTP 非 2xx 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(build(cfg).registryTools[0]!.handler({ query: 'q' }, {} as never)).rejects.toThrow('401')
  })
})
