import { makeNode, type ProxyNode } from '@subforge/core'
import { describe, expect, it } from 'vitest'
import { QuickJsRunner } from './quickjs.js'

const nodes: ProxyNode[] = [
  makeNode({ name: '🇭🇰 HK 01', type: 'trojan', server: 'hk.com', port: 443 }),
  makeNode({ name: '🇺🇸 US 01', type: 'trojan', server: 'us.com', port: 443 }),
  makeNode({ name: '🇺🇸 US 02', type: 'trojan', server: 'us.com', port: 443 }),
]

describe('QuickJsRunner（wasm 沙箱）', () => {
  const runner = new QuickJsRunner()

  it('return 过滤后的节点', async () => {
    const r = await runner.run(`return utils.keep(nodes, 'US')`, nodes)
    expect(r.ok).toBe(true)
    expect(r.nodes).toHaveLength(2)
    expect(r.nodes.every((n) => n.name.includes('US'))).toBe(true)
  })

  it('就地修改并 return', async () => {
    const r = await runner.run(`nodes.forEach(n => n.name = '[x] ' + n.name); return nodes`, nodes)
    expect(r.ok).toBe(true)
    expect(r.nodes[0]!.name.startsWith('[x] ')).toBe(true)
  })

  it('utils.tagRegions 通过 host 桥调用真实实现', async () => {
    const r = await runner.run(`return utils.tagRegions(nodes)`, nodes)
    expect(r.nodes[0]!.meta.region).toBe('HK')
    expect(r.nodes[1]!.meta.region).toBe('US')
  })

  it('捕获 console 输出', async () => {
    const r = await runner.run(`console.log('count', nodes.length); return nodes`, nodes)
    expect(r.logs.some((l) => l.includes('count') && l.includes('3'))).toBe(true)
  })

  it('脚本报错返回 ok=false 并保留原节点', async () => {
    const r = await runner.run(`throw new Error('boom')`, nodes)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
    expect(r.nodes).toHaveLength(3)
  })

  it('无法访问宿主全局（无 process）', async () => {
    const r = await runner.run(`return [{ name: typeof process, type:'trojan', server:'x', port:1, meta:{} }]`, nodes)
    expect(r.ok).toBe(true)
    expect(r.nodes[0]!.name).toBe('undefined')
  })

  it('utils 桥只暴露注册表自有函数', async () => {
    const r = await runner.run(`return utils.constructor('return process')`, nodes)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知 utils.constructor')
  })

  it('中断同步死循环', async () => {
    const limited = new QuickJsRunner(undefined, { timeoutMs: 20 })
    const started = Date.now()
    const r = await limited.run(`while (true) {}`, nodes)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('脚本执行超时')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('拒绝 Promise 返回值', async () => {
    const r = await runner.run(`return (async () => { while (true) { await null } })()`, nodes)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('仅支持同步执行')
  })
})
