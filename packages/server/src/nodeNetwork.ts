import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import { assertPublicHttpUrl, isPrivateIpv4, isPrivateIpv6 } from './net.js'

/** 校验全部解析结果，再把其中一个已验证地址交给实际连接，避免二次 DNS 解析。 */
export async function resolvePublicAddress(host: string, timeoutMs = 3000): Promise<{ address: string; family: number }> {
  const normalized = host.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) throw new Error('Localhost is not allowed')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = isIP(normalized)
      ? [{ address: normalized, family: isIP(normalized) }]
      : await Promise.race([
          lookup(normalized, { all: true }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs) }),
        ])
    if (!addresses.length || addresses.some(({ address }) => !isIP(address) || isPrivateIpv4(address) || isPrivateIpv6(address))) {
      throw new Error('Private or reserved network address is not allowed')
    }
    return addresses[0]!
  } finally {
    clearTimeout(timer)
  }
}

const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      resolvePublicAddress(hostname).then(
        ({ address, family }) => {
          if (options.all) callback(null, [{ address, family }])
          else callback(null, address, family)
        },
        (error: Error) => callback(error, '', 0),
      )
    },
  },
})

/** 仅供订阅抓取；不替换全局 fetch，保留本地模型连接。 */
export const publicSubscriptionFetch: typeof fetch = async (input, init) => {
  const url = assertPublicHttpUrl(input instanceof Request ? input.url : String(input))
  return await undiciFetch(url, { ...init, dispatcher, redirect: 'manual' } as Parameters<typeof undiciFetch>[1]) as unknown as Response
}
