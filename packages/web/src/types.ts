export interface UserInfo {
  upload?: number
  download?: number
  total?: number
  expire?: number
}

export interface Subscription {
  id: string
  name: string
  url?: string
  content?: string
  fetchedAt?: number
  userInfo?: UserInfo
  createdAt: number
  updatedAt: number
}

export interface ProxyGroupDef {
  name: string
  type: 'select' | 'url-test' | 'fallback' | 'load-balance' | 'relay'
  proxies?: string[]
  includeAll?: boolean
  filter?: string
  excludeFilter?: string
  url?: string
  interval?: number
  autoRegion?: boolean
}

export type NodeOp =
  | { op: 'dedupe' }
  | { op: 'tagRegions' }
  | { op: 'sortByName' }
  | { op: 'keep'; pattern: string }
  | { op: 'drop'; pattern: string }
  | { op: 'rename'; from: string; to: string }

export interface ConversionProfile {
  operations?: NodeOp[]
  groups: ProxyGroupDef[]
  rules: string[]
  ruleProviders?: unknown[]
  extraConfig?: Record<string, unknown>
}

export interface Profile {
  id: string
  name: string
  subscriptionIds: string[]
  target: string
  script?: string
  profile: ConversionProfile
  token: string
  createdAt: number
  updatedAt: number
}

export interface PreviewResult {
  ok: boolean
  before: { name: string }[]
  after: { name: string }[]
  logs: string[]
  error?: string
}

export interface AgentStep {
  tool: string
  args: unknown
  result: unknown
}
export interface AgentReply {
  text: string
  steps: AgentStep[]
}
export interface Meta {
  renderers: string[]
  hasAgent: boolean
  scriptDts: string
}
