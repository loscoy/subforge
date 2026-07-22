import { describe, expect, it } from 'vitest'
import { buildMcpExamples, resolveMcpEndpoint } from './mcp'

describe('MCP client configuration', () => {
  it('基于当前站点生成远端端点', () => {
    expect(resolveMcpEndpoint('https://subforge.example.com', '/mcp')).toBe('https://subforge.example.com/mcp')
  })

  it('生成不包含真实凭据的 Claude Code 与通用配置', () => {
    const examples = buildMcpExamples('https://subforge.example.com/mcp')

    expect(examples.claudeCode).toContain('claude mcp add --transport http subforge')
    expect(examples.claudeCode).toContain('Authorization: Bearer <MCP_TOKEN>')
    expect(examples.codex).toContain('export SUBFORGE_MCP_TOKEN="<MCP_TOKEN>"')
    expect(examples.codex).toContain(
      'codex mcp add subforge --url "https://subforge.example.com/mcp" --bearer-token-env-var SUBFORGE_MCP_TOKEN',
    )
    expect(examples.codex).not.toContain('Bearer <MCP_TOKEN>')
    expect(JSON.parse(examples.json).mcpServers.subforge).toEqual({
      type: 'http',
      url: 'https://subforge.example.com/mcp',
      headers: { Authorization: 'Bearer <MCP_TOKEN>' },
    })
  })
})
