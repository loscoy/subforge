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

  it('病态筛选与重命名正则在线性时间内完成', () => {
    const long = makeNode({ name: `${'a'.repeat(50_000)}!`, type: 'trojan', server: 'x', port: 1 })
    expect(applyOperations([long], [{ op: 'keep', pattern: '(a+)+$' }])).toEqual([])
    expect(applyOperations([long], [{ op: 'rename', from: '(a+)+$', to: 'x' }])[0]!.name).toBe(long.name)
  })

  it('保留捕获组替换语义；RE2 不支持的语法走有界回退而不是中断流水线', () => {
    const renamed = applyOperations(nodes.slice(0, 1), [{ op: 'rename', from: '(HK) (\\d+)', to: '$1-$2' }])
    expect(renamed[0]!.name).toContain('HK-01')
    // 反向引用 RE2 编译不了，但本身不含易回溯构造 → 回退原生引擎后照常工作，不再抛错
    expect(() => applyOperations(nodes, [{ op: 'keep', pattern: '(HK)\\1' }])).not.toThrow()
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
    const yaml = await import('js-yaml')
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

describe('坏正则的降级行为', () => {
  const nodes = [
    makeNode({ name: 'HK 01', type: 'ss', server: '1.1.1.1', port: 1 }),
    makeNode({ name: '回国 02', type: 'ss', server: '2.2.2.2', port: 2 }),
  ]

  it('keep 用负向环视仍然可用', () => {
    expect(applyOperations(nodes, [{ op: 'keep', pattern: '^(?!.*回国).*$' }]).map((n) => n.name)).toEqual(['HK 01'])
  })

  it('无法编译的 keep 正则被跳过，节点原样通过而不抛错', () => {
    expect(applyOperations(nodes, [{ op: 'keep', pattern: '^(?!x)(a+)+$' }]).map((n) => n.name)).toEqual([
      'HK 01',
      '回国 02',
    ])
  })

  it('无法编译的 rename 正则被跳过', () => {
    expect(
      applyOperations(nodes, [{ op: 'rename', from: '[unclosed', to: 'X' }]).map((n) => n.name),
    ).toEqual(['HK 01', '回国 02'])
  })
})
