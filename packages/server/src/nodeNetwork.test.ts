import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookup } from 'node:dns/promises'
import { publicSubscriptionFetch, resolvePublicAddress } from './nodeNetwork.js'
import { tcpPing } from './health.js'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
afterEach(() => vi.resetAllMocks())

describe('Node 出网边界', () => {
  it('拒绝内网及混合 DNS 结果；返回实际可连接的公网地址', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never)
    await expect(resolvePublicAddress('sub.example')).rejects.toThrow('Private')
    await expect(publicSubscriptionFetch('http://sub.example/sub')).rejects.toThrow()
    expect(await tcpPing('sub.example', 443)).toBeNull()
    vi.mocked(lookup).mockResolvedValue([{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }] as never)
    await expect(resolvePublicAddress('mixed.example')).rejects.toThrow('Private')
    vi.mocked(lookup).mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as never)
    expect(await resolvePublicAddress('public.example')).toEqual({ address: '1.1.1.1', family: 4 })
  })

  it('字面地址和特殊用途 IPv6 不绕过校验', async () => {
    for (const host of ['localhost', '127.0.0.1', '192.0.2.1', '[::1]', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:7f00:1::1']) {
      await expect(resolvePublicAddress(host)).rejects.toThrow()
    }
    expect(await resolvePublicAddress('2606:4700::1111')).toEqual({ address: '2606:4700::1111', family: 6 })
  })
})
