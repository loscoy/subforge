import { z } from 'zod'
import type { AgentModelConfig } from './agent/runner.js'
import type { WebToolsConfig } from './agent/webTools.js'
import { decryptSecret, encryptSecret, maskSecret } from './secrets.js'
import type { Storage } from './storage/types.js'

/**
 * 运行时设置：存数据库（kv 表的 settings 行），由 Web 设置页维护。
 *
 * 与「引导配置」（ServerConfig，来自环境变量）的分工：
 * - 引导配置管「怎么把服务跑起来」：端口、库路径、ADMIN_TOKEN、SETTINGS_KEY；
 * - 运行时设置管「服务跑起来之后干什么」：用哪个模型、联不联网、远端 MCP 开不开。
 *
 * 数据库是唯一真相，不再读 OPENAI_* / MCP_TOKEN / AGENT_WEB_* 环境变量。
 * 每次用时现读（见 routes/app.ts），所以改完即时生效，无需重启；
 * 也因此 Node 与 Workers 两个运行时行为完全一致。
 *
 * 密钥字段（agent.apiKey / web.tavilyApiKey / mcpToken）在库里是密文，
 * 解密不出来就当没配置——见 secrets.ts。
 */

export const WEB_PROVIDERS = ['openrouter', 'tavily', 'exa'] as const
/** OpenRouter 搜索引擎候选（仅 provider=openrouter 时有意义） */
export const SEARCH_ENGINES = ['auto', 'native', 'exa', 'firecrawl', 'parallel', 'perplexity'] as const
/** 抓取引擎候选：perplexity 只做搜索，不适用于抓取，故不在此列 */
export const FETCH_ENGINES = ['auto', 'native', 'exa', 'firecrawl', 'parallel'] as const

export const DEFAULT_MAX_TOOL_CALLS = 5
export const DEFAULT_MAX_RESULTS = 5

export type WebProvider = (typeof WEB_PROVIDERS)[number]

/** 解密后的设置（仅服务端内部使用，绝不整体序列化给前端）。 */
export interface Settings {
  agent: {
    baseURL?: string
    model?: string
    apiKey?: string
  }
  web: {
    /** 搜索与抓取各自选供应商，可以混搭（如 search=openrouter + fetch=exa） */
    searchProvider?: WebProvider
    fetchProvider?: WebProvider
    searchEngine: string
    fetchEngine: string
    maxToolCalls: number
    maxResults: number
    tavilyApiKey?: string
    exaApiKey?: string
  }
  mcpToken?: string
}

/** 库里的原始形态：密钥字段是 `enc:v1:…` 密文。 */
interface StoredSettings {
  agent?: { baseURL?: string; model?: string; apiKey?: string }
  web?: {
    searchProvider?: WebProvider
    fetchProvider?: WebProvider
    /** 旧结构：单一 provider 同时供给搜索与抓取。读取时迁移到上面两个字段。 */
    provider?: WebProvider
    searchEngine?: string
    fetchEngine?: string
    maxToolCalls?: number
    maxResults?: number
    tavilyApiKey?: string
    exaApiKey?: string
  }
  mcpToken?: string
}

/** 密钥字段回传前端的形态：只说配没配 + 掩码，绝不回明文。 */
export interface SecretView {
  configured: boolean
  hint?: string
}

export interface SettingsView {
  agent: { baseURL: string; model: string; apiKey: SecretView }
  web: {
    searchProvider: WebProvider | null
    fetchProvider: WebProvider | null
    searchEngine: string
    fetchEngine: string
    maxToolCalls: number
    maxResults: number
    tavilyApiKey: SecretView
    exaApiKey: SecretView
  }
  mcpToken: SecretView
  /** SETTINGS_KEY 是否可用；false 时密钥无法保存，前端应禁用相关输入并说明原因 */
  canStoreSecrets: boolean
}

const SETTINGS_ROW = 'settings'

/** 密钥字段的三态：缺席=不变，字符串=设为新值，null=清除。 */
const secretPatch = z.union([z.string().trim().min(1), z.null()]).optional()

export const settingsPatchSchema = z.object({
  agent: z
    .object({
      baseURL: z.string().trim().optional(),
      model: z.string().trim().optional(),
      apiKey: secretPatch,
    })
    .optional(),
  web: z
    .object({
      searchProvider: z.union([z.enum(WEB_PROVIDERS), z.null()]).optional(),
      fetchProvider: z.union([z.enum(WEB_PROVIDERS), z.null()]).optional(),
      searchEngine: z.enum(SEARCH_ENGINES).optional(),
      fetchEngine: z.enum(FETCH_ENGINES).optional(),
      maxToolCalls: z.number().int().min(1).max(25).optional(),
      maxResults: z.number().int().min(1).max(25).optional(),
      tavilyApiKey: secretPatch,
      exaApiKey: secretPatch,
    })
    .optional(),
  mcpToken: secretPatch,
})

export type SettingsPatch = z.infer<typeof settingsPatchSchema>

/** JSON 损坏时回落到空设置而不是让整个 /api 挂掉。 */
function parseStored(raw: string | undefined): StoredSettings {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as StoredSettings) : {}
  } catch {
    console.warn('⚠ settings JSON 损坏，已按空设置处理')
    return {}
  }
}

interface ResolvedSecrets {
  apiKey?: string
  tavilyApiKey?: string
  exaApiKey?: string
  mcpToken?: string
}

function resolve(stored: StoredSettings, secrets: ResolvedSecrets): Settings {
  const web = stored.web
  return {
    agent: {
      baseURL: stored.agent?.baseURL || undefined,
      model: stored.agent?.model || undefined,
      apiKey: secrets.apiKey,
    },
    web: {
      // 旧结构里单一的 provider 同时供给两个能力，迁移时按此语义铺开
      searchProvider: web?.searchProvider ?? web?.provider,
      fetchProvider: web?.fetchProvider ?? web?.provider,
      searchEngine: web?.searchEngine ?? 'auto',
      fetchEngine: web?.fetchEngine ?? 'auto',
      maxToolCalls: web?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
      maxResults: web?.maxResults ?? DEFAULT_MAX_RESULTS,
      tavilyApiKey: secrets.tavilyApiKey,
      exaApiKey: secrets.exaApiKey,
    },
    mcpToken: secrets.mcpToken,
  }
}

/** 读取并解密设置。解不开的密钥字段一律视为未配置。 */
export async function loadSettings(storage: Storage, keyMaterial: string | undefined): Promise<Settings> {
  const stored = parseStored(await storage.getSettings())
  const decrypt = (blob: string | undefined) => (blob ? decryptSecret(blob, keyMaterial) : Promise.resolve(undefined))
  const [apiKey, tavilyApiKey, exaApiKey, mcpToken] = await Promise.all([
    decrypt(stored.agent?.apiKey),
    decrypt(stored.web?.tavilyApiKey),
    decrypt(stored.web?.exaApiKey),
    decrypt(stored.mcpToken),
  ])
  return resolve(stored, { apiKey, tavilyApiKey, exaApiKey, mcpToken })
}

/** 密钥三态合并：undefined 保持原密文，null 清除，字符串加密后写入。 */
async function mergeSecret(
  current: string | undefined,
  patch: string | null | undefined,
  keyMaterial: string | undefined,
): Promise<string | undefined> {
  if (patch === undefined) return current
  if (patch === null) return undefined
  if (!keyMaterial) throw new SettingsKeyMissingError()
  return encryptSecret(patch, keyMaterial)
}

/** provider 与密钥同为三态：缺席=不变，值=设为该供应商，null=关掉这个能力。 */
function mergeProvider(current: WebProvider | undefined, patch: WebProvider | null | undefined) {
  if (patch === undefined) return current
  return patch === null ? undefined : patch
}

export class SettingsKeyMissingError extends Error {
  constructor() {
    super('未配置 SETTINGS_KEY，无法保存密钥。请给部署设置该环境变量后重试。')
    this.name = 'SettingsKeyMissingError'
  }
}

/** 按三态语义合并并写回。返回合并后的解密设置，供调用方直接回显。 */
export async function saveSettings(
  storage: Storage,
  keyMaterial: string | undefined,
  patch: SettingsPatch,
): Promise<Settings> {
  const stored = parseStored(await storage.getSettings())
  const next: StoredSettings = {
    agent: {
      baseURL: patch.agent?.baseURL ?? stored.agent?.baseURL,
      model: patch.agent?.model ?? stored.agent?.model,
      apiKey: await mergeSecret(stored.agent?.apiKey, patch.agent?.apiKey, keyMaterial),
    },
    web: {
      // 写回时只保留新结构：旧的单一 provider 字段就此消失，不留双份真相
      searchProvider: mergeProvider(stored.web?.searchProvider ?? stored.web?.provider, patch.web?.searchProvider),
      fetchProvider: mergeProvider(stored.web?.fetchProvider ?? stored.web?.provider, patch.web?.fetchProvider),
      searchEngine: patch.web?.searchEngine ?? stored.web?.searchEngine,
      fetchEngine: patch.web?.fetchEngine ?? stored.web?.fetchEngine,
      maxToolCalls: patch.web?.maxToolCalls ?? stored.web?.maxToolCalls,
      maxResults: patch.web?.maxResults ?? stored.web?.maxResults,
      tavilyApiKey: await mergeSecret(stored.web?.tavilyApiKey, patch.web?.tavilyApiKey, keyMaterial),
      exaApiKey: await mergeSecret(stored.web?.exaApiKey, patch.web?.exaApiKey, keyMaterial),
    },
    mcpToken: await mergeSecret(stored.mcpToken, patch.mcpToken, keyMaterial),
  }
  await storage.setSettings(JSON.stringify(next))
  return loadSettings(storage, keyMaterial)
}

function viewOf(plain: string | undefined): SecretView {
  return plain ? { configured: true, hint: maskSecret(plain) } : { configured: false }
}

/** 转成可以安全回传前端的形态。 */
export function toSettingsView(settings: Settings, canStoreSecrets: boolean): SettingsView {
  return {
    agent: {
      baseURL: settings.agent.baseURL ?? '',
      model: settings.agent.model ?? '',
      apiKey: viewOf(settings.agent.apiKey),
    },
    web: {
      searchProvider: settings.web.searchProvider ?? null,
      fetchProvider: settings.web.fetchProvider ?? null,
      searchEngine: settings.web.searchEngine,
      fetchEngine: settings.web.fetchEngine,
      maxToolCalls: settings.web.maxToolCalls,
      maxResults: settings.web.maxResults,
      tavilyApiKey: viewOf(settings.web.tavilyApiKey),
      exaApiKey: viewOf(settings.web.exaApiKey),
    },
    mcpToken: viewOf(settings.mcpToken),
    canStoreSecrets,
  }
}

/**
 * 联网工具配置。两个能力都没选供应商时返回 undefined。
 * 选了供应商但缺对应 key 的能力会在 buildWebCapability 里被跳过（失败关闭），
 * 所以这里不做 key 校验——那属于「哪些工具真的装得上」的判断，归 webTools.ts。
 */
export function toWebToolsConfig(settings: Settings): WebToolsConfig | undefined {
  const { searchProvider, fetchProvider } = settings.web
  if (!searchProvider && !fetchProvider) return undefined
  return {
    searchProvider,
    fetchProvider,
    searchEngine: settings.web.searchEngine,
    fetchEngine: settings.web.fetchEngine,
    maxToolCalls: settings.web.maxToolCalls,
    maxResults: settings.web.maxResults,
    tavilyApiKey: settings.web.tavilyApiKey,
    exaApiKey: settings.web.exaApiKey,
  }
}

/** 模型配置。三件套缺一不可，否则 Agent 不可用。 */
export function toAgentConfig(settings: Settings): AgentModelConfig | undefined {
  const { baseURL, model, apiKey } = settings.agent
  if (!baseURL || !model || !apiKey) return undefined
  return { baseURL, model, apiKey, webTools: toWebToolsConfig(settings) }
}

export const SETTINGS_KV_KEY = SETTINGS_ROW
