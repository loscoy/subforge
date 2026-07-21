import { makeNode, type Network, type ProxyNode, type Transport, type TlsOptions } from '../model.js'
import { parseClashYaml } from './clash.js'
import { b64decode, decodeName, looksLikeBase64, parseAlpn, truthy } from './util.js'

/**
 * 单节点 URI 解析。无法识别返回 null（调用方跳过）。
 */
export function parseUri(uri: string): ProxyNode | null {
  const trimmed = uri.trim()
  if (!trimmed) return null
  const scheme = trimmed.split('://', 1)[0]?.toLowerCase()
  try {
    switch (scheme) {
      case 'vmess':
        return parseVmess(trimmed)
      case 'vless':
        return parseVless(trimmed)
      case 'trojan':
        return parseTrojan(trimmed)
      case 'ss':
        return parseSs(trimmed)
      case 'hysteria2':
      case 'hy2':
        return parseHysteria2(trimmed)
      case 'tuic':
        return parseTuic(trimmed)
      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * 解析一份订阅内容：可能是整体 base64、也可能是每行一个 URI。
 * 返回所有成功解析的节点。
 */
export function parseSubscription(raw: string): ProxyNode[] {
  let text = raw.trim()
  if (!text) return []
  // 整体 base64（无 :// 且符合 base64 字符集）→ 先解一层
  if (looksLikeBase64(text)) {
    const decoded = b64decode(text)
    if (decoded.includes('://')) text = decoded
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const nodes: ProxyNode[] = []
  for (const line of lines) {
    const node = parseUri(line)
    if (node) nodes.push(node)
  }
  // 没有 URI 节点时，尝试按 Clash/Mihomo YAML 订阅解析（机场常见 ?clash 返回此格式）
  if (nodes.length === 0 && /(^|\n)proxies\s*:/.test(text)) {
    return parseClashYaml(text)
  }
  return nodes
}

// ---- 各协议 ----

function parseVmess(uri: string): ProxyNode | null {
  const body = uri.slice('vmess://'.length)
  const json = JSON.parse(b64decode(body)) as Record<string, unknown>
  const str = (k: string) => (json[k] == null ? undefined : String(json[k]))
  const server = str('add')
  const port = Number(json.port)
  if (!server || !port) return null
  const net = (str('net') || 'tcp') as Network
  const tlsOn = str('tls') === 'tls'
  const transport: Transport | undefined =
    net === 'tcp'
      ? undefined
      : {
          network: net,
          path: str('path'),
          host: str('host'),
          serviceName: net === 'grpc' ? str('path') : undefined,
        }
  const tls: TlsOptions | undefined = tlsOn
    ? { enabled: true, sni: str('sni') || str('host'), alpn: parseAlpn(str('alpn')) }
    : undefined
  return makeNode({
    name: str('ps') || `${server}:${port}`,
    type: 'vmess',
    server,
    port,
    uuid: str('id'),
    alterId: json.aid != null ? Number(json.aid) : 0,
    cipher: str('scy') || 'auto',
    tls,
    transport,
  })
}

function parseVless(uri: string): ProxyNode | null {
  const u = new URL(uri)
  const q = u.searchParams
  const security = q.get('security')
  const net = (q.get('type') || 'tcp') as Network
  const transport = buildTransportFromQuery(net, q)
  const tls: TlsOptions | undefined =
    security === 'tls' || security === 'reality'
      ? {
          enabled: true,
          sni: q.get('sni') || q.get('host') || undefined,
          alpn: parseAlpn(q.get('alpn')),
          fingerprint: q.get('fp') || undefined,
          skipCertVerify: truthy(q.get('allowInsecure')),
          realityPublicKey: q.get('pbk') || undefined,
          realityShortId: q.get('sid') || undefined,
        }
      : undefined
  return makeNode({
    name: decodeName(u.hash, `${u.hostname}:${u.port}`),
    type: 'vless',
    server: u.hostname,
    port: Number(u.port),
    uuid: decodeURIComponent(u.username),
    flow: q.get('flow') || undefined,
    tls,
    transport,
  })
}

function parseTrojan(uri: string): ProxyNode | null {
  const u = new URL(uri)
  const q = u.searchParams
  const net = (q.get('type') || 'tcp') as Network
  return makeNode({
    name: decodeName(u.hash, `${u.hostname}:${u.port}`),
    type: 'trojan',
    server: u.hostname,
    port: Number(u.port),
    password: decodeURIComponent(u.username),
    tls: {
      enabled: true,
      sni: q.get('sni') || q.get('peer') || undefined,
      alpn: parseAlpn(q.get('alpn')),
      fingerprint: q.get('fp') || undefined,
      skipCertVerify: truthy(q.get('allowInsecure')),
    },
    transport: buildTransportFromQuery(net, q),
  })
}

function parseSs(uri: string): ProxyNode | null {
  // 两种形式：ss://base64(method:pass)@host:port#name 或 ss://base64(method:pass@host:port)#name
  const hashIdx = uri.indexOf('#')
  const name = hashIdx >= 0 ? decodeName(uri.slice(hashIdx), '') : ''
  let body = uri.slice('ss://'.length, hashIdx >= 0 ? hashIdx : undefined)

  let method: string, password: string, host: string, port: number
  if (body.includes('@')) {
    const [userinfo, hostinfo] = splitLast(body, '@')
    const decoded = userinfo.includes(':') ? userinfo : b64decode(userinfo)
    ;[method, password] = splitFirst(decoded, ':')
    const [h, p] = splitLast(hostinfo, ':')
    host = h
    port = Number(p)
  } else {
    const decoded = b64decode(body)
    const [userinfo, hostinfo] = splitLast(decoded, '@')
    ;[method, password] = splitFirst(userinfo, ':')
    const [h, p] = splitLast(hostinfo, ':')
    host = h
    port = Number(p)
  }
  if (!host || !port) return null
  return makeNode({
    name: name || `${host}:${port}`,
    type: 'ss',
    server: host,
    port,
    cipher: method,
    password,
  })
}

function parseHysteria2(uri: string): ProxyNode | null {
  const u = new URL(uri.replace(/^hy2:\/\//, 'hysteria2://'))
  const q = u.searchParams
  return makeNode({
    name: decodeName(u.hash, `${u.hostname}:${u.port}`),
    type: 'hysteria2',
    server: u.hostname,
    port: Number(u.port),
    password: decodeURIComponent(u.username || q.get('password') || ''),
    obfs: q.get('obfs') || undefined,
    obfsPassword: q.get('obfs-password') || undefined,
    tls: {
      enabled: true,
      sni: q.get('sni') || undefined,
      skipCertVerify: truthy(q.get('insecure')),
      alpn: parseAlpn(q.get('alpn')),
    },
  })
}

function parseTuic(uri: string): ProxyNode | null {
  const u = new URL(uri)
  const q = u.searchParams
  return makeNode({
    name: decodeName(u.hash, `${u.hostname}:${u.port}`),
    type: 'tuic',
    server: u.hostname,
    port: Number(u.port),
    uuid: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    congestion: q.get('congestion_control') || undefined,
    obfs: q.get('udp_relay_mode') || undefined,
    tls: {
      enabled: true,
      sni: q.get('sni') || undefined,
      alpn: parseAlpn(q.get('alpn')),
      skipCertVerify: truthy(q.get('allow_insecure')),
    },
  })
}

// ---- 小工具 ----

function buildTransportFromQuery(net: Network, q: URLSearchParams): Transport | undefined {
  if (net === 'tcp') return undefined
  return {
    network: net,
    path: q.get('path') || undefined,
    host: q.get('host') || undefined,
    serviceName: q.get('serviceName') || undefined,
  }
}

function splitFirst(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep)
  if (i < 0) return [s, '']
  return [s.slice(0, i), s.slice(i + sep.length)]
}

function splitLast(s: string, sep: string): [string, string] {
  const i = s.lastIndexOf(sep)
  if (i < 0) return [s, '']
  return [s.slice(0, i), s.slice(i + sep.length)]
}
