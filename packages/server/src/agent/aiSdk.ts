import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, streamText, tool, type CoreMessage, type LanguageModelV1 } from 'ai'
import { buildTools, type ToolContext } from '../tools/registry.js'
import { MemoryManager } from './memory.js'
import type { AgentEvent, AgentModelConfig, AgentReply, AgentRunner, AgentStep } from './runner.js'

/**
 * 基于 Vercel AI SDK 的 AgentRunner 实现。
 * 工具来自框架无关的 registry；记忆来自 MemoryManager（sqlite）。
 * 换框架时只需另写一个 AgentRunner 实现，工具/记忆层不动。
 */
export class AiSdkAgentRunner implements AgentRunner {
  private readonly memory: MemoryManager
  /** 可注入 model 工厂便于测试；默认用 OpenAI 兼容 provider。 */
  constructor(
    private readonly toolCtx: ToolContext,
    private readonly config: AgentModelConfig,
    private readonly maxSteps = 10,
    private readonly modelFactory: () => LanguageModelV1 = () =>
      createOpenAICompatible({ name: 'subforge', baseURL: config.baseURL, apiKey: config.apiKey })(config.model),
  ) {
    this.memory = new MemoryManager(toolCtx.storage)
  }

  async run(threadId: string, userMessage: string, context?: string): Promise<AgentReply> {
    const model = this.modelFactory()

    const { system: baseSystem, history } = await this.memory.loadContext(threadId)
    const system = context ? `${baseSystem}\n\n# 当前上下文\n${context}` : baseSystem
    const messages: CoreMessage[] = [
      ...history.map((h) => ({ role: h.role, content: h.content }) as CoreMessage),
      { role: 'user', content: userMessage },
    ]

    const steps: AgentStep[] = []
    const { text } = await generateText({
      model,
      system,
      messages,
      tools: this.buildTools(steps),
      maxSteps: this.maxSteps,
    })

    await this.memory.record(threadId, 'user', userMessage)
    await this.memory.record(threadId, 'assistant', text, steps.map((s) => s.tool))

    return { text, steps }
  }

  /**
   * 构建 AI SDK 工具集。工具执行错误一律 catch 并作为「工具结果」返回（{ error }），
   * 而不是抛出——否则 AI SDK 会把它当致命错误直接中断整段对话。返回错误结果后，
   * 模型能看到失败原因并自行纠正/改用其它做法。传入 steps 时记录每次调用。
   */
  private buildTools(steps?: AgentStep[]) {
    return Object.fromEntries(
      buildTools({ checkNodes: !!this.toolCtx.checkNodes }).map((t) => [
        t.name,
        tool({
          description: t.description,
          parameters: t.schema,
          execute: async (args: unknown) => {
            try {
              const result = await t.handler(args as never, this.toolCtx)
              steps?.push({ tool: t.name, args, result })
              return result
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e)
              steps?.push({ tool: t.name, args, result: { error } })
              return { error }
            }
          },
        }),
      ]),
    )
  }

  async *runStream(threadId: string, userMessage: string, context?: string): AsyncIterable<AgentEvent> {
    const model = this.modelFactory()
    const { system: base, history } = await this.memory.loadContext(threadId)
    const system = context ? `${base}\n\n# 当前上下文\n${context}` : base
    const messages: CoreMessage[] = [
      ...history.map((h) => ({ role: h.role, content: h.content }) as CoreMessage),
      { role: 'user', content: userMessage },
    ]

    const result = streamText({ model, system, messages, tools: this.buildTools(), maxSteps: this.maxSteps })
    let finalText = ''
    const usedTools: string[] = []
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          finalText += part.textDelta
          yield { type: 'text', delta: part.textDelta }
        } else if (part.type === 'tool-call') {
          usedTools.push(part.toolName)
          yield { type: 'tool-call', tool: part.toolName }
        } else if (part.type === 'tool-result') {
          yield { type: 'tool-result', tool: part.toolName }
        } else if (part.type === 'error') {
          yield { type: 'error', error: part.error instanceof Error ? part.error.message : String(part.error) }
        }
      }
    } catch (e) {
      yield { type: 'error', error: e instanceof Error ? e.message : String(e) }
    }

    await this.memory.record(threadId, 'user', userMessage)
    await this.memory.record(threadId, 'assistant', finalText, usedTools)
    yield { type: 'done', text: finalText }
  }
}
