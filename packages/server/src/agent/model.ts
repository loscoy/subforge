import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { AgentModelConfig } from './runner.js'
import { normalizeToolCallIndexes } from './toolCallIndex.js'
import { injectProviderTools, type WebCapability } from './webTools.js'

/**
 * 从运行时模型配置构造一个 OpenAI 兼容 LanguageModel。
 *
 * 自定义 fetch 承担两件纯传输层的事，都无法在 AI SDK 的抽象里表达：
 * - 去程：服务端联网工具（如 openrouter:web_search）不是标准 function tool，
 *   只能把声明追加进请求体的 tools 数组（仅 webCap 有 providerTools 时）；
 * - 回程：规整 tool_calls 的 index，绕开上游稀疏数组崩溃（见 toolCallIndex.ts）。
 *
 * 不传 webCap（如起标题这类无工具场景）时只保留回程规整——它对没有工具调用的
 * 响应是无害透传。只用 WebCrypto/Web Streams，Node 与 Workers 通用。
 */
export function createAgentModel(config: AgentModelConfig, webCap?: WebCapability): LanguageModel {
  const fetchImpl: typeof fetch = async (input, init) => {
    if (webCap && webCap.providerTools.length > 0 && init && typeof init.body === 'string') {
      init = { ...init, body: injectProviderTools(init.body, webCap) }
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
