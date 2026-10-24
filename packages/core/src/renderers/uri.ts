import type { RenderContext } from '../config.js'
import type { ProxyNode } from '../model.js'
import { parseUri } from '../parsers/index.js'

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

/** 通用 URI 没有统一的任意字段扩展；无法往返的字段必须明确拒绝。 */
export function nodeToUri(n: ProxyNode): string {
  const q = new URLSearchParams()
  const set = (key: string, value: unknown) => { if (value !== undefined) q.set(key, String(value)) }
  const t = n.transport
  const tls = n.tls
  set('type', t?.network)
  set('path', t?.path)
  set('host', t?.host)
  set('serviceName', t?.serviceName)
  if (tls?.enabled) {
    set('security', tls.realityPublicKey ? 'reality' : 'tls')
    set('sni', tls.sni); set('alpn', tls.alpn?.join(',')); set('fp', tls.fingerprint)
    set('pbk', tls.realityPublicKey); set('sid', tls.realityShortId)
    if (tls.skipCertVerify) set('insecure', 1)
  }
  set('flow', n.flow); set('obfs', n.obfs); set('obfs-password', n.obfsPassword)
  set('obfsParam', n.obfsParam); set('obfs-host', n.obfsHost); set('version', n.version)
  set('protocol', n.protocol); set('mport', n.ports); set('upmbps', n.upMbps); set('downmbps', n.downMbps)
  set('congestion_control', n.congestion)
  if (n.type === 'tuic') set('udp_relay_mode', n.protocol)
  if (n.plugin) set('plugin', [n.plugin, ...Object.entries(n.pluginOpts || {}).map(([k, v]) => `${k}=${v}`)].join(';'))
  let scheme: string = n.type
  let auth = encodeURIComponent(n.uuid ?? n.password ?? '')
  if (n.type === 'tuic') auth = `${encodeURIComponent(n.uuid || '')}:${encodeURIComponent(n.password || '')}`
  if (n.type === 'ss') auth = b64(`${n.cipher}:${n.password}`)
  if (n.type === 'socks5' || n.type === 'http') {
    auth = n.username || n.password ? `${encodeURIComponent(n.username || '')}:${encodeURIComponent(n.password || '')}` : ''
    if (tls?.enabled) scheme = n.type === 'http' ? 'https' : 'socks5+tls'
  }
  const host = n.server.includes(':') && !n.server.startsWith('[') ? `[${n.server}]` : n.server
  let uri = `${scheme}://${auth ? auth + '@' : ''}${host}:${n.port}${q.size ? '?' + q.toString() : ''}#${encodeURIComponent(n.name)}`
  if (n.type === 'vmess') {
    uri = 'vmess://' + b64(JSON.stringify({ v: '2', ps: n.name, add: n.server, port: n.port, id: n.uuid,
      aid: n.alterId ?? 0, scy: n.cipher ?? 'auto', net: t?.network ?? 'tcp', path: t?.path,
      host: t?.host, serviceName: t?.serviceName, tls: tls?.enabled ? 'tls' : '',
      sni: tls?.sni, alpn: tls?.alpn?.join(','), fp: tls?.fingerprint, allowInsecure: tls?.skipCertVerify,
    }))
  }
  if (n.type === 'ssr') {
    const params = new URLSearchParams({ remarks: b64(n.name) })
    if (n.protocolParam) params.set('protoparam', b64(n.protocolParam))
    if (n.obfsParam) params.set('obfsparam', b64(n.obfsParam))
    uri = 'ssr://' + b64(`${n.server}:${n.port}:${n.protocol}:${n.cipher}:${n.obfs}:${b64(n.password || '')}/?${params}`)
  }
  const parsed = parseUri(uri)
  if (!parsed) throw new Error(`Cannot export URI for node: ${n.name}`)
  // 按原字段逐项核对；默认关闭的 TLS 选项与缺省等价，来源元数据不属于 URI。
  const check = (original: unknown, restored: unknown, path: string) => {
    if (original === undefined || (original === false && restored === undefined)) return
    if (original && typeof original === 'object' && !Array.isArray(original)) {
      for (const [key, value] of Object.entries(original)) {
        if (path === '' && key === 'meta') continue
        check(value, (restored as Record<string, unknown> | undefined)?.[key], path ? `${path}.${key}` : key)
      }
    } else if (JSON.stringify(original) !== JSON.stringify(restored)) {
      throw new Error(`URI cannot preserve ${path} for ${n.name}; use node-json or a client format`)
    }
  }
  check(n, parsed, '')
  return uri
}

export function renderUri({ nodes, profile, warnings }: RenderContext): string {
  if (profile.groups.length || profile.rules.length || profile.ruleProviders?.length || Object.keys(profile.extraConfig || {}).length) {
    warnings?.push('通用 URI 仅导出节点，不包含分组、规则、DNS 或 TUN；来源元数据请使用节点 JSON。')
  }
  return nodes.map(nodeToUri).join('\n')
}
