/**
 * 引导配置：只管「怎么把服务跑起来」，全部来自环境变量，启动后不变。
 *
 * 「服务跑起来之后干什么」——用哪个模型、联不联网、远端 MCP 开不开——
 * 属于运行时设置，存数据库、由 Web 设置页维护，见 settings.ts。
 * 那部分不再读环境变量（OPENAI_* / MCP_TOKEN / AGENT_WEB_* 已废弃）。
 */
export interface ServerConfig {
  port: number
  dbPath: string
  /** 管理接口口令（Bearer / X-Admin-Token），为空表示不鉴权（仅本地自用时） */
  adminToken?: string
  /** 未设 adminToken 时是否允许无鉴权提供管理接口。默认 false（失败关闭），需显式开启。 */
  allowNoAuth?: boolean
  /** 加密数据库里密钥字段的主密钥。未设则密钥无法存取，Agent 与远端 MCP 失败关闭。 */
  settingsKey?: string
  /** 前端静态资源目录（生产环境由后端托管） */
  webDir?: string
}

export function getConfig(): ServerConfig {
  const env = process.env
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.DB_PATH ?? './data/subforge.sqlite',
    adminToken: env.ADMIN_TOKEN || undefined,
    allowNoAuth: env.SUBFORGE_ALLOW_NO_AUTH === '1',
    settingsKey: env.SETTINGS_KEY || undefined,
    webDir: env.WEB_DIR || undefined,
  }
}
