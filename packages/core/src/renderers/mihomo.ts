import * as yaml from 'js-yaml'
import type { ProxyGroupDef, RenderContext } from '../config.js'
import type { ProxyNode, ProxyType } from '../model.js'
import { tryCompileLinearRegex } from '../safeRegex.js'
import { filterSupported } from './support.js'

/** 协议自带 TLS，mihomo 里不写 `tls: true`。 */
const TLS_IMPLICIT: ReadonlySet<ProxyType> = new Set<ProxyType>(['hysteria', 'hysteria2', 'tuic', 'anytls'])

/** mihomo 里用 `sni` 而非 `servername` 表达 SNI 的协议。 */
const SNI_TYPES: ReadonlySet<ProxyType> = new Set<ProxyType>([
  'vless',
  'trojan',
  'hysteria',
  'hysteria2',
  'tuic',
  'anytls',
])

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
      if (n.plugin) {
        base.plugin = n.plugin
        if (n.pluginOpts && Object.keys(n.pluginOpts).length) base['plugin-opts'] = { ...n.pluginOpts }
      }
      break
    case 'ssr':
      base.cipher = n.cipher
      base.password = n.password
      base.protocol = n.protocol
      if (n.protocolParam) base['protocol-param'] = n.protocolParam
      base.obfs = n.obfs
      if (n.obfsParam) base['obfs-param'] = n.obfsParam
      break
    case 'hysteria':
      base['auth-str'] = n.password
      if (n.protocol) base.protocol = n.protocol
      if (n.obfs) base.obfs = n.obfs
      if (n.obfsParam) base['obfs-param'] = n.obfsParam
      if (n.upMbps) base.up = `${n.upMbps} Mbps`
      if (n.downMbps) base.down = `${n.downMbps} Mbps`
      if (n.ports) base.ports = n.ports
      break
    case 'hysteria2':
      base.password = n.password
      if (n.obfs) {
        base.obfs = n.obfs
        if (n.obfsPassword) base['obfs-password'] = n.obfsPassword
      }
      if (n.ports) base.ports = n.ports
      if (n.upMbps) base.up = `${n.upMbps} Mbps`
      if (n.downMbps) base.down = `${n.downMbps} Mbps`
      break
    case 'tuic':
      base.uuid = n.uuid
      base.password = n.password
      if (n.congestion) base['congestion-controller'] = n.congestion
      if (n.protocol) base['udp-relay-mode'] = n.protocol
      break
    case 'socks5':
    case 'http':
      if (n.username) base.username = n.username
      if (n.password) base.password = n.password
      break
    case 'snell':
      base.psk = n.password
      if (n.version) base.version = n.version
      if (n.obfs) {
        base['obfs-opts'] = { mode: n.obfs, ...(n.obfsHost ? { host: n.obfsHost } : {}) }
      }
      break
    case 'anytls':
      base.password = n.password
      break
  }

  // TLS
  if (n.tls?.enabled) {
    // hysteria / tuic / anytls 本身就是 TLS 协议，mihomo 不接受多余的 tls 字段
    if (!TLS_IMPLICIT.has(n.type)) base.tls = true
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
  // 这些协议在 mihomo 里用 sni 而不是 servername
  if (SNI_TYPES.has(n.type) && n.tls?.sni) {
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

/**
 * 按 filter / excludeFilter / includeAll / proxies 解析一个组的成员名列表。
 *
 * 传入 `warnings` 可收集「正则编译不出来」的降级提示，会经 PipelineOutput 回到预览面板。
 */
export function resolveGroupMembers(group: ProxyGroupDef, nodeNames: string[], warnings?: string[]): string[] {
  const members: string[] = []
  if (group.proxies) members.push(...group.proxies)

  let pool: string[] = []
  if (group.includeAll) pool = [...nodeNames]
  else if (group.filter) pool = [...nodeNames]

  // 坏正则（含 RE2 不支持又有回溯风险的写法）只让**该条筛选**失效，绝不抛出——
  // 否则单个组的正则就能打挂整份配置的渲染与公开分享出口。
  //
  // 失效时保留全部候选，而不是清空组：组一旦为空就会走下面的「兜底 DIRECT」，
  // 等于让这部分流量绕过代理——那比少过滤几个节点严重得多。两条筛选同一处理，
  // 不做 filter 清空 / excludeFilter 忽略的不对称。
  if (group.filter) {
    const re = tryCompileLinearRegex(group.filter)
    if (re) pool = pool.filter((name) => re.test(name))
    else warnings?.push(`组「${group.name}」的 filter 正则无法安全编译，已忽略该筛选：${group.filter}`)
  }
  if (group.excludeFilter) {
    const re = tryCompileLinearRegex(group.excludeFilter)
    if (re) pool = pool.filter((name) => !re.test(name))
    else warnings?.push(`组「${group.name}」的 excludeFilter 正则无法安全编译，已忽略该筛选：${group.excludeFilter}`)
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
  const { profile } = ctx
  const nodes = filterSupported(ctx.nodes, 'mihomo', ctx.warnings)
  const proxies = nodes.map(nodeToMihomo)
  const nodeNames = nodes.map((n) => n.name)

  const proxyGroups = profile.groups.map((g) => {
    const out: Record<string, unknown> = {
      name: g.name,
      type: g.type,
      proxies: resolveGroupMembers(g, nodeNames, ctx.warnings),
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
