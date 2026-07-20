import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { checkNodes } from '../health.js'
import { NodeVmRunner } from '../sandbox/nodeVm.js'
import { SqliteStorage } from '../storage/index.js'
import { createMcpServer } from './server.js'
import { getConfig } from '../config.js'

/**
 * 以 stdio 方式运行 MCP server —— 供 Claude Code / Claude Desktop 等 MCP 客户端连接，
 * 直接用你自己的 agent 驱动 SubForge。
 *
 * 用法（Claude Code）：把本命令配置为一个 MCP server：
 *   command: node, args: [dist/mcp/stdio.js]
 */
async function main() {
  const cfg = getConfig()
  const storage = new SqliteStorage(cfg.dbPath)
  const runner = new NodeVmRunner()
  const server = createMcpServer({ storage, runner, checkNodes })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // 保持进程存活由 stdio transport 负责
}

main().catch((e) => {
  console.error('MCP server 启动失败:', e)
  process.exit(1)
})
