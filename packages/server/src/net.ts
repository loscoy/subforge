/**
 * 抓取用户提供的 URL（订阅源）前的 SSRF 防护：
 * 仅允许 http/https，拒绝 localhost / 私网 / 链路本地（含 169.254.169.254 云元数据）等地址。
 *
 * 说明：这里只对「URL 里的字面主机名/IP」做校验。调用方还必须禁用自动重定向，并对每一跳重新校验。
 * 对「域名解析到内网 IP」的 DNS rebinding 不做处理——边缘运行时（workerd）的 fetch 本就不经过你的
 * 内网；Node 自建若有更高要求，需额外做 DNS 解析后校验与地址固定。
 */

/** 校验并返回一个可安全抓取的 http(s) URL；不安全则抛错。 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`非法的订阅 URL：${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`订阅 URL 协议不被允许（仅 http/https）：${url.protocol}`)
  }
  if (url.username || url.password) {
    throw new Error('订阅 URL 不允许包含用户名或密码')
  }
  // URL.hostname 对 IPv6 会带方括号，如 [::1]
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error(`订阅 URL 指向本机地址，已拒绝：${host || '(空)'}`)
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error(`订阅 URL 指向内网/保留地址，已拒绝：${host}`)
  }
  return url
}

/** 判断是否为私网/保留 IPv4（含回环、链路本地/元数据、文档网段和组播）。 */
export function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const o = m.slice(1, 5).map(Number)
  if (o.some((n) => n > 255)) return true // 非法八位组，保守拒绝
  const [a, b, c] = o as [number, number, number, number]
  return (
    a === 0 || // 0.0.0.0/8
    a === 127 || // 回环
    a === 10 || // 私网
    (a === 172 && b >= 16 && b <= 31) || // 私网
    (a === 192 && b === 168) || // 私网
    (a === 169 && b === 254) || // 链路本地（含 169.254.169.254 云元数据）
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 192 && b === 0 && c === 0) || // IETF 协议分配 / TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // 基准测试网段
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // 组播与保留地址
  )
}

/** 判断是否为回环/唯一本地/链路本地 IPv6（含 IPv4-mapped）。 */
export function isPrivateIpv6(host: string): boolean {
  if (!host.includes(':')) return false
  const parts = parseIpv6(host)
  if (!parts) return true
  const [first] = parts
  if (parts.every((part) => part === 0) || parts.slice(0, 7).every((part) => part === 0)) return true
  // IPv4-mapped / compatible 地址按末 32 位重新走 IPv4 判定。
  if (parts.slice(0, 5).every((part) => part === 0) && (parts[5] === 0 || parts[5] === 0xffff)) {
    const ipv4 = `${parts[6]! >> 8}.${parts[6]! & 0xff}.${parts[7]! >> 8}.${parts[7]! & 0xff}`
    return isPrivateIpv4(ipv4)
  }
  return (
    (first! & 0xfe00) === 0xfc00 || // fc00::/7 唯一本地
    (first! & 0xffc0) === 0xfe80 || // fe80::/10 链路本地
    (first! & 0xffc0) === 0xfec0 || // fec0::/10 已废弃站点本地
    (first! & 0xff00) === 0xff00 || // 组播
    (parts[0] === 0x2001 && parts[1] === 0x0db8) // 文档网段
  )
}

function parseIpv6(host: string): number[] | undefined {
  const halves = host.toLowerCase().split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return undefined
  const missing = 8 - left.length - right.length
  if (missing < (halves.length === 2 ? 1 : 0)) return undefined
  const raw = [...left, ...Array(missing).fill('0'), ...right]
  if (raw.length !== 8 || raw.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined
  return raw.map((part) => Number.parseInt(part, 16))
}
