import type { AgentModelConfig } from './agent/index.js'
import { parseWebToolsEnv } from './agent/webTools.js'

export interface ServerConfig {
  port: number
  dbPath: string
  /** 管理接口口令（Bearer / X-Admin-Token），为空表示不鉴权（仅本地自用时） */
  adminToken?: string
  /** 未设 adminToken 时是否允许无鉴权提供管理接口。默认 false（失败关闭），需显式开启。 */
  allowNoAuth?: boolean
  /** 远端 MCP 的 Bearer token。未配置时远端 MCP 失败关闭。 */
  mcpToken?: string
  /** 前端静态资源目录（生产环境由后端托管） */
  webDir?: string
  agent?: AgentModelConfig
}

export function getConfig(): ServerConfig {
  const env = process.env
  const agent: AgentModelConfig | undefined =
    env.OPENAI_BASE_URL && env.OPENAI_API_KEY && env.OPENAI_MODEL
      ? {
          baseURL: env.OPENAI_BASE_URL,
          apiKey: env.OPENAI_API_KEY,
          model: env.OPENAI_MODEL,
          webTools: parseWebToolsEnv(env),
        }
      : undefined
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.DB_PATH ?? './data/subforge.sqlite',
    adminToken: env.ADMIN_TOKEN || undefined,
    allowNoAuth: env.SUBFORGE_ALLOW_NO_AUTH === '1',
    mcpToken: env.MCP_TOKEN || undefined,
    webDir: env.WEB_DIR || undefined,
    agent,
  }
}
