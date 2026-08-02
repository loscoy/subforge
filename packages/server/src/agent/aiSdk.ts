import { generateText, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage } from 'ai'
import { log } from '../log.js'
import { buildTools, type Tool, type ToolContext } from '../tools/registry.js'
import type { ContextMessage } from './context.js'
import { createAgentModel } from './model.js'
import { MemoryManager } from './memory.js'
import type { AgentEvent, AgentModelConfig, AgentReply, AgentRunner, AgentStep } from './runner.js'
import { makeSummarizer } from './summarize.js'
import { buildWebCapability, type WebCapability } from './webTools.js'

/**
 * 把装配好的历史转成 AI SDK 的消息格式。
 *
 * 关键点是把工具调用还原成 assistant(tool-call) + tool(tool-result) 消息对：
 * 只喂正文的话，模型对上一轮自己读到过什么、写下过什么完全失忆，
 * 只能从自己那段总结文字里回忆，read-before-write 拿到的指纹更是一轮就没。
 * 同一轮的多次调用合并成一组，顺序与原始调用顺序一致。
 */
export function toModelMessages(history: ContextMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    const calls = m.calls ?? []
    if (calls.length) {
      out.push({
        role: 'assistant',
        content: calls.map((c) => ({
          type: 'tool-call' as const,
          toolCallId: c.id,
          toolName: c.tool,
          input: c.args ?? {},
        })),
      })
      out.push({
        role: 'tool',
        content: calls.map((c) => ({
          type: 'tool-result' as const,
          toolCallId: c.id,
          toolName: c.tool,
          output:
            c.error !== undefined
              ? ({ type: 'error-text', value: c.error } as const)
              : ({ type: 'json', value: (c.result ?? null) as never } as const),
        })),
      })
    }
    out.push({ role: 'assistant', content: m.content })
  }
  return out
}

/** 每这么多个流式事件打一次进度。 */
const PROGRESS_EVERY = 500
/** 或者距上次打点超过这么久也打一次——应对「事件不多但每个都很重」的情形。 */
const PROGRESS_INTERVAL_MS = 15_000

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
    // 压缩用同一套模型配置（无工具的单次请求）；失败/超时只会退化成「旧对话被省略」，不影响本轮
    this.memory = new MemoryManager(toolCtx.storage, { summarize: makeSummarizer(config, modelFactory) })
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
    const messages: ModelMessage[] = [...toModelMessages(history), { role: 'user', content: userMessage }]

    // 先落库再跑模型，理由见 runStream 里同一处注释
    await this.memory.record(threadId, 'user', userMessage)

    const steps: AgentStep[] = []
    const { text } = await generateText({
      model,
      instructions: system,
      messages,
      tools: this.buildTools(steps),
      stopWhen: stepCountIs(this.maxSteps),
    })

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
          // ms 只覆盖工具里的 I/O（D1、抓取）；纯计算的部分在 Workers 上测出来是 0（见 log.ts）
          execute: async (args: unknown) => {
            const startedAt = Date.now()
            try {
              const result = await t.handler(args as never, this.toolCtx)
              steps?.push({ tool: t.name, args, result })
              log('agent.tool', { tool: t.name, ok: true, ms: Date.now() - startedAt })
              return result
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e)
              steps?.push({ tool: t.name, args, error })
              log('agent.tool', { tool: t.name, ok: false, ms: Date.now() - startedAt, error })
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
    const startedAt = Date.now()
    const model = this.makeModel(threadId)
    const { system: base, history } = await this.memory.loadContext(threadId)
    const system = this.withWebHint(context ? `${base}\n\n# 当前上下文\n${context}` : base)
    const messages: ModelMessage[] = [...toModelMessages(history), { role: 'user', content: userMessage }]

    // 用户消息先落库，再开始跑模型。本轮后面任何一步没能走完——模型报错、
    // 连接中断、worker 被平台按 CPU 超限直接掐断（收尾代码一行都跑不到）——
    // 至少「用户发了什么」不会跟着蒸发，界面上也还能看到自己那句话。
    // 必须放在 loadContext 之后：否则它会同时出现在历史和本轮消息里，重复一遍。
    await this.memory.record(threadId, 'user', userMessage)
    log('agent.stream.start', { threadId, historyMsgs: history.length, promptChars: JSON.stringify(messages).length })

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
    // 只记次数不记单次耗时：Workers 的时钟在纯计算时不前进，测出来会是 0（见 log.ts）。
    // 次数配上平台给的总 cpuTimeMs，才能算出每个事件到底摊到多少 CPU。
    const counts = { text: 0, reasoning: 0, toolCall: 0, toolResult: 0, other: 0 }
    let events = 0
    let lastProgressAt = startedAt
    try {
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          counts.text += 1
          finalText += part.text
          yield { type: 'text', delta: part.text }
        } else if (part.type === 'reasoning-delta') {
          counts.reasoning += 1
          reasoning += part.text
          yield { type: 'reasoning', delta: part.text }
        } else if (part.type === 'tool-call') {
          counts.toolCall += 1
          usedTools.push(part.toolName)
          stepOf(part.toolCallId, part.toolName).args = part.input
          yield { type: 'tool-call', id: part.toolCallId, tool: part.toolName, args: part.input }
        } else if (part.type === 'tool-result') {
          counts.toolResult += 1
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
          counts.other += 1
          yield { type: 'error', error: part.error instanceof Error ? part.error.message : String(part.error) }
        } else {
          counts.other += 1
        }
        // 周期性打点：CPU 超限时 isolate 当场被杀，收尾那条日志根本跑不到，
        // 只有中途已经打出去的行会被 Workers Logs 收走——那是唯一能留下的线索。
        events += 1
        if (events % PROGRESS_EVERY === 0 || Date.now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          lastProgressAt = Date.now()
          log('agent.stream.progress', { threadId, events, ...counts, elapsedMs: lastProgressAt - startedAt })
        }
      }
    } catch (e) {
      // 主动中止（用户点停止）不是错误：streamText 会抛 AbortError，这里吞掉，
      // 已经流出的文本 / 工具步骤照常在下面落库，前端也保留已显示的部分。
      if (!signal?.aborted) {
        yield { type: 'error', error: e instanceof Error ? e.message : String(e) }
      }
    }

    // finishReason 是 PromiseLike，没有 .catch；流异常收尾时它也可能 reject
    let finishReason: string | undefined
    try {
      finishReason = await result.finishReason
    } catch {
      finishReason = undefined
    }

    // 撞上步数上限（stopWhen）：模型还想接着调工具，被我们截停，于是这一轮
    // 只有一串工具卡、正文一个字都没有——在界面上就是「莫名其妙停住 + 一个空气泡」。
    // 补一句说明，把「为什么停」和「怎么继续」交代清楚。
    // 只在既没正文、又确实是被工具调用截断时补；用户主动停止不算。
    if (!finalText && steps.size && !signal?.aborted && finishReason === 'tool-calls') {
      finalText = `（这一轮连续调用工具已达上限 ${this.maxSteps} 步，我先停在这里，没有继续往下做。`
        + `如果还没弄完，回我一句「继续」就行；如果看起来在反复做同一件事，告诉我，我换个思路。）`
      yield { type: 'text', delta: finalText }
    }

    // 本轮彻底没产出（既无文本也无工具调用，通常是开局就出错）时不写 assistant：
    // 空的 assistant 消息会带进后续每一轮上下文，不少 provider 直接拒收空 content。
    // 用户那条已经在开头落过库了，这里不写也丢不掉用户说过的话。
    if (finalText || steps.size) {
      await this.memory.record(threadId, 'assistant', finalText, usedTools, {
        reasoning: reasoning || undefined,
        steps: [...steps.values()],
      })
    }
    log('agent.stream.end', {
      threadId,
      events,
      ...counts,
      steps: steps.size,
      finishReason,
      textChars: finalText.length,
      reasoningChars: reasoning.length,
      aborted: !!signal?.aborted,
      elapsedMs: Date.now() - startedAt,
    })
    yield { type: 'done', text: finalText }
  }
}
