import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, tool, type CoreMessage, type LanguageModelV1 } from 'ai'
import { buildTools, type ToolContext } from '../tools/registry.js'
import { MemoryManager } from './memory.js'
import type { AgentModelConfig, AgentReply, AgentRunner, AgentStep } from './runner.js'

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

  async run(threadId: string, userMessage: string): Promise<AgentReply> {
    const model = this.modelFactory()

    const { system, history } = await this.memory.loadContext(threadId)
    const messages: CoreMessage[] = [
      ...history.map((h) => ({ role: h.role, content: h.content }) as CoreMessage),
      { role: 'user', content: userMessage },
    ]

    const steps: AgentStep[] = []
    const aiTools = Object.fromEntries(
      buildTools().map((t) => [
        t.name,
        tool({
          description: t.description,
          parameters: t.schema,
          execute: async (args: unknown) => {
            const result = await t.handler(args as never, this.toolCtx)
            steps.push({ tool: t.name, args, result })
            return result
          },
        }),
      ]),
    )

    const { text } = await generateText({
      model,
      system,
      messages,
      tools: aiTools,
      maxSteps: this.maxSteps,
    })

    await this.memory.record(threadId, 'user', userMessage)
    await this.memory.record(threadId, 'assistant', text)

    return { text, steps }
  }
}
