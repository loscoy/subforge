import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage } from 'ai'
import { buildTools, type Tool, type ToolContext } from '../tools/registry.js'
import { MemoryManager } from './memory.js'
import type { AgentEvent, AgentModelConfig, AgentReply, AgentRunner, AgentStep } from './runner.js'
import { buildWebCapability, injectProviderTools, type WebCapability } from './webTools.js'

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

  private makeModel(): LanguageModel {
    if (this.modelFactory) return this.modelFactory()
    const cap = this.webCap
    // 服务端联网工具（如 openrouter:web_search）不是标准 function tool，AI SDK 的工具
    // 抽象表达不了，改在传输层注入：包一层 fetch，把声明追加进请求体 tools 数组。
    const fetchWithWebTools: typeof fetch | undefined =
      cap && cap.providerTools.length > 0
        ? (input, init) => {
            if (init && typeof init.body === 'string') init = { ...init, body: injectProviderTools(init.body, cap) }
            return fetch(input, init)
          }
        : undefined
    return createOpenAICompatible({
      name: 'subforge',
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      ...(fetchWithWebTools ? { fetch: fetchWithWebTools } : {}),
    })(this.config.model)
  }

  private withWebHint(system: string): string {
    return this.webCap ? `${system}\n\n# 联网\n${this.webCap.systemHint}` : system
  }

  async run(threadId: string, userMessage: string, context?: string): Promise<AgentReply> {
    const model = this.makeModel()

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
    await this.memory.record(threadId, 'assistant', text, steps.map((s) => s.tool))

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
              steps?.push({ tool: t.name, args, result: { error } })
              return { error }
            }
          },
        }),
      ]),
    )
  }

  async *runStream(threadId: string, userMessage: string, context?: string): AsyncIterable<AgentEvent> {
    const model = this.makeModel()
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
    })
    let finalText = ''
    const usedTools: string[] = []
    try {
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          finalText += part.text
          yield { type: 'text', delta: part.text }
        } else if (part.type === 'tool-call') {
          usedTools.push(part.toolName)
          yield { type: 'tool-call', tool: part.toolName }
        } else if (part.type === 'tool-result' || part.type === 'tool-error') {
          // registry 工具的错误已在 execute 里转成 { error } 结果，tool-error 理论上
          // 只会来自框架层异常；两者都作为「该工具已结束」上报，避免前端卡在运行中。
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
