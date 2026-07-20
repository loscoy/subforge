/** 解析器共用工具。 */

/** 宽容的 base64 解码：兼容 urlsafe、缺省 padding。 */
export function b64decode(input: string): string {
  let s = input.trim().replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  if (pad) s += '='.repeat(4 - pad)
  return Buffer.from(s, 'base64').toString('utf-8')
}

/** 判断字符串是否像一段 base64（订阅内容常整体 base64）。 */
export function looksLikeBase64(input: string): boolean {
  const s = input.trim()
  if (s.length < 8) return false
  return /^[A-Za-z0-9+/\-_=\s]+$/.test(s) && !s.includes('://')
}

/** 从 URI 的 hash（#name）取节点名，做 URL 解码。 */
export function decodeName(hash: string | undefined, fallback: string): string {
  if (!hash) return fallback
  try {
    return decodeURIComponent(hash.replace(/^#/, '')) || fallback
  } catch {
    return hash.replace(/^#/, '') || fallback
  }
}

/** 把 alpn 字符串（逗号分隔）拆成数组。 */
export function parseAlpn(v: string | null | undefined): string[] | undefined {
  if (!v) return undefined
  const arr = v.split(',').map((s) => s.trim()).filter(Boolean)
  return arr.length ? arr : undefined
}

/** query 参数转真布尔（"1"/"true" → true）。 */
export function truthy(v: string | null | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes'
}
