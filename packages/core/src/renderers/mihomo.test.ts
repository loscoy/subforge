import yaml from 'js-yaml'
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
