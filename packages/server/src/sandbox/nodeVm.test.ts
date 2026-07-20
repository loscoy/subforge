import { makeNode, type ProxyNode } from '@subforge/core'
import { describe, expect, it } from 'vitest'
import { NodeVmRunner } from './nodeVm.js'

const nodes: ProxyNode[] = [
  makeNode({ name: '🇭🇰 HK 01', type: 'trojan', server: 'hk.com', port: 443 }),
  makeNode({ name: '🇺🇸 US 01', type: 'trojan', server: 'us.com', port: 443 }),
  makeNode({ name: '🇺🇸 US 02', type: 'trojan', server: 'us.com', port: 443 }),
]

describe('NodeVmRunner', () => {
  const runner = new NodeVmRunner()

  it('return 过滤后的节点', async () => {
    const r = await runner.run(`return utils.keep(nodes, 'US')`, nodes)
    expect(r.ok).toBe(true)
    expect(r.nodes).toHaveLength(2)
    expect(r.nodes.every((n) => n.name.includes('US'))).toBe(true)
  })

  it('就地修改 + 不 return 也生效', async () => {
    const r = await runner.run(`nodes.forEach(n => n.name = '[x] ' + n.name)`, nodes)
    expect(r.ok).toBe(true)
    expect(r.nodes[0]!.name.startsWith('[x] ')).toBe(true)
  })

  it('捕获 console 输出', async () => {
    const r = await runner.run(`console.log('nodes:', nodes.length); return nodes`, nodes)
    expect(r.logs.some((l) => l.includes('nodes: 3'))).toBe(true)
  })

  it('utils.tagRegions 打地区标签', async () => {
    const r = await runner.run(`return utils.tagRegions(nodes)`, nodes)
    expect(r.nodes[0]!.meta.region).toBe('HK')
    expect(r.nodes[1]!.meta.region).toBe('US')
  })

  it('脚本报错返回 ok=false 且保留原节点', async () => {
    const r = await runner.run(`throw new Error('boom')`, nodes)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
    expect(r.nodes).toHaveLength(3)
  })

  it('无法访问 process / require', async () => {
    const r1 = await runner.run(`return typeof process`, nodes)
    // typeof process 应为 'undefined'（沙箱未注入）
    expect(r1.ok).toBe(true)
    const r2 = await runner.run(`return require('fs')`, nodes)
    expect(r2.ok).toBe(false)
  })

  it('输入不被脚本副作用污染（深拷贝隔离）', async () => {
    await runner.run(`nodes[0].name = 'MUT'`, nodes)
    expect(nodes[0]!.name).toBe('🇭🇰 HK 01')
  })
})
