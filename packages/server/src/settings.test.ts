import { describe, expect, it } from 'vitest'
import {
  loadSettings,
  saveSettings,
  settingsPatchSchema,
  SettingsKeyMissingError,
  toAgentConfig,
  toSettingsView,
  toWebToolsConfig,
} from './settings.js'
import { InMemoryStorage } from './storage/index.js'

const KEY = 'master-key'
const fresh = () => new InMemoryStorage()

describe('settings · 读写与三态合并', () => {
  it('空库返回默认值', async () => {
    const s = await loadSettings(fresh(), KEY)
    expect(s.agent).toEqual({ baseURL: undefined, model: undefined, apiKey: undefined })
    expect(s.web).toMatchObject({
      searchProvider: undefined,
      fetchProvider: undefined,
      searchEngine: 'auto',
      fetchEngine: 'auto',
      maxToolCalls: 5,
      maxResults: 5,
    })
    expect(s.mcpToken).toBeUndefined()
  })

  it('密钥字段：缺席不变、字符串覆盖、null 清除', async () => {
    const storage = fresh()
    await saveSettings(storage, KEY, { agent: { baseURL: 'https://a/v1', model: 'm', apiKey: 'sk-1' } })
    expect((await loadSettings(storage, KEY)).agent.apiKey).toBe('sk-1')

    // 只改 model，不带 apiKey → 密钥保持
    await saveSettings(storage, KEY, { agent: { model: 'm2' } })
    const kept = await loadSettings(storage, KEY)
    expect(kept.agent.model).toBe('m2')
    expect(kept.agent.apiKey).toBe('sk-1')

    await saveSettings(storage, KEY, { agent: { apiKey: 'sk-2' } })
    expect((await loadSettings(storage, KEY)).agent.apiKey).toBe('sk-2')

    await saveSettings(storage, KEY, { agent: { apiKey: null } })
    expect((await loadSettings(storage, KEY)).agent.apiKey).toBeUndefined()
  })

  it('密钥在库里是密文，明文不落盘', async () => {
    const storage = fresh()
    await saveSettings(storage, KEY, { mcpToken: 'mcp-plain' })
    const raw = await storage.getSettings()
    expect(raw).toBeDefined()
    expect(raw).not.toContain('mcp-plain')
    expect(raw).toContain('enc:v1:')
  })

  it('没有主密钥时拒绝保存密钥，非密钥项不受影响', async () => {
    const storage = fresh()
    await expect(saveSettings(storage, undefined, { mcpToken: 'x' })).rejects.toThrow(SettingsKeyMissingError)
    await saveSettings(storage, undefined, { agent: { model: 'm' } })
    expect((await loadSettings(storage, undefined)).agent.model).toBe('m')
  })

  it('主密钥换过之后旧密钥解不开，按未配置处理', async () => {
    const storage = fresh()
    await saveSettings(storage, KEY, { mcpToken: 'mcp-plain' })
    expect((await loadSettings(storage, 'another')).mcpToken).toBeUndefined()
  })

  it('JSON 损坏时回落空设置而不是抛错', async () => {
    const storage = fresh()
    await storage.setSettings('{not json')
    await expect(loadSettings(storage, KEY)).resolves.toMatchObject({ mcpToken: undefined })
  })

  it('provider 传 null 表示关掉那个能力，两个能力互不影响', async () => {
    const storage = fresh()
    await saveSettings(storage, KEY, { web: { searchProvider: 'openrouter', fetchProvider: 'exa' } })
    let web = (await loadSettings(storage, KEY)).web
    expect([web.searchProvider, web.fetchProvider]).toEqual(['openrouter', 'exa'])

    await saveSettings(storage, KEY, { web: { fetchProvider: null } })
    web = (await loadSettings(storage, KEY)).web
    expect(web.searchProvider).toBe('openrouter') // 没动它就不该变
    expect(web.fetchProvider).toBeUndefined()
  })

  it('旧结构的单一 provider 读取时铺开到两个能力', async () => {
    const storage = fresh()
    // 直接写入旧格式，模拟升级前存下的设置
    await storage.setSettings(JSON.stringify({ web: { provider: 'tavily', maxResults: 7 } }))
    const web = (await loadSettings(storage, KEY)).web
    expect([web.searchProvider, web.fetchProvider]).toEqual(['tavily', 'tavily'])
    expect(web.maxResults).toBe(7)

    // 保存后写回新结构，旧字段不再留存
    await saveSettings(storage, KEY, { web: { searchProvider: 'exa' } })
    const raw = JSON.parse((await storage.getSettings())!)
    expect(raw.web.provider).toBeUndefined()
    expect([raw.web.searchProvider, raw.web.fetchProvider]).toEqual(['exa', 'tavily'])
  })
})

describe('settings · 回传前端的形态', () => {
  it('只给配没配与掩码，绝不回明文', async () => {
    const storage = fresh()
    await saveSettings(storage, KEY, { agent: { apiKey: 'sk-abcdefghijkl' }, mcpToken: 'mcp-plain-token' })
    const view = toSettingsView(await loadSettings(storage, KEY), true)
    expect(view.agent.apiKey).toEqual({ configured: true, hint: 'sk-…ijkl' })
    expect(view.web.tavilyApiKey).toEqual({ configured: false })
    expect(JSON.stringify(view)).not.toContain('sk-abcdefghijkl')
    expect(JSON.stringify(view)).not.toContain('mcp-plain-token')
  })
})

describe('settings · 派生配置', () => {
  it('模型三件套缺一不可', async () => {
    const storage = fresh()
    await saveSettings(storage, KEY, { agent: { baseURL: 'https://a/v1', model: 'm' } })
    expect(toAgentConfig(await loadSettings(storage, KEY))).toBeUndefined()
    await saveSettings(storage, KEY, { agent: { apiKey: 'sk-1' } })
    expect(toAgentConfig(await loadSettings(storage, KEY))).toMatchObject({ baseURL: 'https://a/v1', model: 'm', apiKey: 'sk-1' })
  })

  it('联网工具：两个能力都没选供应商才算不启用', async () => {
    const storage = fresh()
    expect(toWebToolsConfig(await loadSettings(storage, KEY))).toBeUndefined()

    await saveSettings(storage, KEY, { web: { searchProvider: 'tavily', tavilyApiKey: 'tk' } })
    expect(toWebToolsConfig(await loadSettings(storage, KEY))).toMatchObject({
      searchProvider: 'tavily',
      fetchProvider: undefined,
      tavilyApiKey: 'tk',
    })
  })

  it('两个供应商的 key 各存各的，互不覆盖', async () => {
    const storage = fresh()
    await saveSettings(storage, KEY, {
      web: { searchProvider: 'exa', fetchProvider: 'tavily', exaApiKey: 'ek', tavilyApiKey: 'tk' },
    })
    const cfg = toWebToolsConfig(await loadSettings(storage, KEY))!
    expect(cfg).toMatchObject({ searchProvider: 'exa', fetchProvider: 'tavily', exaApiKey: 'ek', tavilyApiKey: 'tk' })

    // 只清 exa 的 key，tavily 的不受影响
    await saveSettings(storage, KEY, { web: { exaApiKey: null } })
    const after = toWebToolsConfig(await loadSettings(storage, KEY))!
    expect(after.exaApiKey).toBeUndefined()
    expect(after.tavilyApiKey).toBe('tk')
  })
})

describe('settings · 入参校验', () => {
  it('引擎名走白名单，perplexity 不能用于抓取', () => {
    expect(settingsPatchSchema.safeParse({ web: { searchEngine: 'perplexity' } }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ web: { fetchEngine: 'perplexity' } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ web: { searchEngine: 'bing' } }).success).toBe(false)
  })

  it('上限钳制在 1–25', () => {
    expect(settingsPatchSchema.safeParse({ web: { maxResults: 0 } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ web: { maxResults: 26 } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ web: { maxResults: 10 } }).success).toBe(true)
  })

  it('密钥接受字符串或 null，不接受空串', () => {
    expect(settingsPatchSchema.safeParse({ mcpToken: null }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ mcpToken: 'x' }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ mcpToken: '' }).success).toBe(false)
  })
})
