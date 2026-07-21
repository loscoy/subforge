import { serveStatic } from '@hono/node-server/serve-static'
import { serve } from '@hono/node-server'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { AiSdkAgentRunner } from './agent/index.js'
import { getConfig } from './config.js'
import { checkNodes } from './health.js'
import { createApp } from './routes/app.js'
import { NodeVmRunner } from './sandbox/nodeVm.js'
import { SqliteStorage } from './storage/index.js'

function main() {
  const config = getConfig()

  // 确保 db 目录存在
  const dir = dirname(config.dbPath)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })

  const storage = new SqliteStorage(config.dbPath)
  const runner = new NodeVmRunner()

  const app = createApp({
    storage,
    runner,
    config,
    checkNodes,
    makeAgent: config.agent
      ? () => new AiSdkAgentRunner({ storage, runner, checkNodes }, config.agent!)
      : undefined,
  })

  // 生产环境托管前端静态资源
  if (config.webDir && existsSync(config.webDir)) {
    app.use('/*', serveStatic({ root: config.webDir }))
    app.get('/*', serveStatic({ path: `${config.webDir}/index.html` }))
  }

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`SubForge server listening on http://localhost:${info.port}`)
    console.log(`  分享出口: http://localhost:${info.port}/sub/:token`)
    console.log(`  Agent: ${config.agent ? '已启用' : '未配置（设 OPENAI_BASE_URL/API_KEY/MODEL 开启）'}`)
    if (config.adminToken) console.log('  鉴权: 已启用 ADMIN_TOKEN')
    else if (config.allowNoAuth) console.warn('  鉴权: ⚠ 无鉴权模式（SUBFORGE_ALLOW_NO_AUTH=1），切勿暴露到公网')
    else console.warn('  鉴权: 管理接口已锁定（未设 ADMIN_TOKEN）。设 ADMIN_TOKEN 开启，或 SUBFORGE_ALLOW_NO_AUTH=1 显式无鉴权')
  })
}

main()
