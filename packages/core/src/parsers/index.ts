import type { ProxyNode } from '../model.js'
import { parseClashYaml } from './clash.js'
import {
  parseAnytls,
  parseHttpProxy,
  parseHysteria,
  parseHysteria2,
  parseSnell,
  parseSocks,
  parseSs,
  parseSsr,
  parseTrojan,
  parseTuic,
  parseVless,
  parseVmess,
} from './protocols.js'
import { b64decode, looksLikeBase64, splitScheme } from './util.js'

/** 支持的 URI scheme（含各家别名），也用于把粘贴的一整坨文本切成一个个节点。 */
const SCHEMES = [
  'vmess',
  'vless',
  'trojan',
  'ssr',
  'ss',
  'hysteria2',
  'hysteria',
  'hy2',
  'hy',
  'tuic',
  'anytls',
  'snell',
  'socks5+tls',
  'socks5',
  'socks',
  'https',
  'http',
] as const

/** 顺序敏感：长的 scheme 必须排在它的前缀之前（ssr 先于 ss、hysteria2 先于 hysteria）。 */
const SCHEME_SPLIT_RE = new RegExp(
  `(?=(?:^|[^A-Za-z0-9+.-])(?:${SCHEMES.map((s) => s.replace(/[+]/g, '\\+')).join('|')})://)`,
  'gi',
)

const CLASH_PROXIES_RE = /(^|\n)[ \t]*proxies[ \t]*:/

/**
 * 单节点 URI 解析。无法识别返回 null（调用方跳过）。
 */
export function parseUri(uri: string): ProxyNode | null {
  const trimmed = uri.trim()
  if (!trimmed) return null
  const split = splitScheme(trimmed)
  if (!split) return null
  const { scheme, body } = split
  if (!body) return null
  try {
    switch (scheme) {
      case 'vmess':
        return parseVmess(body)
      case 'vless':
        return parseVless(body)
      case 'trojan':
        return parseTrojan(body)
      case 'ss':
        return parseSs(body)
      case 'ssr':
        return parseSsr(body)
      case 'hysteria2':
      case 'hy2':
        return parseHysteria2(body)
      case 'hysteria':
      case 'hy':
        return parseHysteria(body)
      case 'tuic':
        return parseTuic(body)
      case 'anytls':
        return parseAnytls(body)
      case 'snell':
        return parseSnell(body)
      case 'socks':
      case 'socks5':
        return parseSocks(body, false)
      case 'socks5+tls':
        return parseSocks(body, true)
      case 'http':
        return parseHttpProxy(body, false)
      case 'https':
        return parseHttpProxy(body, true)
      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * 解析一份订阅内容：可能是整体 base64、Clash YAML、或每行（甚至空格分隔）一个 URI。
 * 返回所有成功解析的节点。
 */
export function parseSubscription(raw: string): ProxyNode[] {
  let text = raw.trim()
  if (!text) return []

  // 整体 base64（无 :// 且符合 base64 字符集）→ 先解一层。
  // 解出来既可能是 URI 列表，也可能是一份 Clash YAML。
  if (looksLikeBase64(text)) {
    const decoded = b64decode(text)
    if (decoded.includes('://') || CLASH_PROXIES_RE.test(decoded)) text = decoded
  }

  // Clash/Mihomo YAML 订阅（机场常见 ?clash 返回此格式）
  if (CLASH_PROXIES_RE.test(text)) {
    const nodes = parseClashYaml(text)
    if (nodes.length) return nodes
  }

  const nodes: ProxyNode[] = []
  for (const token of splitNodeTokens(text)) {
    const node = parseUri(token)
    if (node) nodes.push(node)
  }
  return nodes
}

/**
 * 把粘贴进来的文本切成一个个待解析的 URI。
 *
 * 先按行切，再在每行内部按「下一个已知 scheme」切一刀——用户经常把节点用空格
 * 而不是换行分隔，而单纯按空白切会把 `#香港 01` 这种未转义的名称也切碎。
 */
export function splitNodeTokens(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const piece of line.split(SCHEME_SPLIT_RE)) {
      const t = piece.trim()
      if (t) out.push(t)
    }
  }
  return out
}
