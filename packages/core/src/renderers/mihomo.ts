import yaml from 'js-yaml'
import type { ProxyGroupDef, RenderContext } from '../config.js'
import type { ProxyNode } from '../model.js'

/** 把统一节点转换为 Mihomo proxy 对象。 */
export function nodeToMihomo(n: ProxyNode): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: n.name,
    type: n.type === 'hysteria2' ? 'hysteria2' : n.type,
    server: n.server,
    port: n.port,
  }
  if (n.udp !== undefined) base.udp = n.udp

  switch (n.type) {
    case 'vmess':
      base.uuid = n.uuid
      base.alterId = n.alterId ?? 0
      base.cipher = n.cipher || 'auto'
      break
    case 'vless':
      base.uuid = n.uuid
      if (n.flow) base.flow = n.flow
      break
    case 'trojan':
      base.password = n.password
      break
    case 'ss':
      base.cipher = n.cipher
      base.password = n.password
      break
    case 'hysteria2':
      base.password = n.password
      if (n.obfs) {
        base.obfs = n.obfs
        if (n.obfsPassword) base['obfs-password'] = n.obfsPassword
      }
      break
    case 'tuic':
      base.uuid = n.uuid
      base.password = n.password
      if (n.congestion) base['congestion-controller'] = n.congestion
      break
  }

  // TLS
  if (n.tls?.enabled) {
    base.tls = true
    if (n.tls.sni) base.servername = n.tls.sni
    if (n.tls.alpn) base.alpn = n.tls.alpn
    if (n.tls.skipCertVerify) base['skip-cert-verify'] = true
    if (n.tls.fingerprint) base['client-fingerprint'] = n.tls.fingerprint
    if (n.tls.realityPublicKey) {
      base['reality-opts'] = {
        'public-key': n.tls.realityPublicKey,
        ...(n.tls.realityShortId ? { 'short-id': n.tls.realityShortId } : {}),
      }
    }
  }
  // vless/trojan 的 sni 用 sni 字段
  if ((n.type === 'vless' || n.type === 'trojan') && n.tls?.sni) {
    base.sni = n.tls.sni
    delete base.servername
  }

  // 传输层
  const t = n.transport
  if (t && t.network && t.network !== 'tcp') {
    base.network = t.network
    if (t.network === 'ws') {
      base['ws-opts'] = {
        ...(t.path ? { path: t.path } : {}),
        ...(t.host ? { headers: { Host: t.host } } : {}),
        ...(t.wsHeaders ? { headers: { ...(t.host ? { Host: t.host } : {}), ...t.wsHeaders } } : {}),
      }
    } else if (t.network === 'grpc') {
      base['grpc-opts'] = { 'grpc-service-name': t.serviceName || t.path || '' }
    } else if (t.network === 'h2' || t.network === 'http') {
      base['h2-opts'] = {
        ...(t.path ? { path: t.path } : {}),
        ...(t.host ? { host: [t.host] } : {}),
      }
    }
  }

  if (n.extra) Object.assign(base, n.extra)
  return base
}

/** 按 filter / excludeFilter / includeAll / proxies 解析一个组的成员名列表。 */
export function resolveGroupMembers(group: ProxyGroupDef, nodeNames: string[]): string[] {
  const members: string[] = []
  if (group.proxies) members.push(...group.proxies)

  let pool: string[] = []
  if (group.includeAll) pool = [...nodeNames]
  else if (group.filter) pool = [...nodeNames]

  if (group.filter) {
    const re = new RegExp(group.filter)
    pool = pool.filter((name) => re.test(name))
  }
  if (group.excludeFilter) {
    const re = new RegExp(group.excludeFilter)
    pool = pool.filter((name) => !re.test(name))
  }
  members.push(...pool)

  // 去重，保持顺序
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of members) {
    if (!seen.has(m)) {
      seen.add(m)
      out.push(m)
    }
  }
  // 组不能为空，否则 Mihomo 报错——兜底放 DIRECT
  return out.length ? out : ['DIRECT']
}

/** 渲染为 Mihomo/Clash YAML 文本。 */
export function renderMihomo(ctx: RenderContext): string {
  const { nodes, profile } = ctx
  const proxies = nodes.map(nodeToMihomo)
  const nodeNames = nodes.map((n) => n.name)

  const proxyGroups = profile.groups.map((g) => {
    const out: Record<string, unknown> = {
      name: g.name,
      type: g.type,
      proxies: resolveGroupMembers(g, nodeNames),
    }
    if (g.url) out.url = g.url
    if (g.interval) out.interval = g.interval
    if (g.tolerance) out.tolerance = g.tolerance
    if (g.icon) out.icon = g.icon
    return out
  })

  const config: Record<string, unknown> = {
    ...(profile.extraConfig || {}),
    proxies,
    'proxy-groups': proxyGroups,
  }

  if (profile.ruleProviders?.length) {
    const rp: Record<string, unknown> = {}
    for (const p of profile.ruleProviders) {
      rp[p.name] = {
        type: p.type,
        behavior: p.behavior,
        ...(p.url ? { url: p.url } : {}),
        ...(p.path ? { path: p.path } : {}),
        ...(p.interval ? { interval: p.interval } : {}),
        ...(p.format ? { format: p.format } : {}),
      }
    }
    config['rule-providers'] = rp
  }

  config.rules = profile.rules

  return yaml.dump(config, { lineWidth: -1, noRefs: true, sortKeys: false })
}
