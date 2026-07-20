import type { ProxyNode } from './model.js'

/** 代理组类型（对齐 Mihomo proxy-groups）。 */
export type GroupType = 'select' | 'url-test' | 'fallback' | 'load-balance' | 'relay'

/**
 * 代理组定义。节点成员有三种来源，可叠加：
 * - `proxies`: 显式列出的组名/节点名（如 'DIRECT'、其他组名）
 * - `includeAll`: 是否纳入全部订阅节点
 * - `filter`: 正则，按节点名筛选纳入（配合 includeAll 收窄，或独立使用）
 */
export interface ProxyGroupDef {
  name: string
  type: GroupType
  proxies?: string[]
  includeAll?: boolean
  /** 正则字符串，匹配节点 name */
  filter?: string
  /** 反向正则：命中则排除 */
  excludeFilter?: string
  url?: string
  interval?: number
  tolerance?: number
  icon?: string
}

/** 规则来源：既支持内联规则，也支持远程 rule-provider 引用。 */
export interface RuleProviderDef {
  name: string
  type: 'http' | 'file'
  behavior: 'domain' | 'ipcidr' | 'classical'
  url?: string
  path?: string
  interval?: number
  format?: 'yaml' | 'text'
}

/**
 * 一份「转换配置档」：描述如何把订阅节点组织成一份可用配置。
 */
export interface ConversionProfile {
  /** 代理组 */
  groups: ProxyGroupDef[]
  /** 内联规则（原样写入 rules，如 'DOMAIN-SUFFIX,google.com,🚀 节点选择'） */
  rules: string[]
  /** 远程规则集 */
  ruleProviders?: RuleProviderDef[]
  /** 直接合并进最终配置顶层的字段（dns、tun 等），渲染器透传 */
  extraConfig?: Record<string, unknown>
}

/** 渲染上下文：节点 + 配置档。渲染器据此产出目标格式文本。 */
export interface RenderContext {
  nodes: ProxyNode[]
  profile: ConversionProfile
}
