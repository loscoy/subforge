/**
 * 单协议 URI 解析器。
 *
 * 协议覆盖对齐 Sub-Store 的 URI 解析器（socks/http/ss/ssr/vmess/vless/anytls/
 * hysteria2/hysteria/tuic/trojan/snell）。所有解析器共用一条约定：
 * **认不出就返回 null**，由 `parseUri` 跳过，绝不抛错中断整份订阅。
 */

import { makeNode, type Network, type ProxyNode, type Transport, type TlsOptions } from '../model.js'
import {
  b64decode,
  decodeUserinfo,
  firstPort,
  isPortHopping,
  parseAlpn,
  parsePluginOpts,
  parseUriParts,
  pick,
  safeDecodeURIComponent,
  splitHostPort,
  truthy,
} from './util.js'

// ---- 共用小工具 ----

function splitFirst(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep)
  if (i < 0) return [s, '']
  return [s.slice(0, i), s.slice(i + sep.length)]
}

/** query 里的「跳过证书校验」有一堆别名，统一在这里认。 */
function insecureOf(q: URLSearchParams): boolean {
  return (
    truthy(q.get('insecure')) ||
    truthy(q.get('allowInsecure')) ||
    truthy(q.get('allow_insecure')) ||
    truthy(q.get('allow-insecure')) ||
    truthy(q.get('skip-cert-verify'))
  )
}

/** 把各家写法的传输层名字归一到内部 Network。 */
function normalizeNetwork(raw: string | undefined): Network {
  const v = (raw || 'tcp').toLowerCase()
  switch (v) {
    case 'ws':
    case 'websocket':
      return 'ws'
    case 'grpc':
    case 'gun':
      return 'grpc'
    case 'h2':
    case 'http2':
      return 'h2'
    case 'http':
      return 'http'
    case 'httpupgrade':
      return 'httpupgrade'
    default:
      // kcp / quic / xhttp / splithttp 等我们不支持的传输，按 tcp 处理，至少节点不丢
      return 'tcp'
  }
}

/** 从 query 构造传输层配置；tcp 返回 undefined（无需额外字段）。 */
function transportFromQuery(net: Network, q: URLSearchParams): Transport | undefined {
  if (net === 'tcp') return undefined
  const host = pick(q, 'host', 'sni')
  const path = pick(q, 'path')
  return {
    network: net,
    path,
    // host 可能是逗号分隔的多个域名，取第一个
    host: host ? host.split(',')[0]!.trim() : undefined,
    // grpc 的 serviceName 在不同客户端里分别写在 serviceName / path
    serviceName: net === 'grpc' ? pick(q, 'serviceName', 'servicename', 'path') : undefined,
  }
}

/** 从 query 构造 TLS 配置。`force` 用于 trojan/anytls 这类天然强制 TLS 的协议。 */
function tlsFromQuery(q: URLSearchParams, force = false): TlsOptions | undefined {
  const security = (pick(q, 'security') || '').toLowerCase()
  const on = force || security === 'tls' || security === 'reality' || security === 'xtls'
  if (!on) return undefined
  const tls: TlsOptions = { enabled: true }
  const sni = pick(q, 'sni', 'peer', 'servername', 'host')
  if (sni) tls.sni = sni.split(',')[0]!.trim()
  const alpn = parseAlpn(pick(q, 'alpn'))
  if (alpn) tls.alpn = alpn
  const fp = pick(q, 'fp', 'client-fingerprint')
  if (fp) tls.fingerprint = fp
  if (insecureOf(q)) tls.skipCertVerify = true
  const pbk = pick(q, 'pbk', 'public-key')
  if (pbk) tls.realityPublicKey = pbk
  const sid = pick(q, 'sid', 'short-id')
  if (sid) tls.realityShortId = sid
  return tls
}

/** 端口跳跃：mport/ports 参数优先，其次是 host:port 里写的区间。 */
function portsOf(q: URLSearchParams, portRaw: string): string | undefined {
  const explicit = pick(q, 'mport', 'ports', 'port')
  if (explicit && isPortHopping(explicit)) return explicit
  if (isPortHopping(portRaw)) return portRaw
  return undefined
}

// ---- shadowsocks ----

/**
 * ss:// 三种形态都要认：
 * 1. `ss://base64(method:pass@host:port)#name`      —— 老式整体 base64
 * 2. `ss://base64(method:pass)@host:port?plugin=…`  —— SIP002
 * 3. `ss://method:urlencoded(pass)@host:port?…`     —— SIP002 明文 userinfo（ss2022 常见）
 *
 * 之前只处理了 1/2 且把 `?plugin=…` 一起算进端口，导致带插件的节点全被丢弃。
 */
export function parseSs(body: string): ProxyNode | null {
  let rest = body
  let name = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    name = safeDecodeURIComponent(rest.slice(hashIdx + 1))
    rest = rest.slice(0, hashIdx)
  }
  let query = new URLSearchParams()
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) {
    query = new URLSearchParams(rest.slice(qIdx + 1))
    rest = rest.slice(0, qIdx)
  }
  rest = rest.replace(/\/+$/, '')

  let creds: string
  let hostport: string
  const atIdx = rest.lastIndexOf('@')
  if (atIdx >= 0) {
    creds = decodeUserinfo(rest.slice(0, atIdx))
    hostport = rest.slice(atIdx + 1)
  } else {
    // 老式：整体 base64，解开后才是 method:pass@host:port
    const decoded = b64decode(rest)
    const at = decoded.lastIndexOf('@')
    if (at < 0) return null
    creds = safeDecodeURIComponent(decoded.slice(0, at))
    hostport = decoded.slice(at + 1)
  }

  const [cipher, password] = splitFirst(creds, ':')
  const hp = splitHostPort(hostport)
  if (!hp || !cipher) return null

  const node = makeNode({
    name: name || `${hp.host}:${hp.port}`,
    type: 'ss',
    server: hp.host,
    port: hp.port,
    cipher,
    password,
  })
  if (query.has('udp')) node.udp = truthy(query.get('udp'))
  applySsPlugin(node, query.get('plugin'))
  return node
}

/** SIP002 `plugin=名字;k=v;k2=v2` → 归一化的 plugin / pluginOpts。 */
function applySsPlugin(node: ProxyNode, raw: string | null): void {
  if (!raw) return
  const [rawName, optsStr] = splitFirst(raw, ';')
  const opts = optsStr ? parsePluginOpts(optsStr) : {}
  const name = rawName.trim().toLowerCase()
  if (name === 'obfs-local' || name === 'simple-obfs' || name === 'obfs') {
    node.plugin = 'obfs'
    node.obfs = opts.obfs || opts.mode
    node.obfsHost = opts['obfs-host'] || opts.host
    node.pluginOpts = {
      ...(node.obfs ? { mode: node.obfs } : {}),
      ...(node.obfsHost ? { host: node.obfsHost } : {}),
    }
  } else if (name === 'v2ray-plugin' || name === 'v2ray') {
    node.plugin = 'v2ray-plugin'
    node.pluginOpts = {
      mode: opts.mode || 'websocket',
      ...(opts.host ? { host: opts.host } : {}),
      ...(opts.path ? { path: opts.path } : {}),
      ...(opts.tls != null ? { tls: 'true' } : {}),
    }
    if (opts.tls != null) node.tls = { enabled: true, sni: opts.host }
  } else if (name) {
    // shadow-tls / gost-plugin / restls 等原样透传，渲染器按需消费
    node.plugin = name
    node.pluginOpts = opts
  }
}

// ---- shadowsocksR ----

/**
 * ssr://base64url(host:port:protocol:method:obfs:base64url(password)/?params)
 *
 * params 里的 remarks / obfsparam / protoparam 各自还是 base64url。
 */
export function parseSsr(body: string): ProxyNode | null {
  const raw = b64decode(body)
  if (!raw) return null
  const [main, paramStr] = splitFirst(raw, '/?')
  const segs = main.split(':')
  if (segs.length < 6) return null
  // 末尾 5 段字段固定，多出来的都属于 host（裸 IPv6 会被冒号切碎）
  const tail = segs.slice(-5)
  const host = segs.slice(0, segs.length - 5).join(':')
  const [portStr, protocol, cipher, obfs, passwordB64] = tail as [string, string, string, string, string]
  const port = firstPort(portStr)
  if (!host || !port) return null

  const q = new URLSearchParams(paramStr)
  const b64param = (k: string) => {
    const v = q.get(k)
    return v ? b64decode(v) : undefined
  }
  const name = b64param('remarks') || `${host}:${port}`

  return makeNode({
    name,
    type: 'ssr',
    server: host,
    port,
    cipher,
    password: b64decode(passwordB64),
    protocol,
    protocolParam: b64param('protoparam'),
    obfs,
    obfsParam: b64param('obfsparam'),
  })
}

// ---- vmess ----

/**
 * vmess 有三种流通形态，全都要认：
 * 1. `vmess://base64(JSON)`（v2rayN，可能还在末尾挂了 `#name`）
 * 2. `vmess://uuid@host:port?encryption=none&type=ws…#name`（AEAD / XRay URI）
 * 3. `vmess://base64(security:uuid@host:port)?…#name`（Shadowrocket）
 */
export function parseVmess(body: string): ProxyNode | null {
  return parseVmessJson(body) ?? parseVmessUri(body)
}

function parseVmessJson(body: string): ProxyNode | null {
  // v2rayN 偶尔会在 base64 后再挂一个 #name，先剥掉再解码，否则 JSON.parse 必失败
  const head = body.split('#')[0]!.split('?')[0]!
  let json: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(b64decode(head))
    if (!parsed || typeof parsed !== 'object') return null
    json = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const str = (k: string) => (json[k] == null || json[k] === '' ? undefined : String(json[k]))
  const server = str('add')
  const port = Number(json.port)
  if (!server || !Number.isFinite(port) || port <= 0) return null

  const net = normalizeNetwork(str('net'))
  const security = (str('tls') || '').toLowerCase()
  const tlsOn = security === 'tls' || security === 'reality' || security === 'xtls'
  const host = str('host')?.split(',')[0]?.trim()
  const path = str('path')

  const transport: Transport | undefined =
    net === 'tcp'
      ? undefined
      : {
          network: net,
          path,
          host,
          serviceName: net === 'grpc' ? str('serviceName') || path : undefined,
        }
  const tls: TlsOptions | undefined = tlsOn
    ? {
        enabled: true,
        sni: str('sni') || host,
        alpn: parseAlpn(str('alpn')),
        fingerprint: str('fp'),
        skipCertVerify: truthy(str('allowInsecure')) || truthy(str('skip-cert-verify')),
      }
    : undefined

  const name = decodeNameFragment(body) || str('ps') || `${server}:${port}`
  return makeNode({
    name,
    type: 'vmess',
    server,
    port,
    uuid: str('id'),
    alterId: json.aid != null ? Number(json.aid) : 0,
    cipher: str('scy') || str('security') || 'auto',
    tls,
    transport,
  })
}

function parseVmessUri(body: string): ProxyNode | null {
  const parts = parseUriParts(body)
  if (!parts) return null
  const q = parts.query
  // Shadowrocket：userinfo 是 base64(security:uuid)
  let uuid = safeDecodeURIComponent(parts.userinfo)
  let cipher = pick(q, 'encryption', 'scy', 'security-method')
  if (uuid && !uuid.includes('-') && !uuid.includes(':')) {
    const decoded = b64decode(uuid)
    if (decoded.includes(':')) {
      const [m, id] = splitFirst(decoded, ':')
      cipher = cipher || m
      uuid = id
    }
  } else if (uuid.includes(':')) {
    const [m, id] = splitFirst(uuid, ':')
    cipher = cipher || m
    uuid = id
  }
  if (!uuid) return null

  const net = normalizeNetwork(pick(q, 'type', 'net', 'obfs'))
  return makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'vmess',
    server: parts.host,
    port: parts.port,
    uuid,
    alterId: Number(pick(q, 'alterId', 'aid') ?? 0) || 0,
    cipher: cipher && cipher !== 'none' ? cipher : 'auto',
    tls: tlsFromQuery(q),
    transport: transportFromQuery(net, q),
  })
}

/** 取 URI 末尾 `#name`（vmess base64 形态里 name 不在 JSON 里时用）。 */
function decodeNameFragment(body: string): string | undefined {
  const i = body.indexOf('#')
  if (i < 0) return undefined
  return safeDecodeURIComponent(body.slice(i + 1)) || undefined
}

// ---- vless ----

export function parseVless(body: string): ProxyNode | null {
  const parts = parseUriParts(body)
  if (!parts) return null
  const q = parts.query
  const uuid = safeDecodeURIComponent(parts.userinfo)
  if (!uuid) return null
  const net = normalizeNetwork(pick(q, 'type', 'net'))
  return makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'vless',
    server: parts.host,
    port: parts.port,
    uuid,
    flow: pick(q, 'flow'),
    tls: tlsFromQuery(q),
    transport: transportFromQuery(net, q),
  })
}

// ---- trojan ----

export function parseTrojan(body: string): ProxyNode | null {
  const parts = parseUriParts(body, 443)
  if (!parts) return null
  const q = parts.query
  const password = safeDecodeURIComponent(parts.userinfo)
  if (!password) return null
  const net = normalizeNetwork(pick(q, 'type', 'net'))
  return makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'trojan',
    server: parts.host,
    port: parts.port,
    password,
    // trojan 天然跑在 TLS 上，security 参数缺省也要开
    tls: tlsFromQuery(q, true),
    transport: transportFromQuery(net, q),
  })
}

// ---- hysteria2 / hysteria ----

export function parseHysteria2(body: string): ProxyNode | null {
  const parts = parseUriParts(body, 443)
  if (!parts) return null
  const q = parts.query
  const auth = safeDecodeURIComponent(parts.userinfo) || pick(q, 'auth', 'password') || ''
  const node = makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'hysteria2',
    server: parts.host,
    port: parts.port,
    password: auth,
    obfs: pick(q, 'obfs'),
    obfsPassword: pick(q, 'obfs-password', 'obfsParam', 'obfs_password'),
    ports: portsOf(q, parts.portRaw),
    tls: tlsFromQuery(q, true),
  })
  const up = Number(pick(q, 'upmbps', 'up'))
  const down = Number(pick(q, 'downmbps', 'down'))
  if (Number.isFinite(up) && up > 0) node.upMbps = up
  if (Number.isFinite(down) && down > 0) node.downMbps = down
  return node
}

/** hysteria v1：认证信息通常在 `auth` 参数里，而不是 userinfo。 */
export function parseHysteria(body: string): ProxyNode | null {
  const parts = parseUriParts(body, 443)
  if (!parts) return null
  const q = parts.query
  const node = makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'hysteria',
    server: parts.host,
    port: parts.port,
    password: safeDecodeURIComponent(parts.userinfo) || pick(q, 'auth', 'auth_str', 'auth-str') || '',
    protocol: pick(q, 'protocol'),
    obfs: pick(q, 'obfs'),
    obfsParam: pick(q, 'obfsParam', 'obfs-param', 'obfsparam'),
    ports: portsOf(q, parts.portRaw),
    tls: tlsFromQuery(q, true),
  })
  const up = Number(pick(q, 'upmbps', 'up'))
  const down = Number(pick(q, 'downmbps', 'down'))
  if (Number.isFinite(up) && up > 0) node.upMbps = up
  if (Number.isFinite(down) && down > 0) node.downMbps = down
  return node
}

// ---- tuic ----

export function parseTuic(body: string): ProxyNode | null {
  const parts = parseUriParts(body, 443)
  if (!parts) return null
  const q = parts.query
  // uuid:password —— 密码里可能还有冒号，只在第一个冒号处切
  const [rawUuid, rawPassword] = splitFirst(parts.userinfo, ':')
  const uuid = safeDecodeURIComponent(rawUuid)
  if (!uuid) return null
  return makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'tuic',
    server: parts.host,
    port: parts.port,
    uuid,
    password: safeDecodeURIComponent(rawPassword) || pick(q, 'password') || '',
    congestion: pick(q, 'congestion_control', 'congestion-controller', 'congestion'),
    protocol: pick(q, 'udp_relay_mode', 'udp-relay-mode'),
    tls: tlsFromQuery(q, true),
  })
}

// ---- anytls ----

export function parseAnytls(body: string): ProxyNode | null {
  const parts = parseUriParts(body, 443)
  if (!parts) return null
  const password = safeDecodeURIComponent(parts.userinfo)
  if (!password) return null
  return makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'anytls',
    server: parts.host,
    port: parts.port,
    password,
    tls: tlsFromQuery(parts.query, true),
  })
}

// ---- snell ----

export function parseSnell(body: string): ProxyNode | null {
  const parts = parseUriParts(body)
  if (!parts) return null
  const q = parts.query
  const psk = safeDecodeURIComponent(parts.userinfo) || pick(q, 'psk') || ''
  if (!psk) return null
  const version = Number(pick(q, 'version', 'v'))
  return makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'snell',
    server: parts.host,
    port: parts.port,
    password: psk,
    version: Number.isFinite(version) && version > 0 ? version : undefined,
    obfs: pick(q, 'obfs', 'obfs-mode'),
    obfsHost: pick(q, 'obfs-host', 'host'),
  })
}

// ---- socks5 / http ----

/**
 * socks5:// socks:// socks5+tls://（userinfo 可能是 base64(user:pass)）。
 */
export function parseSocks(body: string, tlsOn: boolean): ProxyNode | null {
  const parts = parseUriParts(body, 1080)
  if (!parts) return null
  const [username, password] = splitFirst(decodeUserinfo(parts.userinfo), ':')
  return makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'socks5',
    server: parts.host,
    port: parts.port,
    username: username || undefined,
    password: password || undefined,
    tls: tlsOn || truthy(parts.query.get('tls')) ? { enabled: true, skipCertVerify: insecureOf(parts.query) } : undefined,
  })
}

/**
 * http:// https:// 代理节点。
 *
 * 这两个 scheme 和「订阅链接」长得一模一样，误判会把用户粘进来的订阅地址
 * 变成一个假节点。所以要求 **显式端口且没有路径**——真正的 HTTP 代理 URI
 * 都写成 `http://user:pass@host:8080`，而订阅链接一定带路径。
 */
export function parseHttpProxy(body: string, tlsOn: boolean): ProxyNode | null {
  const head = body.split('#')[0]!.split('?')[0]!
  const hostPart = head.slice(head.lastIndexOf('@') + 1).replace(/\/+$/, '')
  if (hostPart.includes('/')) return null
  if (!/:\d+$/.test(hostPart)) return null

  const parts = parseUriParts(body, tlsOn ? 443 : 80)
  if (!parts) return null
  const [username, password] = splitFirst(decodeUserinfo(parts.userinfo), ':')
  return makeNode({
    name: parts.name || `${parts.host}:${parts.port}`,
    type: 'http',
    server: parts.host,
    port: parts.port,
    username: username || undefined,
    password: password || undefined,
    tls: tlsOn ? { enabled: true, skipCertVerify: insecureOf(parts.query) } : undefined,
  })
}
