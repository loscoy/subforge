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
    expect(s.web).toMatchObject({ provider: undefined, searchEngine: 'auto', fetchEngine: 'auto', maxToolCalls: 5, maxResults: 5 })
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

  it('provider 传 null 表示关闭联网', async () => {
    const storage = fresh()
    await saveSettings(storage, KEY, { web: { provider: 'openrouter' } })
    expect((await loadSettings(storage, KEY)).web.provider).toBe('openrouter')
    await saveSettings(storage, KEY, { web: { provider: null } })
    expect((await loadSettings(storage, KEY)).web.provider).toBeUndefined()
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

  it('联网工具：未选 provider 不启用；tavily 缺 key 失败关闭', async () => {
    const storage = fresh()
    expect(toWebToolsConfig(await loadSettings(storage, KEY))).toBeUndefined()

    await saveSettings(storage, KEY, { web: { provider: 'tavily' } })
    expect(toWebToolsConfig(await loadSettings(storage, KEY))).toBeUndefined()

    await saveSettings(storage, KEY, { web: { tavilyApiKey: 'tk' } })
    expect(toWebToolsConfig(await loadSettings(storage, KEY))).toMatchObject({ provider: 'tavily', apiKey: 'tk' })
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
