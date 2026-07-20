import type { ProxyNode } from '../model.js'

/** 常见地区关键词 → 区域码 + emoji。用于从节点名猜测地区。 */
const REGION_TABLE: Array<{ re: RegExp; code: string; emoji: string }> = [
  { re: /香港|🇭🇰|hong ?kong|\bhk\b/i, code: 'HK', emoji: '🇭🇰' },
  { re: /台湾|台灣|🇹🇼|taiwan|\btw\b/i, code: 'TW', emoji: '🇹🇼' },
  { re: /日本|🇯🇵|japan|\bjp\b|tokyo|osaka/i, code: 'JP', emoji: '🇯🇵' },
  { re: /新加坡|狮城|🇸🇬|singapore|\bsg\b/i, code: 'SG', emoji: '🇸🇬' },
  { re: /美国|美國|🇺🇸|united ?states|\bus\b|los ?angeles|silicon/i, code: 'US', emoji: '🇺🇸' },
  { re: /韩国|韓國|🇰🇷|korea|\bkr\b|seoul/i, code: 'KR', emoji: '🇰🇷' },
  { re: /英国|英國|🇬🇧|united ?kingdom|\buk\b|london/i, code: 'UK', emoji: '🇬🇧' },
  { re: /德国|德國|🇩🇪|germany|\bde\b/i, code: 'DE', emoji: '🇩🇪' },
  { re: /俄罗斯|🇷🇺|russia|\bru\b/i, code: 'RU', emoji: '🇷🇺' },
  { re: /印度|🇮🇳|india|\bin\b/i, code: 'IN', emoji: '🇮🇳' },
]

/** 从节点名推断地区码，识别不到返回 undefined。 */
export function regionOf(name: string): string | undefined {
  for (const r of REGION_TABLE) if (r.re.test(name)) return r.code
  return undefined
}

/** 从节点名推断地区 emoji。 */
export function emojiOf(name: string): string | undefined {
  for (const r of REGION_TABLE) if (r.re.test(name)) return r.emoji
  return undefined
}

/** 从节点名解析倍率，如 "x1.5" "1.5x" "倍率2"。识别不到返回 undefined。 */
export function multiplierOf(name: string): number | undefined {
  const m = name.match(/(?:x|X|倍率)\s*([\d.]+)|([\d.]+)\s*[xX]/)
  const v = m ? Number(m[1] ?? m[2]) : NaN
  return Number.isFinite(v) ? v : undefined
}

/** 基于 server+port+type 去重（保留首个）。 */
export function dedupe(nodes: ProxyNode[]): ProxyNode[] {
  const seen = new Set<string>()
  const out: ProxyNode[] = []
  for (const n of nodes) {
    const key = `${n.type}|${n.server}|${n.port}|${n.uuid ?? n.password ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(n)
    }
  }
  return out
}

/** 正则过滤（保留匹配 name 的节点）。 */
export function keep(nodes: ProxyNode[], pattern: string | RegExp): ProxyNode[] {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return nodes.filter((n) => re.test(n.name))
}

/** 正则过滤（剔除匹配 name 的节点）。 */
export function drop(nodes: ProxyNode[], pattern: string | RegExp): ProxyNode[] {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return nodes.filter((n) => !re.test(n.name))
}

/** 名称去重后缀：同名节点自动追加 " 2" " 3" …，保证配置内唯一。 */
export function uniquifyNames(nodes: ProxyNode[]): ProxyNode[] {
  const count = new Map<string, number>()
  return nodes.map((n) => {
    const c = count.get(n.name) ?? 0
    count.set(n.name, c + 1)
    return c === 0 ? n : { ...n, name: `${n.name} ${c + 1}` }
  })
}

/** 给每个节点补上 meta.region / meta.emoji（若能识别）。 */
export function tagRegions(nodes: ProxyNode[]): ProxyNode[] {
  return nodes.map((n) => {
    const region = n.meta.region ?? regionOf(n.name)
    const emoji = n.meta.emoji ?? emojiOf(n.name)
    return { ...n, meta: { ...n.meta, region, emoji } }
  })
}

/** 打包给脚本用的工具集。 */
export const scriptUtils = {
  regionOf,
  emojiOf,
  multiplierOf,
  dedupe,
  keep,
  drop,
  uniquifyNames,
  tagRegions,
}

export type ScriptUtils = typeof scriptUtils
