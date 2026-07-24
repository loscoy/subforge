import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { AgentModelConfig } from './runner.js'
import { normalizeToolCallIndexes } from './toolCallIndex.js'
import { injectProviderTools, type WebCapability } from './webTools.js'

/** baseURL 是否指向 OpenRouter——只有经它转发时 session_id 粘性路由才有意义。解析失败按「否」。 */
export function isOpenRouterBaseUrl(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname.toLowerCase()
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai')
  } catch {
    return false
  }
}

/**
 * 往 OpenAI 兼容请求体（JSON 字符串）注入 session_id（≤256 字符）。
 * OpenRouter 据此做「粘性会话路由」：同一会话钉在同一上游实例，从首次成功请求起
 * 就复用 prompt 缓存（尤其利好本项目的多步 tool-loop——每步都是独立 HTTP 请求）。
 * 已有 session_id 则不覆盖；空值 / 非 JSON 请求体原样返回。纯函数，便于测试。
 */
export function injectSessionId(rawBody: string, sessionId: string): string {
  if (!sessionId) return rawBody
  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>
    if (body.session_id === undefined) body.session_id = sessionId.slice(0, 256)
    return JSON.stringify(body)
  } catch {
    return rawBody
  }
}

/**
 * 从运行时模型配置构造一个 OpenAI 兼容 LanguageModel。
 *
 * 自定义 fetch 承担三件纯传输层的事，都无法在 AI SDK 的抽象里表达：
 * - 去程：服务端联网工具（如 openrouter:web_search）不是标准 function tool，
 *   只能把声明追加进请求体的 tools 数组（仅 webCap 有 providerTools 时）；
 * - 去程：仅当经 OpenRouter 转发时注入 session_id（粘性路由 → 提升缓存命中）。
 *   按 baseURL 严格网关：直连 OpenAI / 本地 Ollama 的请求体一字不改，零影响；
 * - 回程：规整 tool_calls 的 index，绕开上游稀疏数组崩溃（见 toolCallIndex.ts）。
 *
 * 不传 webCap（如起标题这类无工具场景）时只保留回程规整——它对没有工具调用的
 * 响应是无害透传。只用 WebCrypto/Web Streams，Node 与 Workers 通用。
 */
export function createAgentModel(
  config: AgentModelConfig,
  webCap?: WebCapability,
  sessionId?: string,
): LanguageModel {
  const pinSession = !!sessionId && isOpenRouterBaseUrl(config.baseURL)
  const fetchImpl: typeof fetch = async (input, init) => {
    if (init && typeof init.body === 'string') {
      let body = init.body
      if (webCap && webCap.providerTools.length > 0) body = injectProviderTools(body, webCap)
      if (pinSession) body = injectSessionId(body, sessionId!)
      init = { ...init, body }
    }
    return normalizeToolCallIndexes(await fetch(input, init))
  }
  return createOpenAICompatible({
    name: 'subforge',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    fetch: fetchImpl,
  })(config.model)
}
