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
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; tool: string }
  | { type: 'tool-result'; tool: string }
  | { type: 'error'; error: string }
  | { type: 'done'; text: string }
export interface Meta {
  renderers: string[]
  hasAgent: boolean
  scriptDts: string
  mcp: {
    enabled: boolean
    endpoint: string
    transport: 'streamable-http'
    tools: { name: string; description: string }[]
  }
}

// ---------- 运行时设置 ----------

export const WEB_PROVIDERS = ['openrouter', 'tavily'] as const
export type WebProvider = (typeof WEB_PROVIDERS)[number]
export const SEARCH_ENGINES = ['auto', 'native', 'exa', 'firecrawl', 'parallel', 'perplexity'] as const
/** perplexity 只做搜索，不适用于抓取 */
export const FETCH_ENGINES = ['auto', 'native', 'exa', 'firecrawl', 'parallel'] as const

/** 密钥字段：服务端只回「配没配 + 掩码」，永不回明文 */
export interface SecretView {
  configured: boolean
  hint?: string
}

export interface Settings {
  agent: { baseURL: string; model: string; apiKey: SecretView }
  web: {
    provider: WebProvider | null
    searchEngine: string
    fetchEngine: string
    maxToolCalls: number
    maxResults: number
    tavilyApiKey: SecretView
  }
  mcpToken: SecretView
  /** false 表示部署没设 SETTINGS_KEY，密钥存不进去 */
  canStoreSecrets: boolean
  diagnostics: {
    runtime: string
    storage: string
    sandbox: string
    renderers: string[]
    healthcheck: boolean
  }
}

/** 密钥字段三态：不传=不变，字符串=设为新值，null=清除 */
export type SecretPatch = string | null | undefined

export interface SettingsPatch {
  agent?: { baseURL?: string; model?: string; apiKey?: SecretPatch }
  web?: {
    provider?: WebProvider | null
    searchEngine?: string
    fetchEngine?: string
    maxToolCalls?: number
    maxResults?: number
    tavilyApiKey?: SecretPatch
  }
  mcpToken?: SecretPatch
}

export interface ProbeResult {
  ok: boolean
  status?: number
  latencyMs: number
  error?: string
}
