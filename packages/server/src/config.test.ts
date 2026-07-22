import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from './config.js'

describe('server config', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('从 MCP_TOKEN 启用远端 MCP', () => {
    vi.stubEnv('MCP_TOKEN', 'remote-secret')
    expect(getConfig().mcpToken).toBe('remote-secret')
  })

  it('空 MCP_TOKEN 保持远端 MCP 禁用', () => {
    vi.stubEnv('MCP_TOKEN', '')
    expect(getConfig().mcpToken).toBeUndefined()
  })
})
