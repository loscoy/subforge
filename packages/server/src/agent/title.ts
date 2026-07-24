import { generateText, type LanguageModel } from 'ai'
import { createAgentModel } from './model.js'
import type { AgentModelConfig } from './runner.js'

/** 标题最长字数（超出截断加省略号）。 */
const MAX_TITLE_LEN = 20
/** 起标题只是锦上添花，不该拦住用户开聊——超时即降级成截断首句。
 *  给推理模型留够时间：它得先思考再吐标题。 */
const TITLE_TIMEOUT_MS = 12000

/** 归一化：压空白、去引号/书名号、剥掉「标题：」这类前缀标签。 */
function clean(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim()
  t = t.replace(/^(标题|title)\s*[:：]\s*/i, '')
  t = t.replace(/^["'“”「」『』]+|["'“”「」『』]+$/g, '').trim()
  return t
}

/** 从首条用户消息截断出一个降级标题（模型不可用 / 超时 / 空返回时用）。 */
export function fallbackTitle(message: string): string {
  const t = clean(message)
  if (!t) return '新对话'
  return t.length > MAX_TITLE_LEN ? `${t.slice(0, MAX_TITLE_LEN)}…` : t
}

/**
 * 用一次无工具的小请求给会话起个短标题。任何失败 / 超时都降级成截断首句，
 * 绝不抛出——本地小模型在这一步尤其容易慢或抽风，不能因此挡住建会话。
 * modelFactory 仅供测试注入，生产走 createAgentModel。
 */
export async function generateSessionTitle(
  config: AgentModelConfig,
  firstMessage: string,
  modelFactory?: () => LanguageModel,
): Promise<string> {
  const fallback = fallbackTitle(firstMessage)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS)
  try {
    const { text } = await generateText({
      model: modelFactory ? modelFactory() : createAgentModel(config),
      abortSignal: controller.signal,
      // 刻意不设 maxOutputTokens：推理模型会把这份预算全耗在思考上，导致正文标题为空
      // 而白白降级。输出本就会被下面截断到 MAX_TITLE_LEN，超长无害；时长由超时兜底。
      instructions:
        '给下面这段用户对订阅转换助手的请求起一个简短标题：不超过 12 个汉字，只概括意图。' +
        '不要标点、不要引号、不要任何前后缀，只输出标题本身。',
      prompt: firstMessage.slice(0, 500),
    })
    const t = clean(text)
    if (!t) return fallback
    return t.length > MAX_TITLE_LEN ? t.slice(0, MAX_TITLE_LEN) : t
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}
