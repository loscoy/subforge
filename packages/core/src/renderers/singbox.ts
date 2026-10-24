import type { ProxyGroupDef, RenderContext } from '../config.js'
import type { ProxyNode } from '../model.js'
import { resolveGroupMembers } from './mihomo.js'
import { filterSupported } from './support.js'

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
    case 'hysteria':
      o.type = 'hysteria'
      o.auth_str = n.password
      if (n.obfs || n.obfsParam) o.obfs = n.obfsParam || n.obfs
      if (n.upMbps) o.up_mbps = n.upMbps
      if (n.downMbps) o.down_mbps = n.downMbps
      break
    case 'hysteria2':
      o.type = 'hysteria2'
      o.password = n.password
      if (n.obfs) o.obfs = { type: n.obfs, ...(n.obfsPassword ? { password: n.obfsPassword } : {}) }
      if (n.upMbps) o.up_mbps = n.upMbps
      if (n.downMbps) o.down_mbps = n.downMbps
      break
    case 'tuic':
      o.type = 'tuic'
      o.uuid = n.uuid
      o.password = n.password
      if (n.congestion) o.congestion_control = n.congestion
      if (n.protocol) o.udp_relay_mode = n.protocol
      break
    case 'socks5':
      o.type = 'socks'
      o.version = '5'
      if (n.username) o.username = n.username
      if (n.password) o.password = n.password
      break
    case 'http':
      o.type = 'http'
      if (n.username) o.username = n.username
      if (n.password) o.password = n.password
      break
    case 'anytls':
      o.type = 'anytls'
      o.password = n.password
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
        ...((t.host || t.wsHeaders) ? { headers: { ...(t.host ? { Host: t.host } : {}), ...t.wsHeaders } } : {}),
      }
    } else if (t.network === 'grpc') {
      o.transport = { type: 'grpc', service_name: t.serviceName || t.path || '' }
    } else if (t.network === 'http' || t.network === 'h2') {
      // sing-box 的 http transport 同时覆盖 HTTP 伪装与 h2（开了 TLS 即 HTTP/2），两者合并是对的
      if ((t.httpPaths?.length ?? 0) > 1) throw new Error('sing-box HTTP transport cannot preserve multiple paths')
      o.transport = {
        type: 'http',
        ...(t.path ? { path: t.path } : {}),
        ...(t.httpHosts || t.host ? { host: t.httpHosts ?? t.httpHeaders?.Host ?? t.httpHeaders?.host ?? [t.host!] } : {}),
        ...(t.httpMethod ? { method: t.httpMethod } : {}),
        ...(t.httpHeaders ? { headers: t.httpHeaders } : {}),
      }
    } else if (t.network === 'httpupgrade') {
      // 独立的 transport 类型。漏掉分支的话 transport 整个不写，节点被当成裸 TCP 发出去：
      // 配置能加载，但连不上。注意 host 在这里是字符串，与上面 http 的数组不同。
      o.transport = { type: 'httpupgrade', ...(t.path ? { path: t.path } : {}), ...(t.host ? { host: t.host } : {}), ...(t.wsHeaders ? { headers: t.wsHeaders } : {}) }
    }
  }
  return o
}

function groupToOutbound(g: ProxyGroupDef, nodes: ProxyNode[], warnings?: string[]): Record<string, unknown> {
  if (g.type !== 'select' && g.type !== 'url-test') {
    throw new Error(`sing-box does not support group type: ${g.type} (${g.name})`)
  }
  const outbounds = resolveGroupMembers(g, nodes.map((n) => n.name), warnings, nodes)
  if (g.type === 'url-test') {
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

/** 只转换能明确表达的规则；不支持的语义必须报错。 */
export function clashRuleToSingbox(rule: string): { obj?: Record<string, unknown>; final?: string } {
  const parts = rule.split(',').map((s) => s.trim())
  const type = parts[0]?.toUpperCase()
  const value = parts[1]
  const target = parts[2] ?? parts[1]
  if (!value || !target || parts.length > 3 || (type !== 'MATCH' && type !== 'FINAL' && parts.length !== 3)) {
    throw new Error(`Invalid or unsupported sing-box rule: ${rule}`)
  }
  const action = target === 'REJECT' ? { action: 'reject' } : { outbound: target }
  switch (type) {
    case 'DOMAIN':
      return { obj: { domain: [value], ...action } }
    case 'DOMAIN-SUFFIX':
      return { obj: { domain_suffix: [value], ...action } }
    case 'DOMAIN-KEYWORD':
      return { obj: { domain_keyword: [value], ...action } }
    case 'IP-CIDR':
    case 'IP-CIDR6':
      return { obj: { ip_cidr: [value], ...action } }
    case 'MATCH':
    case 'FINAL':
      if (parts.length !== 2) throw new Error(`Invalid final rule: ${rule}`)
      if (value === 'REJECT') return { obj: { action: 'reject' } }
      return { final: parts[1] }
    default:
      throw new Error(`Unsupported sing-box rule: ${rule}`)
  }
}

/** 渲染为 sing-box JSON（best-effort，覆盖常见协议与规则类型）。 */
export function renderSingbox(ctx: RenderContext): string {
  const { profile } = ctx
  if (profile.ruleProviders?.length) throw new Error('Clash rule providers are not supported by the sing-box renderer')
  const nodes = filterSupported(ctx.nodes, 'singbox', ctx.warnings)
  const nodeNames = nodes.map((n) => n.name)
  const proxyOutbounds = nodes.map(nodeToSingbox)
  const groupOutbounds = profile.groups.map((g) => groupToOutbound(g, nodes, ctx.warnings))
  const tags = [...nodeNames, ...profile.groups.map((g) => g.name), 'DIRECT']
  if (new Set(tags).size !== tags.length) throw new Error('Duplicate sing-box outbound tags')
  const assertTarget = (tag: unknown) => {
    if (typeof tag !== 'string' || !tags.includes(tag)) throw new Error(`Unknown sing-box outbound reference: ${String(tag)}`)
  }
  for (const group of groupOutbounds) for (const tag of group.outbounds as string[]) assertTarget(tag)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const checkCycle = (tag: string) => {
    if (visiting.has(tag)) throw new Error(`Cyclic sing-box group reference: ${tag}`)
    if (visited.has(tag)) return
    visiting.add(tag)
    const group = groupOutbounds.find((g) => g.tag === tag)
    if (group) for (const member of group.outbounds as string[]) checkCycle(member)
    visiting.delete(tag)
    visited.add(tag)
  }
  for (const tag of tags) checkCycle(tag)

  const routeRules: Record<string, unknown>[] = []
  let finalOutbound = profile.groups[0]?.name ?? 'DIRECT'
  let terminal = false
  for (const r of profile.rules) {
    if (terminal) throw new Error('Rules after MATCH/FINAL would be unreachable')
    const { obj, final } = clashRuleToSingbox(r)
    if (obj?.outbound) assertTarget(obj.outbound)
    if (obj) routeRules.push(obj)
    if (final) finalOutbound = final
    terminal = /^(MATCH|FINAL),/i.test(r.trim())
  }
  assertTarget(finalOutbound)

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
