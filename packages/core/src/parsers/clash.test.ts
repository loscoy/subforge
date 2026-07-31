import { describe, expect, it } from 'vitest'
import { parseSubscription } from './index.js'
import { parseClashYaml } from './clash.js'

const CLASH_YAML = `
port: 7890
proxies:
  - name: "🇭🇰 香港 01"
    type: vmess
    server: hk.example.com
    port: 443
    uuid: uuid-hk
    alterId: 0
    cipher: auto
    network: ws
    tls: true
    servername: hk.example.com
    ws-opts:
      path: /ray
      headers:
        Host: cdn.example.com
  - name: "🇺🇸 US 01"
    type: trojan
    server: us.example.com
    port: 443
    password: pw-us
    sni: us.example.com
    skip-cert-verify: true
  - name: "SS 节点"
    type: ss
    server: ss.example.com
    port: 8388
    cipher: aes-256-gcm
    password: ss-pw
  - name: "SSR 节点"
    type: ssr
    server: ssr.example.com
    port: 1234
    cipher: aes-256-cfb
    password: ssr-pw
    protocol: auth_aes128_md5
    protocol-param: 1234:abc
    obfs: tls1.2_ticket_auth
    obfs-param: cloud.example.com
  - name: "不支持"
    type: vmess1
    server: x.com
    port: 1
proxy-groups:
  - name: PROXY
    type: select
`

describe('parseClashYaml', () => {
  it('解析 Clash YAML proxies，跳过不支持类型', () => {
    const nodes = parseClashYaml(CLASH_YAML)
    expect(nodes).toHaveLength(4) // 未知的 vmess1 被跳过
    const vmess = nodes[0]!
    expect(vmess.type).toBe('vmess')
    expect(vmess.name).toBe('🇭🇰 香港 01')
    expect(vmess.uuid).toBe('uuid-hk')
    expect(vmess.transport?.network).toBe('ws')
    expect(vmess.transport?.path).toBe('/ray')
    expect(vmess.transport?.host).toBe('cdn.example.com')
    expect(vmess.tls?.enabled).toBe(true)
    expect(vmess.tls?.sni).toBe('hk.example.com')

    const trojan = nodes[1]!
    expect(trojan.type).toBe('trojan')
    expect(trojan.password).toBe('pw-us')
    expect(trojan.tls?.skipCertVerify).toBe(true)

    const ss = nodes[2]!
    expect(ss.type).toBe('ss')
    expect(ss.cipher).toBe('aes-256-gcm')

    const ssr = nodes[3]!
    expect(ssr.type).toBe('ssr')
    expect(ssr.protocol).toBe('auth_aes128_md5')
    expect(ssr.protocolParam).toBe('1234:abc')
    expect(ssr.obfs).toBe('tls1.2_ticket_auth')
    expect(ssr.obfsParam).toBe('cloud.example.com')
  })

  it('非 Clash / 无 proxies 返回空', () => {
    expect(parseClashYaml('foo: bar')).toEqual([])
    expect(parseClashYaml('not yaml: [')).toEqual([])
  })

  it('parseSubscription 自动识别 Clash YAML 订阅', () => {
    const nodes = parseSubscription(CLASH_YAML)
    expect(nodes).toHaveLength(4)
    expect(nodes[0]!.type).toBe('vmess')
  })

  it('parseSubscription 仍优先按 URI 解析', () => {
    const nodes = parseSubscription('trojan://p@a.com:443#A')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.type).toBe('trojan')
  })
})
