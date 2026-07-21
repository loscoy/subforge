import type { NodeOp, ProxyGroupDef } from './config.js'
import type { ProxyNode } from './model.js'
import { dedupe, drop, emojiOf, keep, regionOf, tagRegions } from './script/utils.js'

/** 按顺序执行声明式节点操作。 */
export function applyOperations(nodes: ProxyNode[], ops: NodeOp[]): ProxyNode[] {
  let ns = nodes
  for (const op of ops) {
    switch (op.op) {
      case 'dedupe':
        ns = dedupe(ns)
        break
      case 'tagRegions':
        ns = tagRegions(ns)
        break
      case 'sortByName':
        ns = [...ns].sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'keep':
        if (op.pattern) ns = keep(ns, op.pattern)
        break
      case 'drop':
        if (op.pattern) ns = drop(ns, op.pattern)
        break
      case 'rename':
        if (op.from) {
          const re = new RegExp(op.from, 'g')
          ns = ns.map((n) => ({ ...n, name: n.name.replace(re, op.to) }))
        }
        break
    }
  }
  return ns
}

/** 常见地区顺序（用于自动分组的稳定排序）。 */
const REGION_ORDER = ['HK', 'TW', 'JP', 'SG', 'US', 'KR', 'UK', 'DE', 'RU', 'IN']

/** 按实际节点出现的地区，把一个 autoRegion 组展开成「每地区一个组」。 */
function expandOne(g: ProxyGroupDef, nodes: ProxyNode[]): ProxyGroupDef[] {
  const present = new Set<string>()
  for (const n of nodes) {
    const r = n.meta.region ?? regionOf(n.name)
    if (r) present.add(r)
  }
  const ordered = [...present].sort((a, b) => {
    const ia = REGION_ORDER.indexOf(a)
    const ib = REGION_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return ordered.map((region) => {
    const emoji = emojiOf(regionSample(region)) ?? ''
    return {
      name: `${emoji ? emoji + ' ' : ''}${region}`,
      type: g.type === 'select' ? ('url-test' as const) : g.type,
      includeAll: true,
      filter: regionFilter(region),
      url: g.url,
      interval: g.interval,
      tolerance: g.tolerance,
    }
  })
}

/**
 * 展开代理组：
 * - `autoRegion: true` 的组 → 按实际地区展开成多个 url-test 组；
 * - 其余组里 proxies 出现字面量 `REGIONS` → 替换为展开出的地区组名
 *   （让「节点选择」这类组能引用地区组）。
 */
export function expandRegionGroups(groups: ProxyGroupDef[], nodes: ProxyNode[]): ProxyGroupDef[] {
  // 先算出所有地区组
  const regionGroups: ProxyGroupDef[] = []
  for (const g of groups) if (g.autoRegion) regionGroups.push(...expandOne(g, nodes))
  const regionNames = regionGroups.map((g) => g.name)

  const out: ProxyGroupDef[] = []
  for (const g of groups) {
    if (g.autoRegion) {
      out.push(...expandOne(g, nodes))
    } else if (g.proxies?.includes('REGIONS')) {
      out.push({ ...g, proxies: g.proxies.flatMap((p) => (p === 'REGIONS' ? regionNames : [p])) })
    } else {
      out.push(g)
    }
  }
  return out
}

// 地区 → 用于筛选节点名的正则
function regionFilter(code: string): string {
  const map: Record<string, string> = {
    HK: '香港|港|HK|Hong ?Kong|🇭🇰',
    TW: '台湾|台灣|台|TW|Taiwan|🇹🇼',
    JP: '日本|东京|大阪|JP|Japan|🇯🇵',
    SG: '新加坡|狮城|SG|Singapore|🇸🇬',
    US: '美国|美國|US|United ?States|🇺🇸',
    KR: '韩国|韓國|KR|Korea|首尔|🇰🇷',
    UK: '英国|英國|UK|United ?Kingdom|London|🇬🇧',
    DE: '德国|德國|DE|Germany|🇩🇪',
    RU: '俄罗斯|RU|Russia|🇷🇺',
    IN: '印度|IN|India|🇮🇳',
  }
  return map[code] ?? code
}

function regionSample(code: string): string {
  return { HK: '香港', TW: '台湾', JP: '日本', SG: '新加坡', US: '美国', KR: '韩国', UK: '英国', DE: '德国', RU: '俄罗斯', IN: '印度' }[code] ?? code
}
