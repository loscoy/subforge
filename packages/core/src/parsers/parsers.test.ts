import { describe, expect, it } from 'vitest'
import { parseSubscription, parseUri } from './index.js'
import { b64decode } from './util.js'

describe('parseUri', () => {
  it('解析 vmess（base64 JSON）', () => {
    const conf = {
      v: '2', ps: '香港 01', add: 'hk.example.com', port: '443', id: 'uuid-1234',
      aid: '0', net: 'ws', path: '/ray', host: 'cdn.example.com', tls: 'tls', scy: 'auto',
    }
    const uri = 'vmess://' + Buffer.from(JSON.stringify(conf)).toString('base64')
    const n = parseUri(uri)!
    expect(n.type).toBe('vmess')
    expect(n.name).toBe('香港 01')
    expect(n.server).toBe('hk.example.com')
    expect(n.port).toBe(443)
    expect(n.uuid).toBe('uuid-1234')
    expect(n.transport?.network).toBe('ws')
    expect(n.transport?.path).toBe('/ray')
    expect(n.tls?.enabled).toBe(true)
  })

  it('解析 vless（reality）', () => {
    const uri = 'vless://uuid-1@us.example.com:443?type=grpc&security=reality&pbk=PUBKEY&sid=abcd&sni=www.microsoft.com&flow=xtls-rprx-vision&serviceName=grpcsvc#US%20Node'
    const n = parseUri(uri)!
    expect(n.type).toBe('vless')
    expect(n.name).toBe('US Node')
    expect(n.uuid).toBe('uuid-1')
    expect(n.flow).toBe('xtls-rprx-vision')
    expect(n.tls?.realityPublicKey).toBe('PUBKEY')
    expect(n.tls?.realityShortId).toBe('abcd')
    expect(n.transport?.network).toBe('grpc')
    expect(n.transport?.serviceName).toBe('grpcsvc')
  })

  it('解析 trojan', () => {
    const uri = 'trojan://pass123@tj.example.com:443?sni=tj.example.com&allowInsecure=1#TJ'
    const n = parseUri(uri)!
    expect(n.type).toBe('trojan')
    expect(n.password).toBe('pass123')
    expect(n.tls?.sni).toBe('tj.example.com')
    expect(n.tls?.skipCertVerify).toBe(true)
  })

  it('解析 ss（SIP002 明文 userinfo）', () => {
    const userinfo = Buffer.from('aes-256-gcm:secret').toString('base64')
    const uri = `ss://${userinfo}@ss.example.com:8388#SS%20Node`
    const n = parseUri(uri)!
    expect(n.type).toBe('ss')
    expect(n.cipher).toBe('aes-256-gcm')
    expect(n.password).toBe('secret')
    expect(n.server).toBe('ss.example.com')
    expect(n.port).toBe(8388)
    expect(n.name).toBe('SS Node')
  })

  it('解析 ss（整体 base64 老式）', () => {
    const body = Buffer.from('chacha20-ietf-poly1305:pw@ss2.example.com:8389').toString('base64')
    const n = parseUri(`ss://${body}#Old`)!
    expect(n.type).toBe('ss')
    expect(n.cipher).toBe('chacha20-ietf-poly1305')
    expect(n.password).toBe('pw')
    expect(n.port).toBe(8389)
  })

  it('解析 hysteria2', () => {
    const n = parseUri('hysteria2://pw@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=xyz#HY')!
    expect(n.type).toBe('hysteria2')
    expect(n.password).toBe('pw')
    expect(n.obfs).toBe('salamander')
    expect(n.obfsPassword).toBe('xyz')
  })

  it('解析 tuic', () => {
    const n = parseUri('tuic://uuid-x:passw@tuic.example.com:443?congestion_control=bbr&sni=tuic.example.com#TUIC')!
    expect(n.type).toBe('tuic')
    expect(n.uuid).toBe('uuid-x')
    expect(n.password).toBe('passw')
    expect(n.congestion).toBe('bbr')
  })

  it('未知协议返回 null', () => {
    expect(parseUri('ftp://foo')).toBeNull()
    expect(parseUri('')).toBeNull()
  })
})

describe('parseSubscription', () => {
  it('解析多行明文订阅', () => {
    const raw = [
      'trojan://p1@a.com:443#A',
      'trojan://p2@b.com:443#B',
      'garbage-line',
    ].join('\n')
    const nodes = parseSubscription(raw)
    expect(nodes).toHaveLength(2)
    expect(nodes.map((n) => n.name)).toEqual(['A', 'B'])
  })

  it('解析整体 base64 订阅', () => {
    const inner = 'trojan://p1@a.com:443#A\ntrojan://p2@b.com:443#B'
    const raw = Buffer.from(inner).toString('base64')
    const nodes = parseSubscription(raw)
    expect(nodes).toHaveLength(2)
  })
})

describe('b64decode', () => {
  it('兼容 urlsafe 与缺省 padding', () => {
    expect(b64decode('aGVsbG8')).toBe('hello')
    expect(b64decode('aGVsbG8=')).toBe('hello')
  })
})
