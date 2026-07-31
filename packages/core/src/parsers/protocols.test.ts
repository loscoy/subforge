/**
 * 覆盖「粘贴节点只解析出一个」那一类问题的回归用例。
 *
 * 每条用例都对应一种真实机场/客户端会吐出的 URI 形态，历史上它们
 * 要么被端口解析截断、要么根本没有对应的解析器，于是整批节点静默消失。
 */
import { describe, expect, it } from 'vitest'
import { parseSubscription, parseUri, splitNodeTokens } from './index.js'

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')
const b64url = (s: string) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('ss', () => {
  it('SIP002 带 plugin 参数不再丢节点', () => {
    const uri = `ss://${b64('aes-256-gcm:pw')}@1.1.1.1:8388?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dwww.bing.com#HK`
    const n = parseUri(uri)!
    expect(n).not.toBeNull()
    expect(n.port).toBe(8388) // 曾经因为把 "8388?plugin=…" 当端口而变成 NaN
    expect(n.cipher).toBe('aes-256-gcm')
    expect(n.plugin).toBe('obfs')
    expect(n.obfs).toBe('http')
    expect(n.obfsHost).toBe('www.bing.com')
    expect(n.pluginOpts).toEqual({ mode: 'http', host: 'www.bing.com' })
  })

  it('v2ray-plugin 参数与 tls 一起解出', () => {
    const uri = `ss://${b64('aes-128-gcm:pw')}@a.com:443?plugin=v2ray-plugin%3Bmode%3Dwebsocket%3Btls%3Bhost%3Dx.com%3Bpath%3D%2Fws#V2`
    const n = parseUri(uri)!
    expect(n.plugin).toBe('v2ray-plugin')
    expect(n.pluginOpts).toMatchObject({ mode: 'websocket', host: 'x.com', path: '/ws', tls: 'true' })
    expect(n.tls?.enabled).toBe(true)
  })

  it('明文 userinfo（ss2022）密码做 URL 解码', () => {
    const n = parseUri(`ss://2022-blake3-aes-256-gcm:${encodeURIComponent('aB+/=cD')}@a.com:8388#S`)!
    expect(n.cipher).toBe('2022-blake3-aes-256-gcm')
    expect(n.password).toBe('aB+/=cD')
  })

  it('老式整体 base64 且密码里含 @', () => {
    const n = parseUri(`ss://${b64('aes-256-gcm:p@ss@1.1.1.1:8388')}#Old`)!
    expect(n.password).toBe('p@ss')
    expect(n.server).toBe('1.1.1.1')
    expect(n.port).toBe(8388)
  })

  it('IPv6 字面量保留方括号', () => {
    const n = parseUri(`ss://${b64('aes-256-gcm:pw')}@[2001:db8::1]:8388#v6`)!
    expect(n.server).toBe('[2001:db8::1]')
    expect(n.port).toBe(8388)
  })
})

describe('ssr', () => {
  it('解析 ssr 全字段并 base64 解出备注', () => {
    const payload =
      `1.1.1.1:8388:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:${b64url('pw')}` +
      `/?obfsparam=${b64url('cloud.example.com')}&protoparam=${b64url('64')}&remarks=${b64url('🇭🇰 香港')}`
    const n = parseUri(`ssr://${b64url(payload)}`)!
    expect(n.type).toBe('ssr')
    expect(n.name).toBe('🇭🇰 香港')
    expect(n.server).toBe('1.1.1.1')
    expect(n.port).toBe(8388)
    expect(n.cipher).toBe('aes-256-cfb')
    expect(n.password).toBe('pw')
    expect(n.protocol).toBe('auth_aes128_md5')
    expect(n.protocolParam).toBe('64')
    expect(n.obfs).toBe('tls1.2_ticket_auth')
    expect(n.obfsParam).toBe('cloud.example.com')
  })
})

describe('vmess', () => {
  it('base64 JSON 后面挂 #name 也能解', () => {
    const conf = { v: '2', ps: '', add: 'a.com', port: '443', id: 'u1', net: 'tcp' }
    const n = parseUri(`vmess://${b64(JSON.stringify(conf))}#我的节点`)!
    expect(n.type).toBe('vmess')
    expect(n.name).toBe('我的节点') // 曾经因为把 "#我的节点" 一起 base64 解码而 JSON 解析失败
  })

  it('AEAD / XRay 的 uuid@host:port 形式', () => {
    const n = parseUri('vmess://u-1@a.com:443?encryption=none&type=ws&path=%2Fp&host=h.com&security=tls#VM')!
    expect(n.type).toBe('vmess')
    expect(n.uuid).toBe('u-1')
    expect(n.transport?.network).toBe('ws')
    expect(n.transport?.path).toBe('/p')
    expect(n.transport?.host).toBe('h.com')
    expect(n.tls?.enabled).toBe(true)
  })

  it('Shadowrocket 的 base64(security:uuid) 形式', () => {
    const n = parseUri(`vmess://${b64('auto:u-2')}@a.com:443?obfs=websocket&path=%2Fw#SR`)!
    expect(n.uuid).toBe('u-2')
    expect(n.cipher).toBe('auto')
    expect(n.transport?.network).toBe('ws')
  })

  it('port 为数字、host 为逗号分隔时取第一个', () => {
    const conf = { ps: 'X', add: 'a.com', port: 443, id: 'u1', net: 'ws', host: 'h1.com,h2.com', tls: 'tls' }
    const n = parseUri(`vmess://${b64(JSON.stringify(conf))}`)!
    expect(n.port).toBe(443)
    expect(n.transport?.host).toBe('h1.com')
  })
})

describe('hysteria / tuic / anytls / snell', () => {
  it('hysteria v1（认证在 auth 参数里）', () => {
    const n = parseUri('hysteria://a.com:443?protocol=udp&auth=pw&peer=s.com&upmbps=50&downmbps=100&obfs=xplus#H1')!
    expect(n.type).toBe('hysteria')
    expect(n.password).toBe('pw')
    expect(n.protocol).toBe('udp')
    expect(n.upMbps).toBe(50)
    expect(n.downMbps).toBe(100)
    expect(n.tls?.sni).toBe('s.com')
  })

  it('hysteria2 端口跳跃取首个端口并保留区间', () => {
    const n = parseUri('hysteria2://pw@a.com:443?mport=443%2C8000-9000&sni=s.com#H2')!
    expect(n.port).toBe(443)
    expect(n.ports).toBe('443,8000-9000')
  })

  it('tuic 密码里含冒号只在第一个冒号处切', () => {
    const n = parseUri('tuic://uuid-x:pa:ss@a.com:443?congestion_control=bbr#T')!
    expect(n.uuid).toBe('uuid-x')
    expect(n.password).toBe('pa:ss')
    expect(n.congestion).toBe('bbr')
  })

  it('anytls / snell', () => {
    const a = parseUri('anytls://pw@a.com:443?sni=s.com&insecure=1#A')!
    expect(a.type).toBe('anytls')
    expect(a.tls?.skipCertVerify).toBe(true)

    const s = parseUri('snell://psk1@a.com:443?version=4&obfs=http&obfs-host=x.com#S')!
    expect(s.type).toBe('snell')
    expect(s.password).toBe('psk1')
    expect(s.version).toBe(4)
    expect(s.obfsHost).toBe('x.com')
  })
})

describe('socks5 / http', () => {
  it('socks5 明文与 base64 两种 userinfo', () => {
    expect(parseUri('socks5://user:pass@a.com:1080#S')!.username).toBe('user')
    const n = parseUri(`socks://${b64('user2:pass2')}@a.com:1080#S2`)!
    expect(n.type).toBe('socks5')
    expect(n.username).toBe('user2')
    expect(n.password).toBe('pass2')
  })

  it('http 代理需要显式端口', () => {
    expect(parseUri('http://user:pass@a.com:8080#H')!.type).toBe('http')
    expect(parseUri('https://a.com:8080#H')!.tls?.enabled).toBe(true)
  })

  it('订阅链接不会被误判成 http 节点', () => {
    // 带路径 → 是订阅地址而非代理节点
    expect(parseUri('https://sub.example.com/link/abcd?clash=1')).toBeNull()
    expect(parseUri('https://example.com')).toBeNull()
  })
})

describe('parseSubscription', () => {
  it('空格分隔粘贴也能全部解析', () => {
    const nodes = parseSubscription('trojan://p1@a.com:443#A trojan://p2@b.com:443#B')
    expect(nodes.map((n) => n.name)).toEqual(['A', 'B'])
  })

  it('不会把名称里的空格当成分隔符', () => {
    const nodes = parseSubscription('trojan://p1@a.com:443#香港 01')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.name).toBe('香港 01')
  })

  it('base64 订阅按 76 字符折行也能解', () => {
    const inner = ['trojan://p1@a.com:443#A', 'trojan://p2@b.com:443#B', 'trojan://p3@c.com:443#C'].join('\n')
    const wrapped = b64(inner).replace(/(.{20})/g, '$1\n')
    expect(parseSubscription(wrapped)).toHaveLength(3)
  })

  it('base64 包裹的 Clash YAML 也能识别', () => {
    const yamlText = 'proxies:\n  - {name: A, type: ss, server: a.com, port: 8388, cipher: aes-256-gcm, password: p}\n'
    expect(parseSubscription(b64(yamlText))).toHaveLength(1)
  })

  it('混合协议整段粘贴：一个都不能少', () => {
    const raw = [
      `ss://${b64('aes-256-gcm:pw')}@1.1.1.1:8388?plugin=obfs-local%3Bobfs%3Dhttp#SS`,
      `ssr://${b64url(`2.2.2.2:8388:origin:aes-256-cfb:plain:${b64url('pw')}/?remarks=${b64url('SSR')}`)}`,
      `vmess://${b64(JSON.stringify({ ps: 'VM', add: 'a.com', port: '443', id: 'u1', net: 'tcp' }))}`,
      'vless://u1@b.com:443?type=ws&security=tls&path=%2Fp#VL',
      'trojan://pw@c.com:443?sni=s.com#TJ',
      'hysteria2://pw@d.com:443#HY2',
      'hysteria://e.com:443?auth=pw#HY1',
      'tuic://uuid:pw@f.com:443#TU',
      'anytls://pw@g.com:443#AT',
      'snell://psk@h.com:443?version=4#SN',
      'socks5://u:p@i.com:1080#SK',
      'http://u:p@j.com:8080#HT',
    ].join('\n')
    const nodes = parseSubscription(raw)
    expect(nodes).toHaveLength(12)
    expect(nodes.map((n) => n.type)).toEqual([
      'ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria2', 'hysteria', 'tuic', 'anytls', 'snell', 'socks5', 'http',
    ])
  })

  it('无法识别的行被跳过而不影响其它节点', () => {
    const nodes = parseSubscription(['garbage', 'wireguard://x@a.com:51820#W', 'trojan://p@b.com:443#OK'].join('\n'))
    expect(nodes.map((n) => n.name)).toEqual(['OK'])
  })
})

describe('splitNodeTokens', () => {
  it('区分 ss 与 ssr、hysteria 与 hysteria2 前缀', () => {
    const tokens = splitNodeTokens('ss://a ssr://b hysteria://c hysteria2://d hy2://e')
    expect(tokens).toEqual(['ss://a', 'ssr://b', 'hysteria://c', 'hysteria2://d', 'hy2://e'])
  })
})
