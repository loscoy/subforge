import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { ToolContext } from '../tools/registry.js'
import { createMcpServer } from './server.js'

/** 处理一次无状态 Streamable HTTP MCP 请求，可同时运行在 Node 与 Workers。 */
export async function handleMcpHttpRequest(request: Request, ctx: ToolContext): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  const server = createMcpServer(ctx)
  await server.connect(transport)
  return transport.handleRequest(request)
}
