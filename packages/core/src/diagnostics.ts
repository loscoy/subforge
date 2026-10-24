import type { ProxyNode } from './model.js'
import * as yaml from 'js-yaml'

/** 对 YAML/JSON 产物按客户端配置区块比较；通用节点输出不包含这些区块。 */
export function diffConfigSections(before: string, after: string) {
  const sections = (text: string): Record<string, unknown> => {
    const config = yaml.load(text) as Record<string, any> | null
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {}
    return {
      groups: config['proxy-groups'] ?? config.outbounds?.filter((o: any) => ['selector', 'urltest'].includes(o.type)),
      rules: config.rules ?? config.route,
      dns: config.dns,
      tun: config.tun ?? config.inbounds?.filter((i: any) => i.type === 'tun'),
    }
  }
  try {
    const old = sections(before), next = sections(after)
    return ['groups', 'rules', 'dns', 'tun'].filter(key => JSON.stringify(old[key]) !== JSON.stringify(next[key]))
      .map(key => ({ field: `output.${key}`, before: old[key] ?? null, after: next[key] ?? null }))
  } catch { return [] }
}

export interface NodeChange {
  name: string
  type: string
  source?: string
}
export interface NodeDelta {
  before: number
  after: number
  added: NodeChange[]
  removed: NodeChange[]
}
export interface PipelineStage extends NodeDelta {
  stage: string
  reason: string
}

/** 多重集合差异；同名/同端点的重复节点也按实际数量记录，不输出凭据。 */
export function diffNodes(before: ProxyNode[], after: ProxyNode[]): NodeDelta {
  const subtract = (left: ProxyNode[], right: ProxyNode[]) => {
    const counts = new Map<string, number>()
    const key = (n: ProxyNode) => JSON.stringify(n)
    for (const n of right) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1)
    return left.filter((n) => {
      const count = counts.get(key(n)) ?? 0
      if (count) { counts.set(key(n), count - 1); return false }
      return true
    }).map((n) => ({ name: n.name, type: n.type, source: n.meta.source }))
  }
  return { before: before.length, after: after.length, added: subtract(after, before), removed: subtract(before, after) }
}

/** 只解释已知域名条件；未知条件挡在前面时不能声称命中后面的兜底。 */
export function explainDomainRoute(rules: string[], domain: string) {
  const host = domain.trim().toLowerCase().replace(/\.$/, '')
  if (!host || /[\s/:]/.test(host)) throw new Error('Enter a domain name without a URL or port')
  const unknown: { index: number; rule: string; reason: string }[] = []
  for (const [index, rule] of rules.entries()) {
    const parts = rule.split(',').map((s) => s.trim())
    const [rawType, value, target] = parts
    const type = rawType?.toUpperCase()
    if (['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'MATCH', 'FINAL'].includes(type || '') &&
      (!value || ((type === 'MATCH' || type === 'FINAL') ? parts.length !== 2 : parts.length !== 3 || !target))) {
      unknown.push({ index, rule, reason: '规则格式无效，无法确定客户端如何处理' })
      continue
    }
    const candidate = value?.toLowerCase()
    let matches: boolean
    if (type === 'DOMAIN') matches = host === candidate
    else if (type === 'DOMAIN-SUFFIX') matches = host === candidate || host.endsWith('.' + candidate)
    else if (type === 'DOMAIN-KEYWORD') matches = !!candidate && host.includes(candidate)
    else if (type === 'MATCH' || type === 'FINAL') matches = true
    else {
      unknown.push({ index, rule, reason: '依赖规则集、DNS、IP 或客户端运行时条件，静态域名信息不足' })
      continue
    }
    if (matches) return {
      certainty: unknown.length ? 'uncertain' : 'matched', domain: host,
      candidate: { index, rule, target: type === 'MATCH' || type === 'FINAL' ? value : target },
      unknown,
      limitation: '仅解释规则顺序；实际 DNS、组选择、测速与连接结果需在客户端验证。',
    }
  }
  return { certainty: unknown.length ? 'uncertain' : 'unmatched', domain: host, unknown, limitation: '没有静态确定的匹配；客户端默认路由行为未验证。' }
}
