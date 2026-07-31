import type { AgentMessage, AgentToolStep } from '../storage/types.js'

/**
 * 上下文装配：把落库的会话消息装配成「喂给模型的历史」。
 *
 * 与框架无关（不 import 任何 SDK 类型），由 runner 负责转成各自的消息格式。
 * 设计参考 pi 的 compaction：按 turn 边界切、按 token 预算从新往旧回溯、
 * 装不下的部分交给上层做摘要压缩，绝不在 tool 调用与它的结果之间切开。
 */

/** 一次工具调用（已按保真度处理过，可能被截断/摘要）。 */
export interface ContextToolCall {
  id: string
  tool: string
  args?: unknown
  /** 成功结果（与 error 二选一） */
  result?: unknown
  error?: string
}

/** 送进模型的一条历史消息。 */
export type ContextMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; calls?: ContextToolCall[] }

export interface ContextBudget {
  /** 历史部分的 token 预算（不含系统提示与本轮用户消息） */
  budgetTokens: number
  /** 最近多少轮保留完整工具结果，更早的降级成摘要占位 */
  fullResultTurns: number
  /** 单个工具参数/结果的字符上限，超出截断 */
  maxResultChars: number
  /** 轮数硬上限，防止一堆极短消息把窗口塞满 */
  maxTurns: number
}

export const DEFAULT_BUDGET: ContextBudget = {
  // 保守取值：OpenAI 兼容端点五花八门（本地小模型可能只有 8k），
  // 我们拿不到 contextWindow，只能给一个大多数模型都吃得下的历史预算。
  budgetTokens: 24_000,
  fullResultTurns: 2,
  maxResultChars: 4000,
  maxTurns: 40,
}

/** 早前轮次的工具结果占位。明确告诉模型「想要就重新读」，而不是让它以为工具返回了空。 */
export const OMITTED_RESULT = '（早前轮次，完整结果已省略。需要就重新调用该工具取最新内容——注意内容可能已经变了。）'

/** 只有工具调用、没有正文时的占位，保证 assistant 消息不为空（不少 provider 拒收空 content）。 */
export const EMPTY_ASSISTANT = '（这一轮只调用了工具，没有产生正文回复。）'

/** 降级轮次里工具参数的字符上限。参数体现意图，值得留；但 write_script 这种能有几十 KB。 */
const DIGEST_ARG_CHARS = 300
/** 错误信息的字符上限。 */
const ERROR_CHARS = 500
/** 兜底重渲染时的字符上限：最新一轮单轮就超预算时启用。 */
const SALVAGE_CHARS = 500

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

/**
 * 粗估 token 数。中日韩文字约一字一 token，其余按四字符一 token——
 * 比统一 chars/4 准得多（我们的对话大部分是中文），而且不需要引入 tokenizer。
 * 只用于「装不装得下」的判断，偏保守即可。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK)?.length ?? 0
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

function stringify(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

/** 超长就截断并留一条说明。原样返回（不转字符串）是为了让没超的结构化结果保持原形。 */
function clip(value: unknown, max: number): unknown {
  const s = stringify(value)
  if (!s || s.length <= max) return value
  return `${s.slice(0, max)}\n…（已截断 ${s.length - max} 字符；需要完整内容请重新调用该工具）`
}

function costOf(m: ContextMessage): number {
  let n = estimateTokens(m.content)
  if (m.role === 'assistant' && m.calls) {
    for (const c of m.calls) n += estimateTokens(stringify(c))
  }
  // 每条消息的角色/分隔开销
  return n + 4
}

/**
 * 按 user 消息切分成轮次。一轮 = 一条 user 消息 + 它之后的所有 assistant 消息。
 * 首条 user 之前的消息（正常不该有）自成一轮，不丢弃。
 */
export function groupTurns(msgs: AgentMessage[]): AgentMessage[][] {
  const turns: AgentMessage[][] = []
  for (const m of msgs) {
    const cur = turns[turns.length - 1]
    if (m.role === 'user' || !cur) turns.push([m])
    else cur.push(m)
  }
  return turns
}

function renderStep(step: AgentToolStep, index: number, msgId: string, full: boolean, maxChars: number): ContextToolCall {
  // 0004 之前落库的步骤没有 id，这里按消息 id + 序号补一个确定性的，
  // 保证同一次请求里 tool-call 与 tool-result 配得上
  const id = step.id || `hist-${msgId}-${index}`
  if (step.error !== undefined) {
    return { id, tool: step.tool, args: clip(step.args, DIGEST_ARG_CHARS), error: step.error.slice(0, ERROR_CHARS) }
  }
  if (!full) return { id, tool: step.tool, args: clip(step.args, DIGEST_ARG_CHARS), result: OMITTED_RESULT }
  return { id, tool: step.tool, args: clip(step.args, maxChars), result: clip(step.result ?? null, maxChars) }
}

function renderMessage(m: AgentMessage, full: boolean, maxChars: number): ContextMessage | null {
  if (m.role === 'user') return m.content ? { role: 'user', content: m.content } : null
  if (m.role !== 'assistant') return null
  const steps = m.trace?.steps ?? []
  const calls = steps.map((s, i) => renderStep(s, i, m.id, full, maxChars))
  if (!calls.length && !m.content) return null
  return {
    role: 'assistant',
    content: m.content || EMPTY_ASSISTANT,
    ...(calls.length ? { calls } : {}),
  }
}

function renderTurn(turn: AgentMessage[], full: boolean, maxChars: number): ContextMessage[] {
  const out: ContextMessage[] = []
  for (const m of turn) {
    const rendered = renderMessage(m, full, maxChars)
    if (rendered) out.push(rendered)
  }
  return out
}

export interface BuiltContext {
  /** 装配好的历史，时间升序 */
  history: ContextMessage[]
  /** 被挤出窗口的原始消息（时间升序）。非空说明需要压缩成摘要，否则这段就白丢了。 */
  dropped: AgentMessage[]
}

/**
 * 从新往旧回溯装配历史，直到撞上 token 预算或轮数上限。
 *
 * 只在轮次边界切：切在 tool 调用与结果之间会让 provider 直接报错，
 * 切在 user 与它的回答之间会让模型看到一个没有出处的答复。
 * 最新一轮永远保留——哪怕它自己就超预算，也退而求其次把结果压狠一点，而不是交出空历史。
 */
export function buildContext(msgs: AgentMessage[], budget: ContextBudget = DEFAULT_BUDGET): BuiltContext {
  const turns = groupTurns(msgs.filter((m) => m.role === 'user' || m.role === 'assistant'))
  const kept: ContextMessage[][] = []
  let used = 0
  let cut = turns.length // 第一个被丢弃的轮次下标

  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (!turn) continue
    const age = turns.length - 1 - i // 0 = 最新一轮
    if (kept.length >= budget.maxTurns) break
    const full = age < budget.fullResultTurns
    let rendered = renderTurn(turn, full, budget.maxResultChars)
    let cost = rendered.reduce((n, m) => n + costOf(m), 0)
    if (used + cost > budget.budgetTokens) {
      if (kept.length) break
      // 最新一轮单轮超预算：降级重渲染，尽量保住它
      rendered = renderTurn(turn, false, SALVAGE_CHARS)
      cost = rendered.reduce((n, m) => n + costOf(m), 0)
    }
    used += cost
    kept.unshift(rendered)
    cut = i
  }

  return { history: kept.flat(), dropped: turns.slice(0, cut).flat() }
}

/** 把被丢弃的消息渲染成一段纯文本，交给摘要模型。工具调用只留名字与参数摘要。 */
export function renderForSummary(msgs: AgentMessage[]): string {
  const lines: string[] = []
  for (const m of msgs) {
    if (m.role === 'user') {
      lines.push(`## 用户\n${m.content}`)
      continue
    }
    if (m.role !== 'assistant') continue
    const parts: string[] = []
    for (const s of m.trace?.steps ?? []) {
      const args = stringify(clip(s.args, DIGEST_ARG_CHARS))
      const outcome = s.error !== undefined ? `失败：${s.error.slice(0, ERROR_CHARS)}` : `成功：${stringify(clip(s.result, DIGEST_ARG_CHARS))}`
      parts.push(`- 调用 ${s.tool}(${args}) → ${outcome}`)
    }
    lines.push(`## 助手\n${parts.length ? `${parts.join('\n')}\n` : ''}${m.content}`)
  }
  return lines.join('\n\n')
}
