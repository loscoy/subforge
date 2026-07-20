import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildTools, type ToolContext } from '../tools/registry.js'

/**
 * 把框架无关的工具 registry 包成 MCP server。
 * 与内嵌 agent 共享同一批工具定义（零重复）。
 */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'subforge', version: '0.1.0' })

  for (const t of buildTools()) {
    server.tool(t.name, t.description, (t.schema as any).shape ?? {}, async (args: unknown) => {
      try {
        const result = await t.handler(args as never, ctx)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `错误: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        }
      }
    })
  }
  return server
}
