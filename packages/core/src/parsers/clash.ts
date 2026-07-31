import * as yaml from 'js-yaml'
import { makeNode, type Network, type ProxyNode, type ProxyType, type TlsOptions, type Transport } from '../model.js'

const SUPPORTED: ReadonlySet<string> = new Set([
  'vmess',
  'vless',
  'trojan',
  'ss',
  'ssr',
  'hysteria',
  'hysteria2',
  'tuic',
  'socks5',
  'http',
  'snell',
  'anytls',
])

/**
 * 解析 Clash/Mihomo YAML 订阅：取顶层 `proxies:` 列表，逐个转为统一节点。
 * 不是 Clash YAML、或没有 proxies 时返回 []。
 */
export function parseClashYaml(raw: string): ProxyNode[] {
  let doc: unknown
  try {
    doc = yaml.load(raw)
  } catch {
    return []
  }
  if (!doc || typeof doc !== 'object') return []
  const proxies = (doc as Record<string, unknown>).proxies
  if (!Array.isArray(proxies)) return []

  const nodes: ProxyNode[] = []
  for (const p of proxies) {
    const node = clashProxyToNode(p as Record<string, unknown>)
    if (node) nodes.push(node)
  }
  return nodes
}

/** 这些协议本身就基于 TLS，配置里通常不写 `tls: true`。 */
const TLS_NATIVE: ReadonlySet<string> = new Set(['trojan', 'hysteria', 'hysteria2', 'tuic', 'anytls'])

function numOrUndefined(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** 单个 Clash proxy 对象 → ProxyNode，不支持的类型返回 null。 */
export function clashProxyToNode(p: Record<string, unknown>): ProxyNode | null {
  const type = String(p.type ?? '')
  if (!SUPPORTED.has(type)) return null
  const server = p.server != null ? String(p.server) : ''
  const port = Number(p.port)
  const name = p.name != null ? String(p.name) : `${server}:${port}`
  if (!server || !port) return null

  const str = (k: string) => (p[k] == null ? undefined : String(p[k]))
  const bool = (k: string) => p[k] === true || p[k] === 'true'

  const node = makeNode({ name, type: type as ProxyType, server, port })
  if (p.udp !== undefined) node.udp = !!p.udp

  switch (type) {
    case 'vmess':
      node.uuid = str('uuid')
      node.alterId = p.alterId != null ? Number(p.alterId) : 0
      node.cipher = str('cipher') || 'auto'
      break
    case 'vless':
      node.uuid = str('uuid')
      node.flow = str('flow')
      break
    case 'trojan':
      node.password = str('password')
      break
    case 'ss': {
      node.cipher = str('cipher')
      node.password = str('password')
      node.plugin = str('plugin')
      const opts = p['plugin-opts'] as Record<string, unknown> | undefined
      if (opts) {
        node.pluginOpts = Object.fromEntries(
          Object.entries(opts).map(([k, v]) => [k, String(v)]),
        )
        node.obfs = opts.mode != null ? String(opts.mode) : undefined
        node.obfsHost = opts.host != null ? String(opts.host) : undefined
      }
      break
    }
    case 'ssr':
      node.cipher = str('cipher')
      node.password = str('password')
      node.protocol = str('protocol')
      node.protocolParam = str('protocol-param')
      node.obfs = str('obfs')
      node.obfsParam = str('obfs-param')
      break
    case 'hysteria':
      node.password = str('auth-str') || str('auth_str') || str('password')
      node.protocol = str('protocol')
      node.obfs = str('obfs')
      node.obfsParam = str('obfs-param')
      node.upMbps = numOrUndefined(p.up)
      node.downMbps = numOrUndefined(p.down)
      node.ports = str('ports')
      break
    case 'hysteria2':
      node.password = str('password')
      node.obfs = str('obfs')
      node.obfsPassword = str('obfs-password')
      node.ports = str('ports')
      break
    case 'tuic':
      node.uuid = str('uuid')
      node.password = str('password')
      node.congestion = str('congestion-controller')
      node.protocol = str('udp-relay-mode')
      break
    case 'socks5':
    case 'http':
      node.username = str('username')
      node.password = str('password')
      break
    case 'snell': {
      node.password = str('psk')
      node.version = numOrUndefined(p.version)
      const obfsOpts = p['obfs-opts'] as Record<string, unknown> | undefined
      if (obfsOpts) {
        node.obfs = obfsOpts.mode != null ? String(obfsOpts.mode) : undefined
        node.obfsHost = obfsOpts.host != null ? String(obfsOpts.host) : undefined
      }
      break
    }
    case 'anytls':
      node.password = str('password')
      break
  }

  // TLS：vmess 用 tls:true + servername；vless/trojan 常直接给 sni/servername
  const reality = p['reality-opts'] as Record<string, unknown> | undefined
  // trojan / hysteria / tuic / anytls 天然跑在 TLS 上，配置里往往省略 tls: true
  const alwaysTls = TLS_NATIVE.has(type)
  const tlsEnabled = bool('tls') || alwaysTls || !!reality || !!p.sni || !!p.servername
  if (tlsEnabled) {
    const tls: TlsOptions = { enabled: true }
    tls.sni = str('sni') || str('servername')
    const alpn = p.alpn
    if (Array.isArray(alpn)) tls.alpn = alpn.map(String)
    if (bool('skip-cert-verify')) tls.skipCertVerify = true
    if (p['client-fingerprint']) tls.fingerprint = str('client-fingerprint')
    if (reality) {
      tls.realityPublicKey = reality['public-key'] != null ? String(reality['public-key']) : undefined
      tls.realityShortId = reality['short-id'] != null ? String(reality['short-id']) : undefined
    }
    node.tls = tls
  }

  // 传输层
  const network = str('network') as Network | undefined
  if (network && network !== 'tcp') {
    const t: Transport = { network }
    const ws = p['ws-opts'] as Record<string, unknown> | undefined
    const grpc = p['grpc-opts'] as Record<string, unknown> | undefined
    const h2 = p['h2-opts'] as Record<string, unknown> | undefined
    if (network === 'ws' && ws) {
      t.path = ws.path != null ? String(ws.path) : undefined
      const headers = ws.headers as Record<string, unknown> | undefined
      if (headers && headers.Host != null) t.host = String(headers.Host)
    } else if (network === 'grpc' && grpc) {
      t.serviceName = grpc['grpc-service-name'] != null ? String(grpc['grpc-service-name']) : undefined
    } else if ((network === 'h2' || network === 'http') && h2) {
      t.path = h2.path != null ? String(h2.path) : undefined
      const host = h2.host
      if (Array.isArray(host) && host.length) t.host = String(host[0])
    }
    node.transport = t
  }

  return node
}
