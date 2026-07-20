import type { AgentModelConfig } from './agent/index.js'

export interface ServerConfig {
  port: number
  dbPath: string
  /** 管理接口口令（Bearer / X-Admin-Token），为空表示不鉴权（仅本地自用时） */
  adminToken?: string
  /** 前端静态资源目录（生产环境由后端托管） */
  webDir?: string
  agent?: AgentModelConfig
}

export function getConfig(): ServerConfig {
  const env = process.env
  const agent: AgentModelConfig | undefined =
    env.OPENAI_BASE_URL && env.OPENAI_API_KEY && env.OPENAI_MODEL
      ? { baseURL: env.OPENAI_BASE_URL, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }
      : undefined
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.DB_PATH ?? './data/subforge.sqlite',
    adminToken: env.ADMIN_TOKEN || undefined,
    webDir: env.WEB_DIR || undefined,
    agent,
  }
}
