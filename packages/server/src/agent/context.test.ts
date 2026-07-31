import { describe, expect, it } from 'vitest'
import type { AgentMessage, AgentToolStep } from '../storage/types.js'
import {
  buildContext,
  DEFAULT_BUDGET,
  EMPTY_ASSISTANT,
  estimateTokens,
  groupTurns,
  OMITTED_RESULT,
  renderForSummary,
} from './context.js'

let seq = 0
const user = (content: string): AgentMessage => ({
  id: `u${++seq}`,
  threadId: 't',
  role: 'user',
  content,
  createdAt: seq * 1000,
})
const assistant = (content: string, steps?: AgentToolStep[]): AgentMessage => ({
  id: `a${++seq}`,
  threadId: 't',
  role: 'assistant',
  content,
  ...(steps ? { trace: { steps } } : {}),
  createdAt: seq * 1000,
})

describe('groupTurns', () => {
  it('按 user 消息切分轮次，assistant 归入前一轮', () => {
    const turns = groupTurns([user('a'), assistant('1'), assistant('2'), user('b'), assistant('3')])
    expect(turns.map((t) => t.length)).toEqual([3, 2])
  })

  it('首条 user 之前的消息自成一轮，不丢弃', () => {
    const turns = groupTurns([assistant('孤儿'), user('a')])
    expect(turns.map((t) => t.length)).toEqual([1, 1])
  })
})

describe('estimateTokens', () => {
  it('中文按一字一 token 估，明显贵于同长度英文', () => {
    expect(estimateTokens('这是一段中文文本')).toBeGreaterThan(estimateTokens('abcdefgh'))
  })
})

describe('buildContext', () => {
  it('把工具调用与结果一并还原，不再只喂正文', () => {
    const { history } = buildContext([
      user('看看有哪些配置'),
      assistant('有两个。', [{ id: 'c1', tool: 'list_profiles', args: {}, result: [{ id: 'p1' }] }]),
    ])
    const a = history.find((m) => m.role === 'assistant')!
    expect(a.role).toBe('assistant')
    expect(a.role === 'assistant' && a.calls).toEqual([
      { id: 'c1', tool: 'list_profiles', args: {}, result: [{ id: 'p1' }] },
    ])
  })

  it('超出保真窗口的旧轮次只留工具名与参数，结果换成占位说明', () => {
    const step = (): AgentToolStep => ({ id: 'c', tool: 'get_profile', args: { id: 'p1' }, result: { script: 'x'.repeat(50) } })
    const msgs = [
      user('第一轮'),
      assistant('好', [step()]),
      user('第二轮'),
      assistant('好', [step()]),
      user('第三轮'),
      assistant('好', [step()]),
    ]
    const { history } = buildContext(msgs, { ...DEFAULT_BUDGET, fullResultTurns: 2 })
    const calls = history.filter((m) => m.role === 'assistant').map((m) => (m.role === 'assistant' ? m.calls?.[0] : undefined))
    // 最旧一轮降级：参数还在（体现意图），结果换成占位
    expect(calls[0]!.args).toEqual({ id: 'p1' })
    expect(calls[0]!.result).toBe(OMITTED_RESULT)
    // 最近两轮完整
    expect(calls[1]!.result).toEqual({ script: 'x'.repeat(50) })
    expect(calls[2]!.result).toEqual({ script: 'x'.repeat(50) })
  })

  it('单个超长结果被截断并注明，不会独吞窗口', () => {
    const { history } = buildContext(
      [user('导出'), assistant('给你', [{ id: 'c', tool: 'get_output', result: 'y'.repeat(9999) }])],
      { ...DEFAULT_BUDGET, maxResultChars: 100 },
    )
    const call = history.find((m) => m.role === 'assistant')!
    const result = call.role === 'assistant' ? (call.calls![0]!.result as string) : ''
    expect(result).toContain('已截断')
    expect(result.length).toBeLessThan(300)
  })

  it('超预算时从最旧的轮次整轮丢弃，切口落在轮次边界', () => {
    const msgs = [
      user('第一轮'.repeat(200)),
      assistant('答一'.repeat(200)),
      user('第二轮'.repeat(200)),
      assistant('答二'.repeat(200)),
      user('第三轮'),
      assistant('答三'),
    ]
    // 每轮约 1000 token：预算 1500 刚好装得下第三轮 + 第二轮，装不下第一轮
    const { history, dropped } = buildContext(msgs, { ...DEFAULT_BUDGET, budgetTokens: 1500 })
    // 丢掉的是完整的第一轮（user + assistant），不会把 user 与它的回答切散
    expect(dropped.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(dropped[0]!.content).toContain('第一轮')
    expect(history).toHaveLength(4)
    expect(history[0]!.content).toContain('第二轮')
  })

  it('最新一轮单轮就超预算时也不交出空历史，降级保住它', () => {
    const { history, dropped } = buildContext([user('问'), assistant('答', [{ id: 'c', tool: 'get_output', result: 'z'.repeat(100_000) }])], {
      ...DEFAULT_BUDGET,
      budgetTokens: 50,
    })
    expect(dropped).toHaveLength(0)
    expect(history).toHaveLength(2)
    const a = history[1]!
    expect(a.role === 'assistant' && String(a.calls![0]!.result).length).toBeLessThan(800)
  })

  it('只调工具没正文的 assistant 补占位，避免空 content 被 provider 拒收', () => {
    const { history } = buildContext([user('改一下'), assistant('', [{ id: 'c', tool: 'write_config', args: {} }])])
    expect(history[1]!.content).toBe(EMPTY_ASSISTANT)
  })

  it('给缺 id 的历史步骤补确定性 id，保证调用与结果配得上', () => {
    const { history } = buildContext([user('x'), assistant('y', [{ tool: 'a' }, { tool: 'b' }])])
    const a = history[1]!
    const ids = a.role === 'assistant' ? a.calls!.map((c) => c.id) : []
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toMatch(/^hist-/)
  })

  it('失败的调用保留错误信息', () => {
    const { history } = buildContext([user('x'), assistant('出错了', [{ id: 'c', tool: 'write_script', error: 'baseRev 不匹配' }])])
    const a = history[1]!
    expect(a.role === 'assistant' && a.calls![0]!.error).toBe('baseRev 不匹配')
  })

  it('maxTurns 兜住一堆极短消息', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => [user(`q${i}`), assistant(`a${i}`)]).flat()
    const { history, dropped } = buildContext(msgs, { ...DEFAULT_BUDGET, maxTurns: 3 })
    expect(history).toHaveLength(6)
    expect(dropped).toHaveLength(34)
  })
})

describe('renderForSummary', () => {
  it('把工具调用摊成可读文本，成功与失败都带上', () => {
    const text = renderForSummary([
      user('改 DNS'),
      assistant('改好了', [
        { id: 'c1', tool: 'get_profile', args: { id: 'p1' }, result: { configRev: 'abc' } },
        { id: 'c2', tool: 'write_config', args: {}, error: 'baseRev 不匹配' },
      ]),
    ])
    expect(text).toContain('改 DNS')
    expect(text).toContain('调用 get_profile')
    expect(text).toContain('configRev')
    expect(text).toContain('失败：baseRev 不匹配')
  })
})
