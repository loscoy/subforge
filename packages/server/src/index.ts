import { serveStatic } from '@hono/node-server/serve-static'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { AiSdkAgentRunner } from './agent/index.js'
import { isLoopbackAddress } from './auth.js'
import { getConfig } from './config.js'
import { checkNodes } from './health.js'
import { createApp } from './routes/app.js'
import { QuickJsRunner } from './sandbox/quickjs.js'
import { SqliteStorage } from './storage/index.js'

function main() {
  const config = getConfig()

  // 确保 db 目录存在
  const dir = dirname(config.dbPath)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })

  const storage = new SqliteStorage(config.dbPath)
  const runner = new QuickJsRunner()

  const app = createApp({
    storage,
    runner,
    config,
    checkNodes,
    // 模型配置来自数据库设置，按请求传入；这里只提供「怎么造 runner」。
    makeAgent: (model) => new AiSdkAgentRunner({ storage, runner, checkNodes }, model),
    runtimeInfo: { runtime: 'node', storage: 'sqlite', sandbox: 'quickjs-wasm' },
    getClientIp: nodeClientIp,
  })

  // 生产环境托管前端静态资源
  if (config.webDir && existsSync(config.webDir)) {
    app.use('/*', serveStatic({ root: config.webDir }))
    app.get('/*', serveStatic({ path: `${config.webDir}/index.html` }))
  }

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`SubForge server listening on http://localhost:${info.port}`)
    console.log(`  分享出口: http://localhost:${info.port}/sub/:token`)
    console.log('  Agent / 远端 MCP / 联网工具: 在 Web「设置」页配置（存数据库，改完即时生效）')
    if (!config.settingsKey) console.warn('  ⚠ 未设 SETTINGS_KEY：密钥无法存取，Agent 与远端 MCP 将保持关闭')
    if (config.allowNoAuth) console.warn('  鉴权: ⚠ 无鉴权模式（SUBFORGE_ALLOW_NO_AUTH=1），切勿暴露到公网')
    else console.log('  鉴权: 账号登录（未建号时采用首次访问即建号）')
  })
}

function nodeClientIp(c: Context): string | undefined {
  const direct = getConnInfo(c).remote.address
  if (!isLoopbackAddress(direct)) return direct
  // 只在请求确实来自本机反代时信任转发头；公网直连无法伪造登录限流的 IP 维度。
  const forwarded = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]
  return forwarded?.trim() || direct
}

main()
