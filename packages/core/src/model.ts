/**
 * 统一节点模型（Intermediate Representation）。
 *
 * 所有协议 URI / 订阅先解析成 `ProxyNode`，所有输出格式再从 `ProxyNode` 渲染。
 * 这样「解析器」和「渲染器」互相解耦，加协议 = 加一个 parser，加输出格式 = 加一个 renderer。
 */

export type ProxyType =
  | 'vmess'
  | 'vless'
  | 'trojan'
  | 'ss'
  | 'ssr'
  | 'hysteria'
  | 'hysteria2'
  | 'tuic'
  | 'socks5'
  | 'http'
  | 'snell'
  | 'anytls'

export type Network = 'tcp' | 'ws' | 'grpc' | 'http' | 'h2' | 'httpupgrade'

/** 传输层（ws/grpc/http）相关配置，各协议共用。 */
export interface Transport {
  network?: Network
  /** ws / http 路径 */
  path?: string
  /** ws / http Host 头 */
  host?: string
  /** grpc serviceName */
  serviceName?: string
  /** 额外 ws headers */
  wsHeaders?: Record<string, string>
}

/** TLS / Reality 相关配置。 */
export interface TlsOptions {
  enabled: boolean
  /** SNI / servername */
  sni?: string
  alpn?: string[]
  /** 跳过证书校验 */
  skipCertVerify?: boolean
  fingerprint?: string
  /** Reality public key（vless reality） */
  realityPublicKey?: string
  /** Reality short id */
  realityShortId?: string
}

/** 节点元数据，供分组/打标签使用（地区、倍率等）。 */
export interface NodeMeta {
  /** ISO 3166 区域码或自定义区域标签，如 'HK' 'US' */
  region?: string
  emoji?: string
  /** 倍率，如 1、2、0.5 */
  multiplier?: number
  /** 任意自定义标签 */
  tags?: string[]
  /** 来源订阅 id */
  source?: string
}

/** 统一代理节点。 */
export interface ProxyNode {
  /** 展示名称，输出配置里的 proxy name，必须在一份配置内唯一 */
  name: string
  type: ProxyType
  server: string
  port: number

  /** 认证凭据：vmess/vless 用 uuid；trojan/ss 用 password */
  uuid?: string
  password?: string
  /** socks5 / http 的认证用户名 */
  username?: string

  /** vmess alterId */
  alterId?: number
  /** vmess/vless cipher / encryption；ss / ssr 为加密方式 */
  cipher?: string
  /** vless flow，如 xtls-rprx-vision */
  flow?: string

  /** hysteria2 / snell / ssr 的混淆方式；ssr 为 obfs 插件名 */
  obfs?: string
  obfsPassword?: string
  /** ssr obfsparam；hysteria v1 的 obfs 字符串 */
  obfsParam?: string
  /** snell obfs host；ss obfs 插件的 obfs-host */
  obfsHost?: string
  /** ssr protocol 插件；hysteria v1 的传输协议（udp / wechat-video / faketcp） */
  protocol?: string
  /** ssr protoparam */
  protocolParam?: string
  /** tuic congestion controller */
  congestion?: string
  /** snell 版本（1/2/3/4） */
  version?: number
  /** hysteria v1 带宽（Mbps） */
  upMbps?: number
  downMbps?: number
  /** hysteria / hysteria2 端口跳跃，如 "443,8000-9000"；为空表示只用 port */
  ports?: string

  /** ss SIP002 plugin（obfs / v2ray-plugin / shadow-tls …）及其参数 */
  plugin?: string
  pluginOpts?: Record<string, string>

  udp?: boolean
  tls?: TlsOptions
  transport?: Transport

  meta: NodeMeta

  /** 无法归一化、但渲染时想透传的原始字段 */
  extra?: Record<string, unknown>
}

/** 创建一个带默认值的节点（parser 内部用，避免每次写全字段）。 */
export function makeNode(partial: Partial<ProxyNode> & Pick<ProxyNode, 'name' | 'type' | 'server' | 'port'>): ProxyNode {
  return {
    udp: true,
    meta: {},
    ...partial,
  }
}
