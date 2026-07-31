import type { AgentMessage, AgentTrace, Storage } from '../storage/index.js'
import { newId, now } from '../util.js'
import { buildContext, DEFAULT_BUDGET, renderForSummary, type ContextBudget, type ContextMessage } from './context.js'
import type { Summarizer } from './summarize.js'

export interface LoadedContext {
  /** 系统提示（含长期记忆与早前对话摘要） */
  system: string
  /** 历史对话，已按预算装配并保留工具调用/结果 */
  history: ContextMessage[]
}

const BASE_SYSTEM = `你是 SubForge 的内置助手，帮助用户管理代理订阅转换：编写/修改转换脚本、增删代理组与规则。
工作方式：
- 「整份替换」类写操作（write_script / write_config / update_subscription 的 content）都要求先读后写：
  先调对应的读工具（get_profile / get_subscription）拿到当前内容与指纹，把指纹作为 baseRev 传回来。
  拿不出指纹或指纹过期会被拒绝——这是防止你拿一份凭记忆重建的副本盖掉用户现有内容。
  被拒绝时不要瞎猜着重试，重新读一遍最新内容，在最新版本上重做这次修改。
- 改动已有脚本优先用 patch_script 做局部替换（只写要改的片段，其余原样保留，也不需要 baseRev）。
  write_script 整份重写等于凭记忆默写一遍整个脚本，容易漏掉与本次需求无关的规则和分组，
  只在首次写入或用户明确要求整份重写时用。
- 修改脚本前，先用 run_preview 对真实节点验证，确认无误再保存。
- 配置的写操作都会自动生成版本快照，可回滚；订阅内容与模板没有快照，覆盖后无法恢复，格外小心。
- 早前轮次的工具结果在上下文里会被省略成占位说明，看到占位就重新调工具取最新内容，不要凭印象作答。
- 当你了解到用户的长期偏好（命名习惯、常用分组方式、偏好规则等），调用 update_working_memory 追加一条记下来
  （默认 append 模式；不要用 replace 整份重写，那会把以前记下的偏好抹掉）。
- 用简体中文与用户交流。`

export interface MemoryOptions extends Partial<ContextBudget> {
  /** 压缩器。不提供则装不下的旧对话直接丢弃（只留一行说明），不做摘要。 */
  summarize?: Summarizer
}

/**
 * 框架无关的记忆管理：长期记忆 + 会话历史装配 + 溢出压缩，全部落 Storage。
 *
 * 压缩产物存成本线程里一条 role='system' 的消息，放在「最后一条被压缩的消息」之后：
 * 加载时取最后一条 system 消息作为分界，它之前的一概不再送进模型，它的正文作为摘要接续。
 * 这样不需要动表结构（沿用既有的 role 联合类型），人类回看会话时历史也完整保留——
 * 压缩只影响送给模型的部分，不删任何数据。前端本就只渲染 user/assistant，天然看不到它。
 */
export class MemoryManager {
  private readonly budget: ContextBudget
  private readonly summarize?: Summarizer

  constructor(
    private readonly storage: Storage,
    opts: MemoryOptions = {},
  ) {
    const { summarize, ...budget } = opts
    this.budget = { ...DEFAULT_BUDGET, ...budget }
    this.summarize = summarize
  }

  async loadContext(threadId: string): Promise<LoadedContext> {
    const all = await this.storage.listMessages(threadId)
    // 最后一条 system 消息 = 上一次压缩的分界线
    let boundary = -1
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i]?.role === 'system') {
        boundary = i
        break
      }
    }
    let carry = boundary >= 0 ? all[boundary]?.content : undefined
    const live = all.slice(boundary + 1)

    const { history, dropped } = buildContext(live, this.budget)
    let note: string | undefined
    if (dropped.length) {
      const summary = await this.compact(threadId, dropped, carry)
      if (summary) carry = summary
      else note = `（更早的 ${dropped.length} 条对话超出上下文窗口已被省略，且这次没能压缩成摘要。涉及之前的内容请重新调工具确认，不要凭印象作答。）`
    }

    const wm = (await this.storage.getWorkingMemory()).trim()
    const system = [
      BASE_SYSTEM,
      wm ? `# 已知的用户偏好（长期记忆）\n${wm}` : '',
      carry ? `# 早前对话摘要（原文已不在上下文里）\n${carry}` : '',
      note ?? '',
    ]
      .filter(Boolean)
      .join('\n\n')

    return { system, history }
  }

  /**
   * 把被挤出窗口的消息压成摘要并落库。失败返回 undefined——压缩是尽力而为，
   * 不落库就等于没发生，下一轮会拿着更长的一段重试，不会静默丢失。
   */
  private async compact(threadId: string, dropped: AgentMessage[], previous?: string): Promise<string | undefined> {
    const last = dropped[dropped.length - 1]
    if (!this.summarize || !last) return undefined
    const summary = await this.summarize({ text: renderForSummary(dropped), previous })
    if (!summary) return undefined
    await this.storage.addMessage({
      id: newId(),
      threadId,
      role: 'system',
      content: summary,
      // 紧跟在最后一条被压缩的消息之后：下次加载时它之前的消息都在分界线以外。
      // +1ms 是为了不与被压缩消息同时刻（listMessages 按 createdAt 排序，同值顺序无保证），
      // 而下一轮真实消息必定更晚，不会被这条挤到后面。
      createdAt: last.createdAt + 1,
    })
    return summary
  }

  async record(
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
    tools?: string[],
    trace?: AgentTrace,
  ): Promise<void> {
    const hasTrace = !!trace && (!!trace.reasoning || !!trace.steps?.length)
    await this.storage.addMessage({
      id: newId(),
      threadId,
      role,
      content,
      tools: tools && tools.length ? tools : undefined,
      trace: hasTrace ? trace : undefined,
      createdAt: now(),
    })
  }
}
