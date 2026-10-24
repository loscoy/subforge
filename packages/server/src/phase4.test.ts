import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { checkNodes, tcpPing } from './health.js'
import { parseUserInfo, remainingBytes } from './userinfo.js'
import { makeNode } from '@subforge/core'

describe('parseUserInfo', () => {
  it('解析完整头', () => {
    const info = parseUserInfo('upload=100; download=200; total=1000; expire=1700000000')!
    expect(info).toEqual({ upload: 100, download: 200, total: 1000, expire: 1700000000 })
    expect(remainingBytes(info)).toBe(700)
  })
  it('部分字段', () => {
    expect(parseUserInfo('total=500')).toEqual({ total: 500 })
  })
  it('空/无效返回 undefined', () => {
    expect(parseUserInfo(null)).toBeUndefined()
    expect(parseUserInfo('garbage')).toBeUndefined()
  })
})

describe('tcpPing / checkNodes', () => {
  it('即使本机端口可连接，也拒绝测活内网目标', async () => {
    const server = net.createServer()
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
    const port = (server.address() as net.AddressInfo).port

    const ok = await tcpPing('127.0.0.1', port, 1000)
    await new Promise<void>((res) => server.close(() => res()))
    expect(ok).toBeNull()
    const dead = await tcpPing('127.0.0.1', port, 500)
    expect(dead).toBeNull()
  })

  it('checkNodes 保留被地址策略拒绝的节点结果与顺序', async () => {
    const server = net.createServer()
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
    const port = (server.address() as net.AddressInfo).port
    const nodes = [
      makeNode({ name: 'alive', type: 'trojan', server: '127.0.0.1', port }),
      makeNode({ name: 'dead', type: 'trojan', server: '127.0.0.1', port: 1 }),
    ]
    const results = await checkNodes(nodes, 4, 800)
    await new Promise<void>((res) => server.close(() => res()))
    expect(results.map((r) => [r.name, r.latency])).toEqual([['alive', null], ['dead', null]])
  })
})
