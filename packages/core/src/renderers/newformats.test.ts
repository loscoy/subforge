import { describe, expect, it } from 'vitest'
import type { ConversionProfile } from '../config.js'
import { makeNode, type ProxyNode } from '../model.js'
import { clashRuleToSingbox, nodeToSingbox, renderSingbox } from './singbox.js'
import { nodeToSurge, renderSurge } from './surge.js'

const hk: ProxyNode = makeNode({
  name: '🇭🇰 HK', type: 'vmess', server: 'hk.com', port: 443, uuid: 'u1', cipher: 'auto',
  tls: { enabled: true, sni: 'hk.com' }, transport: { network: 'ws', path: '/p', host: 'cdn.com' }, meta: {},
})
const us: ProxyNode = makeNode({
  name: '🇺🇸 US', type: 'trojan', server: 'us.com', port: 443, password: 'pw',
  tls: { enabled: true, sni: 'us.com' }, meta: {},
})
const ss: ProxyNode = makeNode({ name: 'SS', type: 'ss', server: 's.com', port: 8388, cipher: 'aes-256-gcm', password: 'p', meta: {} })

const profile: ConversionProfile = {
  groups: [
    { name: '🚀', type: 'select', includeAll: true, proxies: ['DIRECT'] },
    { name: '🇭🇰', type: 'url-test', filter: 'HK', url: 'http://cp.cloudflare.com', interval: 300 },
  ],
  rules: ['DOMAIN-SUFFIX,google.com,🚀', 'IP-CIDR,1.1.1.1/32,🚀', 'MATCH,🚀'],
}

describe('sing-box renderer', () => {
  it('vmess ws+tls outbound', () => {
    const o = nodeToSingbox(hk)
    expect(o.type).toBe('vmess')
    expect(o.uuid).toBe('u1')
    expect((o.transport as any).type).toBe('ws')
    expect((o.tls as any).server_name).toBe('hk.com')
  })
  it('ss → shadowsocks', () => {
    const o = nodeToSingbox(ss)
    expect(o.type).toBe('shadowsocks')
    expect(o.method).toBe('aes-256-gcm')
  })
  it('规则翻译', () => {
    expect(clashRuleToSingbox('DOMAIN-SUFFIX,x.com,G').obj).toEqual({ domain_suffix: ['x.com'], outbound: 'G' })
    expect(clashRuleToSingbox('MATCH,G').final).toBe('G')
  })
  it('完整输出为合法 JSON 且含 route.final', () => {
    const cfg = JSON.parse(renderSingbox({ nodes: [hk, us], profile }))
    expect(cfg.outbounds.some((o: any) => o.type === 'selector' && o.tag === '🚀')).toBe(true)
    expect(cfg.outbounds.some((o: any) => o.type === 'urltest' && o.tag === '🇭🇰')).toBe(true)
    expect(cfg.outbounds.some((o: any) => o.tag === 'DIRECT')).toBe(true)
    expect(cfg.route.final).toBe('🚀')
    expect(cfg.route.rules).toHaveLength(2) // MATCH 归入 final，不进 rules
  })
})

describe('surge renderer', () => {
  it('各协议行格式', () => {
    expect(nodeToSurge(ss)).toContain('ss, s.com, 8388, encrypt-method=aes-256-gcm')
    expect(nodeToSurge(hk)).toContain('vmess, hk.com, 443, username=u1')
    expect(nodeToSurge(hk)).toContain('ws=true')
    expect(nodeToSurge(us)).toContain('trojan, us.com, 443, password=pw')
    // vless 不支持 → 注释
    const vless = makeNode({ name: 'V', type: 'vless', server: 'v.com', port: 443, uuid: 'x', meta: {} })
    expect(nodeToSurge(vless)).toContain('暂不被 Surge 支持')
  })
  it('完整输出含分组与 FINAL 规则', () => {
    const text = renderSurge({ nodes: [hk, us], profile })
    expect(text).toContain('[Proxy Group]')
    expect(text).toContain('🇭🇰 = url-test')
    expect(text).toContain('url=http://cp.cloudflare.com')
    expect(text).toContain('FINAL,🚀')
    expect(text).not.toContain('MATCH,')
  })
})
