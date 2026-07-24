import { generateText, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage } from 'ai'
import { buildTools, type Tool, type ToolContext } from '../tools/registry.js'
import { createAgentModel } from './model.js'
import { MemoryManager } from './memory.js'
import type { AgentEvent, AgentModelConfig, AgentReply, AgentRunner, AgentStep } from './runner.js'
import { buildWebCapability, type WebCapability } from './webTools.js'

/**
 * 基于 Vercel AI SDK 的 AgentRunner 实现。
 * 工具来自框架无关的 registry；记忆来自 MemoryManager（sqlite）。
 * 换框架时只需另写一个 AgentRunner 实现，工具/记忆层不动。
 */
export class AiSdkAgentRunner implements AgentRunner {
  private readonly memory: MemoryManager
  private readonly webCap?: WebCapability
  /** 可注入 model 工厂便于测试；默认用 OpenAI 兼容 provider。 */
  constructor(
    private readonly toolCtx: ToolContext,
    private readonly config: AgentModelConfig,
    private readonly maxSteps = 10,
    private readonly modelFactory?: () => LanguageModel,
  ) {
    this.memory = new MemoryManager(toolCtx.storage)
    this.webCap = config.webTools ? buildWebCapability(config.webTools) : undefined
  }

  /** sessionId=threadId：经 OpenRouter 转发时下发为 session_id，做粘性路由提升缓存命中。 */
  private makeModel(sessionId: string): LanguageModel {
    return this.modelFactory ? this.modelFactory() : createAgentModel(this.config, this.webCap, sessionId)
  }

  private withWebHint(system: string): string {
    return this.webCap ? `${system}\n\n# 联网\n${this.webCap.systemHint}` : system
  }

  async run(threadId: string, userMessage: string, context?: string): Promise<AgentReply> {
    const model = this.makeModel(threadId)

    const { system: baseSystem, history } = await this.memory.loadContext(threadId)
    const system = this.withWebHint(context ? `${baseSystem}\n\n# 当前上下文\n${context}` : baseSystem)
    const messages: ModelMessage[] = [
      ...history.map((h) => ({ role: h.role, content: h.content }) as ModelMessage),
      { role: 'user', content: userMessage },
    ]

    const steps: AgentStep[] = []
    const { text } = await generateText({
      model,
      instructions: system,
      messages,
      tools: this.buildTools(steps),
      stopWhen: stepCountIs(this.maxSteps),
    })

    await this.memory.record(threadId, 'user', userMessage)
    await this.memory.record(
      threadId,
      'assistant',
      text,
      steps.map((s) => s.tool),
      { steps },
    )

    return { text, steps }
  }

  /**
   * 构建 AI SDK 工具集。工具执行错误一律 catch 并作为「工具结果」返回（{ error }），
   * 而不是抛出——否则 AI SDK 会把它当致命错误直接中断整段对话。返回错误结果后，
   * 模型能看到失败原因并自行纠正/改用其它做法。传入 steps 时记录每次调用。
   */
  private buildTools(steps?: AgentStep[]) {
    const domainTools: Tool[] = buildTools({ checkNodes: !!this.toolCtx.checkNodes })
    // 联网能力的本地实现（如 tavily 的 web_search / web_fetch）与领域工具同等接入
    const allTools = [...domainTools, ...(this.webCap?.registryTools ?? [])]
    return Object.fromEntries(
      allTools.map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: t.schema,
          execute: async (args: unknown) => {
            try {
              const result = await t.handler(args as never, this.toolCtx)
              steps?.push({ tool: t.name, args, result })
              return result
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e)
              steps?.push({ tool: t.name, args, error })
              return { error }
            }
          },
        }),
      ]),
    )
  }

  async *runStream(
    threadId: string,
    userMessage: string,
    context?: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    const model = this.makeModel(threadId)
    const { system: base, history } = await this.memory.loadContext(threadId)
    const system = this.withWebHint(context ? `${base}\n\n# 当前上下文\n${context}` : base)
    const messages: ModelMessage[] = [
      ...history.map((h) => ({ role: h.role, content: h.content }) as ModelMessage),
      { role: 'user', content: userMessage },
    ]

    const result = streamText({
      model,
      instructions: system,
      messages,
      tools: this.buildTools(),
      stopWhen: stepCountIs(this.maxSteps),
      abortSignal: signal,
    })
    let finalText = ''
    let reasoning = ''
    const usedTools: string[] = []
    // 按调用 id 索引，好让稍后到达的结果落回同一步（同名工具一轮可能被调用多次）
    const steps = new Map<string, AgentStep>()
    const stepOf = (id: string, tool: string) => {
      let step = steps.get(id)
      if (!step) {
        step = { id, tool }
        steps.set(id, step)
      }
      return step
    }
    try {
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          finalText += part.text
          yield { type: 'text', delta: part.text }
        } else if (part.type === 'reasoning-delta') {
          reasoning += part.text
          yield { type: 'reasoning', delta: part.text }
        } else if (part.type === 'tool-call') {
          usedTools.push(part.toolName)
          stepOf(part.toolCallId, part.toolName).args = part.input
          yield { type: 'tool-call', id: part.toolCallId, tool: part.toolName, args: part.input }
        } else if (part.type === 'tool-result') {
          stepOf(part.toolCallId, part.toolName).result = part.output
          yield { type: 'tool-result', id: part.toolCallId, tool: part.toolName, result: part.output }
        } else if (part.type === 'tool-error') {
          // registry 工具的错误已在 execute 里转成 { error } 结果，走上面的 tool-result；
          // 这里只会是框架层异常（如入参 schema 校验失败）。同样上报「该工具已结束」，
          // 否则前端会一直卡在运行中。
          const error = part.error instanceof Error ? part.error.message : String(part.error)
          stepOf(part.toolCallId, part.toolName).error = error
          yield { type: 'tool-result', id: part.toolCallId, tool: part.toolName, error }
        } else if (part.type === 'error') {
          yield { type: 'error', error: part.error instanceof Error ? part.error.message : String(part.error) }
        }
      }
    } catch (e) {
      // 主动中止（用户点停止）不是错误：streamText 会抛 AbortError，这里吞掉，
      // 已经流出的文本 / 工具步骤照常在下面落库，前端也保留已显示的部分。
      if (!signal?.aborted) {
        yield { type: 'error', error: e instanceof Error ? e.message : String(e) }
      }
    }

    // 本轮彻底没产出（既无文本也无工具调用，通常是开局就出错）时一条都不写：
    // 空的 assistant 消息会带进后续每一轮上下文，不少 provider 直接拒收空 content。
    // 什么都不留，用户重发一次即可。
    if (finalText || steps.size) {
      await this.memory.record(threadId, 'user', userMessage)
      await this.memory.record(threadId, 'assistant', finalText, usedTools, {
        reasoning: reasoning || undefined,
        steps: [...steps.values()],
      })
    }
    yield { type: 'done', text: finalText }
  }
}
