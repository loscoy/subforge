import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import type { ConversionProfile } from '../config.js'
import { makeNode, type ProxyNode } from '../model.js'
import { nodeToMihomo, renderMihomo, resolveGroupMembers } from './mihomo.js'

const hk: ProxyNode = makeNode({
  name: '🇭🇰 HK 01', type: 'vmess', server: 'hk.com', port: 443, uuid: 'u1',
  cipher: 'auto', tls: { enabled: true, sni: 'hk.com' },
  transport: { network: 'ws', path: '/p', host: 'cdn.com' }, meta: {},
})
const us: ProxyNode = makeNode({
  name: '🇺🇸 US 01', type: 'trojan', server: 'us.com', port: 443, password: 'pw',
  tls: { enabled: true, sni: 'us.com' }, meta: {},
})

describe('nodeToMihomo', () => {
  it('vmess ws+tls 字段完整', () => {
    const m = nodeToMihomo(hk)
    expect(m.type).toBe('vmess')
    expect(m.uuid).toBe('u1')
    expect(m.network).toBe('ws')
    expect(m.tls).toBe(true)
    expect((m['ws-opts'] as any).path).toBe('/p')
    expect((m['ws-opts'] as any).headers.Host).toBe('cdn.com')
  })

  it('trojan 用 sni 字段', () => {
    const m = nodeToMihomo(us)
    expect(m.type).toBe('trojan')
    expect(m.sni).toBe('us.com')
    expect(m.password).toBe('pw')
  })

  // network: http 是 HTTP 伪装，mihomo 只读 http-opts；写成 h2-opts 会被整个忽略，
  // Host 头随之丢失，服务端按 Host 分流时直接断开（表现为 ERR_CONNECTION_CLOSED）。
  // http-opts 与 h2-opts 的形态也不同：path 是数组，headers 的值也是数组。
  it('network=http 写 http-opts（path 与 header 值都是数组）', () => {
    const n = makeNode({
      name: 'http-obfs', type: 'vmess', server: 'a.com', port: 80, uuid: 'u1', cipher: 'auto',
      transport: { network: 'http', path: '/video', host: 'cdn.com' }, meta: {},
    })
    const m = nodeToMihomo(n)
    expect(m.network).toBe('http')
    expect(m['h2-opts']).toBeUndefined()
    expect(m['http-opts']).toEqual({ method: 'GET', path: ['/video'], headers: { Host: ['cdn.com'] } })
  })

  it('network=h2 仍写 h2-opts（path 字符串、host 数组）', () => {
    const n = makeNode({
      name: 'h2', type: 'vmess', server: 'a.com', port: 443, uuid: 'u1', cipher: 'auto',
      tls: { enabled: true }, transport: { network: 'h2', path: '/p', host: 'cdn.com' }, meta: {},
    })
    const m = nodeToMihomo(n)
    expect(m.network).toBe('h2')
    expect(m['http-opts']).toBeUndefined()
    expect(m['h2-opts']).toEqual({ path: '/p', host: ['cdn.com'] })
  })

  // httpupgrade 在 mihomo 里不是合法的 network 值，而是 ws 的一个开关。
  // 原样写出去 mihomo 会拒绝加载**整份**配置，不只是这一个节点失效。
  it('httpupgrade 落成 ws + v2ray-http-upgrade，而不是非法的 network 值', () => {
    const n = makeNode({
      name: 'hu', type: 'vmess', server: 'a.com', port: 443, uuid: 'u1', cipher: 'auto',
      tls: { enabled: true }, transport: { network: 'httpupgrade', path: '/p', host: 'cdn.com' }, meta: {},
    })
    const m = nodeToMihomo(n)
    expect(m.network).toBe('ws')
    expect(m['ws-opts']).toEqual({ path: '/p', headers: { Host: 'cdn.com' }, 'v2ray-http-upgrade': true })
  })
})

describe('resolveGroupMembers', () => {
  const names = ['🇭🇰 HK 01', '🇭🇰 HK 02', '🇺🇸 US 01']
  it('includeAll 纳入全部', () => {
    expect(resolveGroupMembers({ name: 'All', type: 'select', includeAll: true }, names)).toEqual(names)
  })
  it('filter 正则筛选', () => {
    expect(resolveGroupMembers({ name: 'HK', type: 'url-test', filter: 'HK' }, names)).toEqual(['🇭🇰 HK 01', '🇭🇰 HK 02'])
  })
  it('proxies 前置 + excludeFilter', () => {
    const r = resolveGroupMembers({ name: 'Sel', type: 'select', proxies: ['DIRECT'], includeAll: true, excludeFilter: 'US' }, names)
    expect(r[0]).toBe('DIRECT')
    expect(r).not.toContain('🇺🇸 US 01')
  })
  it('空组兜底 DIRECT', () => {
    expect(resolveGroupMembers({ name: 'X', type: 'select', filter: 'NOPE' }, names)).toEqual(['DIRECT'])
  })
  it('病态 filter 不发生灾难性回溯', () => {
    const hostile = `${'a'.repeat(50_000)}!`
    expect(resolveGroupMembers({ name: 'X', type: 'select', filter: '(a+)+$' }, [hostile])).toEqual(['DIRECT'])
  })
})

describe('renderMihomo', () => {
  const profile: ConversionProfile = {
    groups: [
      { name: '🚀 节点选择', type: 'select', includeAll: true, proxies: ['DIRECT'] },
      { name: '🇭🇰 香港', type: 'url-test', filter: 'HK', url: 'http://cp.cloudflare.com', interval: 300 },
    ],
    rules: ['DOMAIN-SUFFIX,google.com,🚀 节点选择', 'MATCH,🚀 节点选择'],
  }
  it('产出合法 YAML 且结构正确', () => {
    const text = renderMihomo({ nodes: [hk, us], profile })
    const cfg = yaml.load(text) as any
    expect(cfg.proxies).toHaveLength(2)
    expect(cfg['proxy-groups']).toHaveLength(2)
    expect(cfg['proxy-groups'][1].proxies).toEqual(['🇭🇰 HK 01'])
    expect(cfg.rules[cfg.rules.length - 1]).toBe('MATCH,🚀 节点选择')
  })
})

describe('坏正则的降级行为（不得中断渲染）', () => {
  const names = ['HK 01', '回国专线', 'US 02']

  it('负向环视 filter 仍然可用（存量配置的常见写法）', () => {
    const members = resolveGroupMembers(
      { name: 'g', type: 'select', includeAll: true, filter: '^(?!.*回国).*$' },
      names,
    )
    expect(members).toEqual(['HK 01', 'US 02'])
  })

  it('无法编译的 filter 只让该条筛选失效，不抛错也不清空组', () => {
    const group = { name: 'g', type: 'select' as const, includeAll: true, filter: '^(?!x)(a+)+$' }
    expect(() => resolveGroupMembers(group, names)).not.toThrow()
    // 关键：不能退化成空组——空组会兜底成 DIRECT，等于让这部分流量绕过代理
    expect(resolveGroupMembers(group, names)).toEqual(names)
    expect(resolveGroupMembers(group, names)).not.toEqual(['DIRECT'])
  })

  it('无法编译的 excludeFilter 只让该条排除失效，其余成员保留', () => {
    const members = resolveGroupMembers(
      { name: 'g', type: 'select', includeAll: true, excludeFilter: '[unclosed' },
      names,
    )
    expect(members).toEqual(names)
  })

  it('两条筛选的降级行为一致，且各自记一条 warning', () => {
    const warnings: string[] = []
    resolveGroupMembers({ name: 'g1', type: 'select', includeAll: true, filter: '^(?!x)(a+)+$' }, names, warnings)
    resolveGroupMembers({ name: 'g2', type: 'select', includeAll: true, excludeFilter: '[unclosed' }, names, warnings)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('g1')
    expect(warnings[0]).toContain('filter')
    expect(warnings[1]).toContain('g2')
    expect(warnings[1]).toContain('excludeFilter')
  })
})
