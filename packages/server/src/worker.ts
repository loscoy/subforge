import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import { AiSdkAgentRunner } from './agent/aiSdk.js'
import type { ServerConfig } from './config.js'
import { createApp } from './routes/app.js'
import { QuickJsRunner } from './sandbox/quickjs.js'
import { D1Storage } from './storage/d1.js'

/**
 * Cloudflare Workers 入口。
 *
 * 仅导入「边缘可移植」模块：D1Storage（不碰 better-sqlite3）、QuickJsRunner（不碰 node:vm）。
 * 静态前端由 assets 绑定托管；/api/* 与 /sub/* 经 run_worker_first 交给本 Worker。
 * 测活（node:net）在边缘不可用，故不注入 checkNodes（该端点返回 501）。
 */
export interface Env {
  DB: D1Database
  ASSETS?: Fetcher
  ADMIN_TOKEN?: string
  OPENAI_BASE_URL?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const storage = new D1Storage(env.DB)
    const runner = new QuickJsRunner()

    const agent =
      env.OPENAI_BASE_URL && env.OPENAI_API_KEY && env.OPENAI_MODEL
        ? { baseURL: env.OPENAI_BASE_URL, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }
        : undefined

    const config: ServerConfig = {
      port: 0,
      dbPath: '',
      adminToken: env.ADMIN_TOKEN || undefined,
      agent,
    }

    const app = createApp({
      storage,
      runner,
      config,
      // 边缘无测活能力
      makeAgent: agent ? () => new AiSdkAgentRunner({ storage, runner }, agent) : undefined,
    })

    return app.fetch(request as unknown as Request)
  },
}
