import { generateText, type LanguageModel } from 'ai'
import { createAgentModel } from './model.js'
import type { AgentModelConfig } from './runner.js'

/** 压缩是后台动作，不该让用户干等——超时就放弃这一次，下一轮再试。 */
const SUMMARY_TIMEOUT_MS = 30_000

const SUMMARY_SYSTEM = `你在压缩一段 SubForge 助手与用户的对话，供后续轮次继续工作时参考。
被压缩的原文之后不会再出现，摘要是它唯一的替身：写给「接手的自己」，不是写给用户看的总结。

按下面的结构输出，没有内容的小节整节省略：

## 目标
用户到底想达成什么。

## 约束与偏好
用户明确提过的要求、口味、禁止事项。

## 已完成
做成了什么，落到哪个对象上。

## 待办 / 卡住的地方
还没做完的、失败过的、正在等的。

## 关键事实
后续必须原样引用的东西：配置档 / 订阅 / 模板的 id 与名字、指纹（scriptRev / configRev / contentRev）、
节点数量、报错原文、用户给的 URL 与关键词。

硬性要求：
- id、指纹、报错信息一律原样抄写，不要改写、不要省略、不要编造。
- 不确定的事情不要写进来，宁可漏也不要错。
- 已经失效的信息（比如后来又改过的指纹）要注明「已过期，需重新读取」。
- 只输出摘要本身，不要寒暄、不要说「以下是摘要」。`

export type Summarizer = (input: { text: string; previous?: string }) => Promise<string | undefined>

/**
 * 用一次无工具的请求把旧对话压成结构化摘要。任何失败/超时都返回 undefined，
 * 由调用方决定降级策略——压缩失败绝不能挡住用户这一轮对话。
 * modelFactory 仅供测试注入。
 */
export function makeSummarizer(config: AgentModelConfig, modelFactory?: () => LanguageModel): Summarizer {
  return async ({ text, previous }) => {
    if (!text.trim()) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS)
    try {
      const prompt = previous
        ? `这是更早之前已经压缩过的摘要，请把它与下面的新增对话合并成一份新的摘要（不要丢掉旧摘要里仍然有效的信息）：

<已有摘要>
${previous}
</已有摘要>

<新增对话>
${text}
</新增对话>`
        : `<对话>\n${text}\n</对话>`
      const { text: out } = await generateText({
        model: modelFactory ? modelFactory() : createAgentModel(config),
        abortSignal: controller.signal,
        instructions: SUMMARY_SYSTEM,
        prompt,
      })
      const trimmed = out.trim()
      return trimmed || undefined
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }
}
