/**
 * 供前端 Monaco 编辑器挂载的 ambient 类型声明。
 * 描述用户转换脚本里可直接使用的全局变量（与 ScriptRunner 注入的运行时一致）。
 *
 * 运行时约定：脚本体等价于一个 async 函数体，直接使用下列全局并 `return nodes`。
 */
export const SCRIPT_DTS = `
interface TlsOptions {
  enabled: boolean
  sni?: string
  alpn?: string[]
  skipCertVerify?: boolean
  fingerprint?: string
  realityPublicKey?: string
  realityShortId?: string
}
interface Transport {
  network?: 'tcp' | 'ws' | 'grpc' | 'http' | 'h2'
  path?: string
  host?: string
  serviceName?: string
  wsHeaders?: Record<string, string>
}
interface NodeMeta {
  region?: string
  emoji?: string
  multiplier?: number
  tags?: string[]
  source?: string
}
interface ProxyNode {
  name: string
  type: 'vmess' | 'vless' | 'trojan' | 'ss' | 'hysteria2' | 'tuic'
  server: string
  port: number
  uuid?: string
  password?: string
  alterId?: number
  cipher?: string
  flow?: string
  obfs?: string
  obfsPassword?: string
  congestion?: string
  udp?: boolean
  tls?: TlsOptions
  transport?: Transport
  meta: NodeMeta
  extra?: Record<string, unknown>
}
interface ScriptUtils {
  /** 从节点名推断区域码，如 'HK' 'US'；识别不到返回 undefined */
  regionOf(name: string): string | undefined
  /** 从节点名推断区域 emoji */
  emojiOf(name: string): string | undefined
  /** 从节点名解析倍率 */
  multiplierOf(name: string): number | undefined
  /** 按 server+port+凭据去重 */
  dedupe(nodes: ProxyNode[]): ProxyNode[]
  /** 保留 name 匹配正则的节点 */
  keep(nodes: ProxyNode[], pattern: string | RegExp): ProxyNode[]
  /** 剔除 name 匹配正则的节点 */
  drop(nodes: ProxyNode[], pattern: string | RegExp): ProxyNode[]
  /** 同名节点追加序号，保证唯一 */
  uniquifyNames(nodes: ProxyNode[]): ProxyNode[]
  /** 给节点补 meta.region / meta.emoji */
  tagRegions(nodes: ProxyNode[]): ProxyNode[]
}

/** 当前节点列表（上一步产物）。修改它并 return，或直接 return 新数组。 */
declare const nodes: ProxyNode[]
/** 内置工具集 */
declare const utils: ScriptUtils
/** 受限 console，输出显示在预览面板 */
declare const console: { log(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
/** 调用方参数 */
declare const params: Record<string, string>
`
