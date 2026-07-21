import { makeNode, runPipeline, type ProxyNode } from '@subforge/core'
import { describe, expect, it } from 'vitest'
import { NodeVmRunner } from './nodeVm.js'
import { QuickJsRunner } from './quickjs.js'

// 一个精简版的 Sub-Store/mihomo override 脚本：按名字分出「香港/美国」组
const OVERRIDE = `
function main(config) {
  const proxies = config.proxies || [];
  const names = proxies.map(p => p.name);
  const hk = names.filter(n => /HK|香港/.test(n));
  const us = names.filter(n => /US|美国/.test(n));
  const enableLog = (typeof $arguments !== 'undefined') && $arguments.log;
  if (enableLog) console.log('nodes', proxies.length);
  return {
    proxies: proxies,
    'proxy-groups': [
      { name: '🚀 选择', type: 'select', proxies: ['香港', '美国'] },
      { name: '香港', type: 'url-test', proxies: hk.length ? hk : ['DIRECT'] },
      { name: '美国', type: 'url-test', proxies: us.length ? us : ['DIRECT'] },
    ],
    rules: ['MATCH,🚀 选择'],
  };
}
`

const nodes: ProxyNode[] = [
  makeNode({ name: '🇭🇰 HK 01', type: 'trojan', server: 'hk.com', port: 443, password: 'p1' }),
  makeNode({ name: '🇺🇸 US 01', type: 'trojan', server: 'us.com', port: 443, password: 'p2' }),
]

describe.each([
  ['NodeVmRunner', () => new NodeVmRunner()],
  ['QuickJsRunner', () => new QuickJsRunner()],
])('override 覆写脚本 - %s', (_name, make) => {
  const runner = make()

  it('runOverride 调用 main(config) 返回完整配置', async () => {
    const r = await runner.runOverride(OVERRIDE, { proxies: nodes.map((n) => ({ name: n.name })) }, {})
    expect(r.ok).toBe(true)
    const groups = r.config!['proxy-groups'] as any[]
    expect(groups).toHaveLength(3)
    expect(groups.find((g) => g.name === '香港').proxies).toEqual(['🇭🇰 HK 01'])
    expect(groups.find((g) => g.name === '美国').proxies).toEqual(['🇺🇸 US 01'])
  })

  it('$arguments 传入生效', async () => {
    const r = await runner.runOverride(OVERRIDE, { proxies: [{ name: 'x' }] }, { log: 'true' })
    expect(r.ok).toBe(true)
    expect(r.logs.some((l) => l.includes('nodes'))).toBe(true)
  })

  it('main 报错时 ok=false', async () => {
    const r = await runner.runOverride('function main(){ throw new Error("bad") }', { proxies: [] }, {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('bad')
  })
})

describe('runPipeline 自动识别 override 脚本', () => {
  it('override 脚本 → 输出 main 返回的配置（忽略 profile 组）', async () => {
    const raw = 'trojan://p1@hk.com:443#🇭🇰 HK 01\ntrojan://p2@us.com:443#🇺🇸 US 01'
    const out = await runPipeline({
      rawSubscriptions: [raw],
      target: 'mihomo',
      profile: { groups: [{ name: 'IGNORED', type: 'select', includeAll: true }], rules: ['MATCH,IGNORED'] },
      script: OVERRIDE,
      runner: new NodeVmRunner(),
    })
    expect(out.config).toContain('香港')
    expect(out.config).toContain('美国')
    expect(out.config).not.toContain('IGNORED') // profile 组被忽略，用脚本的
  })
})
