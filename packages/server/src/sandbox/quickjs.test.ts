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

  it('中断 async 死循环（await 不能绕过超时）', async () => {
    const limited = new QuickJsRunner(undefined, { timeoutMs: 20 })
    const started = Date.now()
    const r = await limited.run(`return (async () => { while (true) { await null } })()`, nodes)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('脚本执行超时')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('支持 async 脚本：await 已决值', async () => {
    const r = await runner.run(`const kept = await Promise.resolve(utils.keep(nodes, 'US')); return kept`, nodes)
    expect(r.ok).toBe(true)
    expect(r.nodes).toHaveLength(2)
    expect(r.nodes.every((n) => n.name.includes('US'))).toBe(true)
  })

  it('支持 async 脚本：Promise.all', async () => {
    const r = await runner.run(
      `return await Promise.all(nodes.map(async (n) => ({ ...n, name: '[a] ' + n.name })))`,
      nodes,
    )
    expect(r.ok).toBe(true)
    expect(r.nodes.every((n) => n.name.startsWith('[a] '))).toBe(true)
  })

  it('async 脚本抛错时保留原始错误信息', async () => {
    const r = await runner.run(`await null; throw new Error('boom')`, nodes)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
  })

  it('await 永远不会完成的操作时立即报错，而不是挂住', async () => {
    const started = Date.now()
    const r = await runner.run(`await new Promise(() => {}); return nodes`, nodes)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('永远不会完成')
    // 靠的是「队列已空仍 pending」而不是等超时，所以必须远快于 timeoutMs
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('override：支持 Sub-Store 风格的 async main(config)', async () => {
    const r = await runner.runOverride(
      `async function main(config) { config.mode = await Promise.resolve('rule'); return config }`,
      { mode: 'global' },
    )
    expect(r.ok).toBe(true)
    expect(r.config?.mode).toBe('rule')
  })
})
