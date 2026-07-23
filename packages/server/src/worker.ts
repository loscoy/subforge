import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import releaseSyncVariant from '@jitl/quickjs-wasmfile-release-sync'
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core'
import { AiSdkAgentRunner } from './agent/aiSdk.js'
import type { ServerConfig } from './config.js'
import { createApp } from './routes/app.js'
import { QuickJsRunner } from './sandbox/quickjs.js'
import { D1Storage } from './storage/d1.js'
// vendored 到 worker 包内（prebuild 从 node_modules 拷贝）——保证在 worker root 内，
// 让 wrangler 以 CompiledWasm 模块加载；再经 newVariant 注入，避免运行时字节编译。
import quickjsWasm from './quickjs.wasm'

/** 边缘 QuickJS 模块 provider：用编译期 import 的 WebAssembly.Module。 */
const edgeQuickJs = () =>
  newQuickJSWASMModuleFromVariant(newVariant(releaseSyncVariant, { wasmModule: quickjsWasm as never }))

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
  SUBFORGE_ALLOW_NO_AUTH?: string
  /** 加密数据库里密钥字段的主密钥；未设则 Agent 与远端 MCP 失败关闭 */
  SETTINGS_KEY?: string
}

// 模块作用域：同一 isolate 内跨请求复用，QuickJS WASM 模块只实例化一次（首个请求后显著变快）。
// 只依赖 edgeQuickJs（无 env），可安全提升；storage 依赖 env.DB 故仍按请求创建。
const runner = new QuickJsRunner(edgeQuickJs)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const storage = new D1Storage(env.DB)

    const config: ServerConfig = {
      port: 0,
      dbPath: '',
      adminToken: env.ADMIN_TOKEN || undefined,
      allowNoAuth: env.SUBFORGE_ALLOW_NO_AUTH === '1',
      settingsKey: env.SETTINGS_KEY || undefined,
    }

    const app = createApp({
      storage,
      runner,
      config,
      // 边缘无测活能力；模型配置来自数据库设置，按请求传入
      makeAgent: (model) => new AiSdkAgentRunner({ storage, runner }, model),
      runtimeInfo: { runtime: 'workers', storage: 'd1', sandbox: 'quickjs' },
    })

    return app.fetch(request as unknown as Request)
  },
}
