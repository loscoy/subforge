import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from './config.js'

describe('server config', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('从 SETTINGS_KEY 读取密钥加密主密钥', () => {
    vi.stubEnv('SETTINGS_KEY', 'master-key')
    expect(getConfig().settingsKey).toBe('master-key')
  })

  it('空 SETTINGS_KEY 视为未配置（密钥失败关闭）', () => {
    vi.stubEnv('SETTINGS_KEY', '')
    expect(getConfig().settingsKey).toBeUndefined()
  })

  it('运行时设置不再从环境变量读取', () => {
    vi.stubEnv('MCP_TOKEN', 'remote-secret')
    vi.stubEnv('OPENAI_BASE_URL', 'https://example.com/v1')
    vi.stubEnv('OPENAI_API_KEY', 'sk-x')
    vi.stubEnv('OPENAI_MODEL', 'gpt-4o')
    vi.stubEnv('AGENT_WEB_TOOLS', 'openrouter')
    // 这些已迁到数据库设置，getConfig 只管引导项
    expect(getConfig()).not.toHaveProperty('mcpToken')
    expect(getConfig()).not.toHaveProperty('agent')
  })
})
