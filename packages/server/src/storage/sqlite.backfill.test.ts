import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteStorage } from './sqlite.js'

/**
 * 会话回填只发生在「库里已有历史消息、但还没有 sessions 表数据」的升级场景，
 * 契约测试（内存 / 伪 D1）覆盖不到。这里用真实文件库跨两次打开来复现升级：
 * 第一次写入老线程的消息，第二次打开时 migrate() 应把它们回填成会话。
 */
describe('SqliteStorage 会话回填（升级路径）', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'subforge-sqlite-'))
    path = join(dir, 'db.sqlite')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('把 global / profile:<id> 老线程回填成会话，消息不动', async () => {
    // 第一次打开：建库后手动塞入老线程的消息（此刻 sessions 为空，backfill 在建库时已是 no-op）
    const first = new SqliteStorage(path)
    await first.addMessage({ id: 'g1', threadId: 'global', role: 'user', content: '全局问题', createdAt: 10 })
    await first.addMessage({ id: 'g2', threadId: 'global', role: 'assistant', content: '答', createdAt: 20 })
    await first.addMessage({ id: 'p1', threadId: 'profile:abc', role: 'user', content: '档内问题', createdAt: 30 })
    // 模拟升级前的状态：删掉建库时自动写入的（空）会话记录，确保第二次打开时确实空表触发回填
    await first.deleteSession('global')
    await first.deleteSession('profile:abc')
    // deleteSession 会连消息一起删——所以这里换个不碰消息的方式：直接确认还没有会话
    expect(await first.listSessions(null)).toEqual([])
    await first.close()

    // 重新灌一遍消息（上一步 deleteSession 把它们删了），再关掉，制造「有消息、无会话」的升级前态
    const seed = new SqliteStorage(path)
    // seed 打开时 sessions 仍为空、messages 也为空 → 无回填
    await seed.addMessage({ id: 'g1', threadId: 'global', role: 'user', content: '全局问题', createdAt: 10 })
    await seed.addMessage({ id: 'g2', threadId: 'global', role: 'assistant', content: '答', createdAt: 20 })
    await seed.addMessage({ id: 'p1', threadId: 'profile:abc', role: 'user', content: '档内问题', createdAt: 30 })
    expect(await seed.listSessions(null)).toEqual([])
    await seed.close()

    // 第二次打开：migrate() 见到「有消息、无会话」→ 回填
    const upgraded = new SqliteStorage(path)
    const globalSessions = await upgraded.listSessions(null)
    expect(globalSessions.map((s) => s.id)).toEqual(['global'])
    expect(globalSessions[0]!.title).toBe('默认会话')
    // 时间取该线程消息的 min/max
    expect(globalSessions[0]!.createdAt).toBe(10)
    expect(globalSessions[0]!.updatedAt).toBe(20)

    const profileSessions = await upgraded.listSessions('abc')
    expect(profileSessions.map((s) => s.id)).toEqual(['profile:abc'])
    expect(profileSessions[0]!.profileId).toBe('abc')

    // 消息一条没动
    expect((await upgraded.listMessages('global')).map((m) => m.id)).toEqual(['g1', 'g2'])
    expect((await upgraded.listMessages('profile:abc')).map((m) => m.id)).toEqual(['p1'])

    // 再开一次不应重复回填（sessions 非空即跳过）
    await upgraded.close()
    const again = new SqliteStorage(path)
    expect((await again.listSessions(null)).length).toBe(1)
    await again.close()
  })
})
