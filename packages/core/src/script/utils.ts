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

/** 节点名长度上限：远超正常取名需求，纯粹为挡住畸形输入撑爆输出。 */
const MAX_NODE_NAME_LENGTH = 256

/**
 * 清洗单个节点名里「任何目标格式下都不该出现」的字符。
 *
 * 节点名来自订阅原文（不可信）：URI 片段会经 `decodeURIComponent` 解码，
 * `%0A` 会变成真正的换行；Clash YAML 的 name 也可以是多行标量。而部分渲染器
 * （如 Surge 的 INI 风格）是按行拼接的，换行会被当成新的配置行 → 配置注入。
 *
 * 这里只剥掉换行与 C0/C1 控制字符——它们在任何格式里都不是合法名称内容；
 * 格式专属的分隔符（如 Surge 的 `,` `=`）由各渲染器自行处理，避免在这里
 * 改动 mihomo / sing-box 下本来合法的名字。
 */
export function sanitizeNodeName(name: string): string {
  const cleaned = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0)!
      return !(code <= 0x1f || (code >= 0x7f && code <= 0x9f))
    })
    .join('')
    .trim()
  const bounded = cleaned.length > MAX_NODE_NAME_LENGTH ? cleaned.slice(0, MAX_NODE_NAME_LENGTH).trim() : cleaned
  return bounded || '未命名节点'
}

/** 批量清洗节点名。渲染前统一走一遍，让所有渲染器共享同一份保证。 */
export function sanitizeNodeNames(nodes: ProxyNode[]): ProxyNode[] {
  return nodes.map((n) => {
    const name = sanitizeNodeName(n.name)
    return name === n.name ? n : { ...n, name }
  })
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
