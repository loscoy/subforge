import { describe, expect, it, vi } from 'vitest'
import { InMemoryStorage } from '../storage/index.js'
import { DEFAULT_BUDGET } from './context.js'
import { MemoryManager } from './memory.js'

/** 每轮约 1000 token 的长对话，用来逼出压缩 */
async function seed(storage: InMemoryStorage, turns: number): Promise<void> {
  for (let i = 1; i <= turns; i++) {
    await storage.addMessage({ id: `u${i}`, threadId: 't', role: 'user', content: `第${i}轮提问`.repeat(100), createdAt: i * 1000 })
    await storage.addMessage({
      id: `a${i}`,
      threadId: 't',
      role: 'assistant',
      content: `第${i}轮回答`.repeat(100),
      trace: { steps: [{ id: `c${i}`, tool: 'get_profile', args: { id: 'p1' }, result: { configRev: `rev-${i}` } }] },
      createdAt: i * 1000 + 1,
    })
  }
}

/** 每轮约 1030 token：预算 2500 装得下最近两轮，再往前就要压缩 */
const tight = { ...DEFAULT_BUDGET, budgetTokens: 2500 }

describe('MemoryManager 上下文装配', () => {
  it('历史带上工具调用，长期记忆进系统提示', async () => {
    const storage = new InMemoryStorage()
    storage.setWorkingMemory('偏好把香港节点单独分组')
    await seed(storage, 1)
    const { system, history } = await new MemoryManager(storage).loadContext('t')
    expect(system).toContain('香港节点单独分组')
    const a = history[1]!
    expect(a.role === 'assistant' && a.calls?.[0]?.result).toEqual({ configRev: 'rev-1' })
  })

  it('装不下时压缩成摘要落库为 system 消息，且不删任何原始消息', async () => {
    const storage = new InMemoryStorage()
    await seed(storage, 4)
    const summarize = vi.fn(async () => '## 关键事实\n配置档 p1 的 configRev 是 rev-3')
    const { system } = await new MemoryManager(storage, { ...tight, summarize }).loadContext('t')

    expect(summarize).toHaveBeenCalledOnce()
    expect(system).toContain('早前对话摘要')
    expect(system).toContain('configRev 是 rev-3')

    const msgs = await storage.listMessages('t')
    // 8 条原始消息一条没少，只是多了一条 system
    expect(msgs.filter((m) => m.role !== 'system')).toHaveLength(8)
    const sys = msgs.filter((m) => m.role === 'system')
    expect(sys).toHaveLength(1)
    // 摘要落在「最后一条被压缩的消息」之后、下一轮真实消息之前
    const idx = msgs.findIndex((m) => m.role === 'system')
    expect(msgs[idx - 1]!.id).toBe('a2')
    expect(msgs[idx + 1]!.id).toBe('u3')
  })

  it('已压缩的部分不会再送进模型，也不会被重复压缩', async () => {
    const storage = new InMemoryStorage()
    await seed(storage, 4)
    const summarize = vi.fn(async () => '摘要一')
    const mem = new MemoryManager(storage, { ...tight, summarize })
    await mem.loadContext('t')

    // 第二次加载：分界线之前的消息一概不进历史，也不再触发压缩
    summarize.mockClear()
    const { history, system } = await mem.loadContext('t')
    expect(summarize).not.toHaveBeenCalled()
    expect(system).toContain('摘要一')
    expect(history.map((m) => m.content)).not.toContain(expect.stringContaining('第1轮'))
    expect(history).toHaveLength(4) // 第三、四轮
  })

  it('再次溢出时把已有摘要一并交给压缩器合并，不丢旧结论', async () => {
    const storage = new InMemoryStorage()
    await seed(storage, 4)
    const summarize = vi.fn(async () => '摘要一')
    await new MemoryManager(storage, { ...tight, summarize }).loadContext('t')

    // 再追加两轮，逼出第二次压缩
    for (let i = 5; i <= 6; i++) {
      await storage.addMessage({ id: `u${i}`, threadId: 't', role: 'user', content: `第${i}轮提问`.repeat(100), createdAt: i * 1000 })
      await storage.addMessage({ id: `a${i}`, threadId: 't', role: 'assistant', content: `第${i}轮回答`.repeat(100), createdAt: i * 1000 + 1 })
    }
    const second = vi.fn(async () => '摘要二')
    await new MemoryManager(storage, { ...tight, summarize: second }).loadContext('t')
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ previous: '摘要一' }))
  })

  it('压缩失败时不落库、下轮重试，系统提示里明说旧对话已被省略', async () => {
    const storage = new InMemoryStorage()
    await seed(storage, 4)
    const summarize = vi.fn(async () => undefined)
    const { system } = await new MemoryManager(storage, { ...tight, summarize }).loadContext('t')
    expect(system).toContain('超出上下文窗口已被省略')
    expect((await storage.listMessages('t')).some((m) => m.role === 'system')).toBe(false)
  })

  it('没有压缩器时同样降级，不会抛错', async () => {
    const storage = new InMemoryStorage()
    await seed(storage, 4)
    const { system, history } = await new MemoryManager(storage, tight).loadContext('t')
    expect(system).toContain('超出上下文窗口已被省略')
    expect(history.length).toBeGreaterThan(0)
  })
})
