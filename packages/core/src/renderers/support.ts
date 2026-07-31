/**
 * 各目标格式的协议支持矩阵。
 *
 * 解析器认得的协议比任何单一客户端都多，所以渲染前必须先按目标格式过滤：
 * 不支持的节点直接剔除（并留一条警告），否则它们既会写出非法配置，
 * 又会以「幽灵成员」的形式留在 proxy-groups 里让客户端整份加载失败。
 */

import type { ProxyNode, ProxyType } from '../model.js'

const MIHOMO: ReadonlySet<ProxyType> = new Set<ProxyType>([
  'vmess',
  'vless',
  'trojan',
  'ss',
  'ssr',
  'hysteria',
  'hysteria2',
  'tuic',
  'socks5',
  'http',
  'snell',
  'anytls',
])

const SINGBOX: ReadonlySet<ProxyType> = new Set<ProxyType>([
  'vmess',
  'vless',
  'trojan',
  'ss',
  'hysteria',
  'hysteria2',
  'tuic',
  'socks5',
  'http',
  'anytls',
])

const SURGE: ReadonlySet<ProxyType> = new Set<ProxyType>([
  'ss',
  'vmess',
  'trojan',
  'hysteria2',
  'socks5',
  'http',
  'snell',
])

const MATRIX: Record<string, ReadonlySet<ProxyType>> = {
  mihomo: MIHOMO,
  singbox: SINGBOX,
  surge: SURGE,
}

/** 某目标格式是否支持该协议。未知目标一律放行。 */
export function supportsType(target: string, type: ProxyType): boolean {
  const set = MATRIX[target]
  return set ? set.has(type) : true
}

/**
 * 过滤出目标格式支持的节点，并把被剔除的部分汇总成人类可读的警告。
 * `warnings` 传入时就地追加，供 pipeline 收集后回给前端。
 */
export function filterSupported(
  nodes: ProxyNode[],
  target: string,
  warnings?: string[],
): ProxyNode[] {
  const set = MATRIX[target]
  if (!set) return nodes
  const kept: ProxyNode[] = []
  const dropped = new Map<ProxyType, number>()
  for (const n of nodes) {
    if (set.has(n.type)) kept.push(n)
    else dropped.set(n.type, (dropped.get(n.type) ?? 0) + 1)
  }
  if (warnings && dropped.size) {
    for (const [type, count] of dropped) {
      warnings.push(`${target} 不支持 ${type} 协议，已跳过 ${count} 个节点`)
    }
  }
  return kept
}
