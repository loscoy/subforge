import { expect, it } from 'vitest'
import { explainDomainRoute, runPipeline } from './index.js'

it('阶段诊断准确归因重复节点、过滤和目标丢弃', async () => {
  const result = await runPipeline({
    rawSubscriptions: ['trojan://p@example.com:443#A\ntrojan://p@example.com:443#A\ntrojan://q@example.org:443#B\nvless://a-b-c@example.net:443#C'],
    sourceIds: ['source'], target: 'surge',
    profile: { groups: [], rules: [], operations: [{ op: 'dedupe' }, { op: 'drop', pattern: '^B$' }] },
  })
  expect(result.stages.find((s) => s.stage === 'operation:1')?.removed).toEqual([{ name: 'A', type: 'trojan', source: 'source' }])
  expect(result.stages.find((s) => s.stage === 'operation:2')?.removed.map((n) => n.name)).toEqual(['B'])
  expect(result.stages.find((s) => s.stage === 'target')?.removed.map((n) => n.name)).toEqual(['C'])
  expect(result.nodes.map((n) => n.name)).toEqual(['A'])
})

it('分流解释遵守后缀边界与规则顺序，未知条件不冒充确定命中', () => {
  const rules = ['DOMAIN-SUFFIX,example.com,Proxy', 'MATCH,DIRECT']
  expect(explainDomainRoute(rules, 'sub.example.com').candidate?.target).toBe('Proxy')
  expect(explainDomainRoute(rules, 'notexample.com').candidate?.target).toBe('DIRECT')
  expect(explainDomainRoute(['RULE-SET,remote,REJECT', ...rules], 'example.com').certainty).toBe('uncertain')
  expect(explainDomainRoute([...rules, 'RULE-SET,remote,REJECT'], 'example.com').certainty).toBe('matched')
  expect(explainDomainRoute(['DOMAIN,example.com', ...rules], 'example.com').certainty).toBe('uncertain')
  expect(explainDomainRoute(['MATCH,'], 'example.com').certainty).toBe('uncertain')
})
