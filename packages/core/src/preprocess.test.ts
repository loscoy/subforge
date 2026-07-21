import { describe, expect, it } from 'vitest'
import { makeNode, type ProxyNode } from './model.js'
import { runPipeline } from './pipeline.js'
import { applyOperations, expandRegionGroups } from './preprocess.js'
import { assembleProfile, TEMPLATES } from './presets.js'

const nodes: ProxyNode[] = [
  makeNode({ name: '🇭🇰 HK 01', type: 'trojan', server: 'a.com', port: 1 }),
  makeNode({ name: '🇭🇰 HK 01', type: 'trojan', server: 'a.com', port: 1 }), // 重复
  makeNode({ name: '🇺🇸 US 官网续费', type: 'trojan', server: 'b.com', port: 2 }),
  makeNode({ name: '🇯🇵 JP 01', type: 'trojan', server: 'c.com', port: 3 }),
]

describe('applyOperations', () => {
  it('drop + dedupe + rename', () => {
    const out = applyOperations(nodes, [
      { op: 'drop', pattern: '官网|续费' },
      { op: 'dedupe' },
      { op: 'rename', from: '\\d+', to: '' },
    ])
    expect(out).toHaveLength(2) // US 被剔除，HK 去重
    expect(out.map((n) => n.name)).toEqual(['🇭🇰 HK ', '🇯🇵 JP '])
  })
  it('keep 只保留匹配', () => {
    const out = applyOperations(nodes, [{ op: 'keep', pattern: 'HK' }])
    expect(out.every((n) => n.name.includes('HK'))).toBe(true)
  })
})

describe('expandRegionGroups', () => {
  it('autoRegion 展开为每地区一组，REGIONS 令牌被替换', () => {
    const groups = expandRegionGroups(
      [
        { name: '节点选择', type: 'select', proxies: ['REGIONS', 'DIRECT'] },
        { name: '地区', type: 'url-test', autoRegion: true },
      ],
      nodes,
    )
    const names = groups.map((g) => g.name)
    // 地区顺序：HK, JP, US
    expect(names).toContain('🇭🇰 HK')
    expect(names).toContain('🇺🇸 US')
    expect(names).toContain('🇯🇵 JP')
    const select = groups.find((g) => g.name === '节点选择')!
    expect(select.proxies).toContain('🇭🇰 HK')
    expect(select.proxies).toContain('DIRECT')
    expect(select.proxies).not.toContain('REGIONS')
  })
})

describe('模板 + 管线端到端', () => {
  it('标准模板：operations + 地区分组 + 规则 都生效', async () => {
    // 第 1、3 条完全相同 → 会被 dedupe
    const raw = ['trojan://p1@a.com:1#🇭🇰 HK 01', 'trojan://p2@b.com:2#🇺🇸 US 01', 'trojan://p1@a.com:1#🇭🇰 HK 01'].join('\n')
    const tpl = TEMPLATES.find((t) => t.key === 'standard')!
    const out = await runPipeline({ rawSubscriptions: [raw], target: 'mihomo', profile: tpl.profile })
    const yaml = (await import('js-yaml')).default
    const cfg = yaml.load(out.config) as any
    // 去重后 2 个节点
    expect(cfg.proxies).toHaveLength(2)
    const groupNames = cfg['proxy-groups'].map((g: any) => g.name)
    expect(groupNames).toContain('节点选择')
    expect(groupNames).toContain('🇭🇰 HK') // 地区自动组
    expect(groupNames).toContain('广告拦截')
    expect(cfg.rules).toContain('MATCH,节点选择')
    expect(cfg.rules.some((r: string) => r.includes('category-ads-all'))).toBe(true)
  })

  it('assembleProfile 只选部分预设', () => {
    const p = assembleProfile({ presets: ['google'], autoRegion: false })
    expect(p.groups.some((g) => g.name === 'Google')).toBe(true)
    expect(p.rules).toContain('GEOSITE,google,Google')
    expect(p.rules[p.rules.length - 1]).toBe('MATCH,节点选择')
  })
})
