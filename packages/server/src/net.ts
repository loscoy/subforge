/**
 * 抓取用户提供的 URL（订阅源）前的 SSRF 防护：
 * 仅允许 http/https，拒绝 localhost / 私网 / 链路本地（含 169.254.169.254 云元数据）等地址。
 *
 * 说明：这里只对「URL 里的字面主机名/IP」做校验，能挡住直接以内网 IP/localhost 发起的 SSRF。
 * 对「域名解析到内网 IP」的 DNS rebinding 不做处理——边缘运行时（workerd）的 fetch 本就不经过你的
 * 内网，风险有限；Node 自建若有更高要求，可在此基础上加解析后 IP 校验。
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
  // URL.hostname 对 IPv6 会带方括号，如 [::1]
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error(`订阅 URL 指向本机地址，已拒绝：${host || '(空)'}`)
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error(`订阅 URL 指向内网/保留地址，已拒绝：${host}`)
  }
  return url
}

/** 判断是否为私网/保留 IPv4（含回环、链路本地/元数据、CGNAT、0.0.0.0/8）。 */
export function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const o = m.slice(1, 5).map(Number)
  if (o.some((n) => n > 255)) return true // 非法八位组，保守拒绝
  const [a, b] = o as [number, number, number, number]
  return (
    a === 0 || // 0.0.0.0/8
    a === 127 || // 回环
    a === 10 || // 私网
    (a === 172 && b >= 16 && b <= 31) || // 私网
    (a === 192 && b === 168) || // 私网
    (a === 169 && b === 254) || // 链路本地（含 169.254.169.254 云元数据）
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64.0.0/10
  )
}

/** 判断是否为回环/唯一本地/链路本地 IPv6（含 IPv4-mapped）。 */
export function isPrivateIpv6(host: string): boolean {
  if (!host.includes(':')) return false
  const h = host.toLowerCase()
  if (h === '::1' || h === '::') return true
  // IPv4-mapped，如 ::ffff:169.254.169.254
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h)
  if (mapped) return isPrivateIpv4(mapped[1]!)
  // fc00::/7 唯一本地（fc/fd 开头），fe80::/10 链路本地（fe8/fe9/fea/feb）
  return /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
}
