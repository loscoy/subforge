import type { ConversionProfile, NodeOp, ProxyGroupDef } from './config.js'

const TEST_URL = 'https://www.gstatic.com/generate_204'
const INTERVAL = 300

/** 分流规则预设：每项贡献一个分组 + 若干规则（用 mihomo GEOSITE/GEOIP 与域名，开箱即用）。 */
export interface RulePreset {
  key: string
  label: string
  /** 该分类的专属分组（可选，默认路由到「节点选择」） */
  group?: ProxyGroupDef
  rules: string[]
}

const via = (name: string): ProxyGroupDef => ({ name, type: 'select', proxies: ['节点选择', 'DIRECT'] })

export const RULE_PRESETS: RulePreset[] = [
  {
    key: 'adblock',
    label: '去广告',
    group: { name: '广告拦截', type: 'select', proxies: ['REJECT', 'DIRECT'] },
    rules: ['GEOSITE,category-ads-all,广告拦截'],
  },
  {
    key: 'cn',
    label: '国内直连',
    group: { name: '国内直连', type: 'select', proxies: ['DIRECT', '节点选择'] },
    rules: ['GEOSITE,cn,国内直连', 'GEOIP,CN,国内直连,no-resolve'],
  },
  { key: 'google', label: 'Google', group: via('Google'), rules: ['GEOSITE,google,Google'] },
  { key: 'youtube', label: 'YouTube', group: via('YouTube'), rules: ['GEOSITE,youtube,YouTube'] },
  {
    key: 'netflix',
    label: 'Netflix',
    group: via('Netflix'),
    rules: ['GEOSITE,netflix,Netflix', 'GEOIP,netflix,Netflix,no-resolve'],
  },
  {
    key: 'telegram',
    label: 'Telegram',
    group: via('Telegram'),
    rules: ['GEOSITE,telegram,Telegram', 'GEOIP,telegram,Telegram,no-resolve'],
  },
  {
    key: 'ai',
    label: 'AI',
    group: via('AI'),
    rules: [
      'DOMAIN-SUFFIX,openai.com,AI',
      'DOMAIN-SUFFIX,anthropic.com,AI',
      'DOMAIN-SUFFIX,claude.ai,AI',
      'DOMAIN-SUFFIX,gemini.google.com,AI',
    ],
  },
]

/** 常用代理组（供 UI 一键添加）。 */
export const COMMON_GROUPS = {
  select: { name: '节点选择', type: 'select', proxies: ['自动选择', 'REGIONS', 'DIRECT'], includeAll: true },
  autoSelect: { name: '自动选择', type: 'url-test', includeAll: true, url: TEST_URL, interval: INTERVAL },
  regions: { name: '地区分组', type: 'url-test', autoRegion: true, url: TEST_URL, interval: INTERVAL },
} satisfies Record<string, ProxyGroupDef>

export interface AssembleOptions {
  /** 勾选的规则预设 key */
  presets?: string[]
  /** 地区自动分组 */
  autoRegion?: boolean
  /** 自动选择（url-test 全部节点） */
  autoSelect?: boolean
  /** 去重 */
  dedupe?: boolean
  /** 打地区标签 */
  tagRegions?: boolean
  /** 剔除关键词（正则） */
  dropPattern?: string
}

/** 根据勾选项组装一份 ConversionProfile。 */
export function assembleProfile(opts: AssembleOptions = {}): ConversionProfile {
  const operations: NodeOp[] = []
  if (opts.dropPattern) operations.push({ op: 'drop', pattern: opts.dropPattern })
  if (opts.dedupe) operations.push({ op: 'dedupe' })
  if (opts.tagRegions) operations.push({ op: 'tagRegions' })

  const groups: ProxyGroupDef[] = [COMMON_GROUPS.select]
  if (opts.autoSelect) groups.push(COMMON_GROUPS.autoSelect)
  if (opts.autoRegion) groups.push(COMMON_GROUPS.regions)

  const rules: string[] = []
  const chosen = RULE_PRESETS.filter((p) => opts.presets?.includes(p.key))
  for (const p of chosen) {
    if (p.group) groups.push(p.group)
    rules.push(...p.rules)
  }
  rules.push('MATCH,节点选择')

  return { operations, groups, rules }
}

/** 现成模板。 */
export interface Template {
  key: string
  label: string
  description: string
  profile: ConversionProfile
}

export const TEMPLATES: Template[] = [
  {
    key: 'blank',
    label: '空白',
    description: '只有一个「节点选择」组和兜底规则，从零搭。',
    profile: {
      groups: [{ name: '节点选择', type: 'select', includeAll: true, proxies: ['DIRECT'] }],
      rules: ['MATCH,节点选择'],
    },
  },
  {
    key: 'standard',
    label: '标准分流',
    description: '去重 + 地区自动分组 + 自动选择 + 常用分流（去广告/国内直连/流媒体/AI）。',
    profile: assembleProfile({
      dedupe: true,
      tagRegions: true,
      autoRegion: true,
      autoSelect: true,
      presets: ['adblock', 'cn', 'google', 'youtube', 'netflix', 'telegram', 'ai'],
    }),
  },
  {
    key: 'minimal',
    label: '极简',
    description: '去重 + 地区自动分组，规则只保留国内直连兜底。',
    profile: assembleProfile({ dedupe: true, tagRegions: true, autoRegion: true, presets: ['cn'] }),
  },
]
