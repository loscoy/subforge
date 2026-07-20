import type { ProxyGroupDef, RenderContext } from '../config.js'
import type { ProxyNode } from '../model.js'
import { resolveGroupMembers } from './mihomo.js'

/** 统一节点 → sing-box outbound 对象。 */
export function nodeToSingbox(n: ProxyNode): Record<string, unknown> {
  const o: Record<string, unknown> = { tag: n.name, server: n.server, server_port: n.port }
  switch (n.type) {
    case 'vmess':
      o.type = 'vmess'
      o.uuid = n.uuid
      o.alter_id = n.alterId ?? 0
      o.security = n.cipher || 'auto'
      break
    case 'vless':
      o.type = 'vless'
      o.uuid = n.uuid
      if (n.flow) o.flow = n.flow
      break
    case 'trojan':
      o.type = 'trojan'
      o.password = n.password
      break
    case 'ss':
      o.type = 'shadowsocks'
      o.method = n.cipher
      o.password = n.password
      break
    case 'hysteria2':
      o.type = 'hysteria2'
      o.password = n.password
      if (n.obfs) o.obfs = { type: n.obfs, ...(n.obfsPassword ? { password: n.obfsPassword } : {}) }
      break
    case 'tuic':
      o.type = 'tuic'
      o.uuid = n.uuid
      o.password = n.password
      if (n.congestion) o.congestion_control = n.congestion
      break
  }

  if (n.tls?.enabled) {
    const tls: Record<string, unknown> = { enabled: true }
    if (n.tls.sni) tls.server_name = n.tls.sni
    if (n.tls.alpn) tls.alpn = n.tls.alpn
    if (n.tls.skipCertVerify) tls.insecure = true
    if (n.tls.fingerprint) tls.utls = { enabled: true, fingerprint: n.tls.fingerprint }
    if (n.tls.realityPublicKey) {
      tls.reality = {
        enabled: true,
        public_key: n.tls.realityPublicKey,
        ...(n.tls.realityShortId ? { short_id: n.tls.realityShortId } : {}),
      }
    }
    o.tls = tls
  }

  const t = n.transport
  if (t && t.network && t.network !== 'tcp') {
    if (t.network === 'ws') {
      o.transport = {
        type: 'ws',
        ...(t.path ? { path: t.path } : {}),
        ...(t.host ? { headers: { Host: t.host } } : {}),
      }
    } else if (t.network === 'grpc') {
      o.transport = { type: 'grpc', service_name: t.serviceName || t.path || '' }
    } else if (t.network === 'http' || t.network === 'h2') {
      o.transport = { type: 'http', ...(t.path ? { path: t.path } : {}), ...(t.host ? { host: [t.host] } : {}) }
    }
  }
  return o
}

function groupToOutbound(g: ProxyGroupDef, nodeNames: string[]): Record<string, unknown> {
  const outbounds = resolveGroupMembers(g, nodeNames)
  if (g.type === 'url-test' || g.type === 'fallback' || g.type === 'load-balance') {
    return {
      type: 'urltest',
      tag: g.name,
      outbounds,
      ...(g.url ? { url: g.url } : {}),
      ...(g.interval ? { interval: `${g.interval}s` } : {}),
    }
  }
  return { type: 'selector', tag: g.name, outbounds }
}

/** 把 Clash 风格规则字符串尽力翻译为 sing-box route 规则。无法识别的跳过。 */
export function clashRuleToSingbox(rule: string): { obj?: Record<string, unknown>; final?: string } {
  const parts = rule.split(',').map((s) => s.trim())
  const type = parts[0]?.toUpperCase()
  const value = parts[1]
  const target = parts[2] ?? parts[1]
  switch (type) {
    case 'DOMAIN':
      return { obj: { domain: [value], outbound: target } }
    case 'DOMAIN-SUFFIX':
      return { obj: { domain_suffix: [value], outbound: target } }
    case 'DOMAIN-KEYWORD':
      return { obj: { domain_keyword: [value], outbound: target } }
    case 'IP-CIDR':
    case 'IP-CIDR6':
      return { obj: { ip_cidr: [value], outbound: target } }
    case 'MATCH':
    case 'FINAL':
      return { final: parts[1] }
    default:
      return {}
  }
}

/** 渲染为 sing-box JSON（best-effort，覆盖常见协议与规则类型）。 */
export function renderSingbox(ctx: RenderContext): string {
  const { nodes, profile } = ctx
  const nodeNames = nodes.map((n) => n.name)
  const proxyOutbounds = nodes.map(nodeToSingbox)
  const groupOutbounds = profile.groups.map((g) => groupToOutbound(g, nodeNames))

  const routeRules: Record<string, unknown>[] = []
  let finalOutbound = profile.groups[0]?.name ?? 'DIRECT'
  for (const r of profile.rules) {
    const { obj, final } = clashRuleToSingbox(r)
    if (obj) routeRules.push(obj)
    if (final) finalOutbound = final
  }

  const config = {
    ...(profile.extraConfig || {}),
    outbounds: [
      ...proxyOutbounds,
      ...groupOutbounds,
      { type: 'direct', tag: 'DIRECT' },
    ],
    route: { rules: routeRules, final: finalOutbound },
  }
  return JSON.stringify(config, null, 2)
}
