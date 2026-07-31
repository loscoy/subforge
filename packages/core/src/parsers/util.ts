/** 解析器共用工具。 */

/**
 * 宽容的 base64 解码：兼容 urlsafe、缺省 padding、内部换行。
 *
 * 注意先剥掉所有空白再补 padding——机场订阅常按 76 字符折行，
 * 若把换行也算进长度，补出来的 padding 会是错的，解出乱码。
 */
export function b64decode(input: string): string {
  const s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  const padded = pad ? s + '='.repeat(4 - pad) : s
  return Buffer.from(padded, 'base64').toString('utf-8')
}

/** 判断字符串是否像一段 base64（订阅内容常整体 base64）。 */
export function looksLikeBase64(input: string): boolean {
  const s = input.trim()
  if (s.length < 8) return false
  return /^[A-Za-z0-9+/\-_=\s]+$/.test(s) && !s.includes('://')
}

/**
 * userinfo 解码：优先按 base64 解（SIP002 老式），失败或结果不含 ':' 时按 URL 解码。
 * 覆盖 `ss://base64(method:pass)@host` 与 `ss://method:urlencoded(pass)@host` 两种形态。
 */
export function decodeUserinfo(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  // 明文形态：本身就带冒号（method:password），只需 URL 解码
  if (s.includes(':')) return safeDecodeURIComponent(s)
  const decoded = b64decode(s)
  // base64 解出来必须含冒号才算 method:password，否则退回原文
  return decoded.includes(':') ? decoded : safeDecodeURIComponent(s)
}

/** decodeURIComponent 的安全版：非法转义序列时原样返回。 */
export function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 从 URI 的 hash（#name）取节点名，做 URL 解码。 */
export function decodeName(hash: string | undefined, fallback: string): string {
  if (!hash) return fallback
  return safeDecodeURIComponent(hash.replace(/^#/, '')) || fallback
}

/** 把 alpn 字符串（逗号分隔）拆成数组。 */
export function parseAlpn(v: string | null | undefined): string[] | undefined {
  if (!v) return undefined
  const arr = v.split(',').map((s) => s.trim()).filter(Boolean)
  return arr.length ? arr : undefined
}

/** query 参数转真布尔（"1"/"true" → true）。 */
export function truthy(v: string | null | undefined): boolean {
  if (v == null) return false
  const s = v.toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === ''
}

/** 拆出 `scheme://body`，scheme 统一小写。不含 `://` 返回 null。 */
export function splitScheme(uri: string): { scheme: string; body: string } | null {
  const i = uri.indexOf('://')
  if (i <= 0) return null
  return { scheme: uri.slice(0, i).toLowerCase(), body: uri.slice(i + 3) }
}

export interface UriParts {
  /** `@` 之前的原始 userinfo（未解码），无则为 '' */
  userinfo: string
  host: string
  /** 首个端口；端口跳跃时为区间里的第一个 */
  port: number
  /** 原始端口串，可能是 "443,8000-9000" 这类端口跳跃写法 */
  portRaw: string
  query: URLSearchParams
  /** 已 URL 解码的 #name */
  name: string
}

/**
 * 手写的 `userinfo@host:port/?query#name` 拆解。
 *
 * 不用 `new URL()`：节点 URI 的 userinfo 里常有未转义的 `:` `/`，
 * 名称里常有未转义的中文和 `#`，WHATWG URL 会直接抛错或截错字段。
 */
export function parseUriParts(body: string, defaultPort?: number): UriParts | null {
  let rest = body
  // 1) #name —— 取第一个 '#'，其后全部算名称（名称里可能还有 '#'）
  let name = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    name = safeDecodeURIComponent(rest.slice(hashIdx + 1))
    rest = rest.slice(0, hashIdx)
  }
  // 2) ?query
  let query = new URLSearchParams()
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) {
    query = new URLSearchParams(rest.slice(qIdx + 1))
    rest = rest.slice(0, qIdx)
  }
  // 3) 去掉末尾的路径分隔符（hy2://pw@host:443/ 这种写法）
  rest = rest.replace(/\/+$/, '')
  // 4) userinfo@hostport —— 从最后一个 '@' 切，userinfo 里的 '@' 才不会截错
  let userinfo = ''
  const atIdx = rest.lastIndexOf('@')
  if (atIdx >= 0) {
    userinfo = rest.slice(0, atIdx)
    rest = rest.slice(atIdx + 1)
  }
  const hp = splitHostPort(rest, defaultPort)
  if (!hp) return null
  return { userinfo, host: hp.host, port: hp.port, portRaw: hp.portRaw, query, name }
}

/** 拆 `host:port`，兼容 IPv6 字面量（`[::1]:443`）与端口跳跃（`443,8000-9000`）。 */
export function splitHostPort(
  input: string,
  defaultPort?: number,
): { host: string; port: number; portRaw: string } | null {
  const s = input.trim()
  if (!s) return null
  let host: string
  let portRaw = ''
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    if (end < 0) return null
    host = s.slice(0, end + 1)
    if (s[end + 1] === ':') portRaw = s.slice(end + 2)
  } else {
    const i = s.lastIndexOf(':')
    // 无冒号 → 只有 host；多个冒号且没方括号 → 裸 IPv6，整体当 host
    if (i < 0 || s.indexOf(':') !== i) {
      host = s
    } else {
      host = s.slice(0, i)
      portRaw = s.slice(i + 1)
    }
  }
  if (!host) return null
  const port = portRaw ? firstPort(portRaw) : defaultPort
  if (!port || !Number.isFinite(port) || port <= 0 || port > 65535) return null
  return { host, port, portRaw }
}

/** 端口跳跃串取第一个可用端口："8000-9000,443" → 8000。 */
export function firstPort(raw: string): number | undefined {
  const first = raw.split(/[,;]/)[0]?.split('-')[0]?.trim()
  const n = Number(first)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** 端口串是否描述了「端口跳跃」（含多个端口或区间）。 */
export function isPortHopping(raw: string): boolean {
  return /[,;-]/.test(raw)
}

/** 从 query 里按多个候选 key 取第一个非空值。 */
export function pick(q: URLSearchParams, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = q.get(k)
    if (v != null && v !== '') return v
  }
  return undefined
}

/** 解析 `k=v;k2=v2` 形式的插件参数（SIP002 plugin / snell obfs-opts）。 */
export function parsePluginOpts(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const i = seg.indexOf('=')
    if (i < 0) out[seg] = 'true'
    else out[seg.slice(0, i).trim()] = seg.slice(i + 1).trim()
  }
  return out
}
