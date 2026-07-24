import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { D1Storage } from './d1.js'
import { InMemoryStorage } from './memory.js'
import type { Storage } from './types.js'

/**
 * 用 better-sqlite3 伪造一个 D1Database，实现 D1Storage 用到的 prepare/bind/all/first/run，
 * 从而在无 workerd 的环境下验证 D1Storage 的 SQL 与参数绑定正确性。
 */
function makeFakeD1(): any {
  const db = new Database(':memory:')
  for (const f of ['0001_init.sql', '0002_templates.sql', '0003_message_tools.sql', '0004_message_trace.sql', '0005_sessions.sql']) {
    db.exec(readFileSync(fileURLToPath(new URL(`../../migrations/${f}`, import.meta.url)), 'utf-8'))
  }
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql)
      let args: unknown[] = []
      const api = {
        bind(...a: unknown[]) {
          args = a
          return api
        },
        async all() {
          return { results: stmt.all(...args), success: true }
        },
        async first(col?: string) {
          const r = stmt.get(...args) as any
          if (col) return r ? r[col] : null
          return r ?? null
        },
        async run() {
          stmt.run(...args)
          return { success: true }
        },
      }
      return api
    },
  }
}

function runContract(name: string, make: () => Storage) {
  describe(`Storage 契约: ${name}`, () => {
    it('订阅 CRUD', async () => {
      const s = make()
      await s.upsertSubscription({ id: 'a', name: '订阅A', url: 'http://x', createdAt: 1, updatedAt: 1 })
      await s.upsertSubscription({ id: 'a', name: '订阅A改', createdAt: 1, updatedAt: 2, userInfo: { total: 100, download: 30 } })
      const got = await s.getSubscription('a')
      expect(got!.name).toBe('订阅A改')
      expect(got!.userInfo!.total).toBe(100)
      expect(await s.listSubscriptions()).toHaveLength(1)
      await s.deleteSubscription('a')
      expect(await s.getSubscription('a')).toBeUndefined()
    })

    it('配置 + token 查询', async () => {
      const s = make()
      await s.upsertProfile({
        id: 'p', name: 'P', subscriptionIds: ['a', 'b'], target: 'mihomo', script: 'return nodes',
        profile: { groups: [{ name: 'G', type: 'select', includeAll: true }], rules: ['MATCH,G'] },
        token: 'tok123', createdAt: 1, updatedAt: 1,
      })
      const byId = await s.getProfile('p')
      expect(byId!.subscriptionIds).toEqual(['a', 'b'])
      expect(byId!.profile.groups[0]!.name).toBe('G')
      const byToken = await s.getProfileByToken('tok123')
      expect(byToken!.id).toBe('p')
      expect(await s.getProfileByToken('nope')).toBeUndefined()
    })

    it('版本历史降序', async () => {
      const s = make()
      await s.addVersion({ id: 'v1', entity: 'profile', entityId: 'p', snapshot: '{}', createdAt: 1 })
      await s.addVersion({ id: 'v2', entity: 'profile', entityId: 'p', snapshot: '{}', createdAt: 2 })
      const vs = await s.listVersions('p')
      expect(vs.map((v) => v.id)).toEqual(['v2', 'v1'])
      expect((await s.getVersion('v1'))!.entityId).toBe('p')
    })

    it('模板 CRUD', async () => {
      const s = make()
      await s.upsertTemplate({
        id: 't1', name: '我的模板', description: 'desc',
        profile: { operations: [{ op: 'dedupe' }], groups: [{ name: 'G', type: 'select', includeAll: true }], rules: ['MATCH,G'] },
        script: 'return nodes', createdAt: 1, updatedAt: 1,
      })
      const got = await s.getTemplate('t1')
      expect(got!.name).toBe('我的模板')
      expect(got!.profile.operations).toEqual([{ op: 'dedupe' }])
      expect(got!.script).toBe('return nodes')
      expect(await s.listTemplates()).toHaveLength(1)
      await s.deleteTemplate('t1')
      expect(await s.getTemplate('t1')).toBeUndefined()
    })

    it('消息与长期记忆', async () => {
      const s = make()
      await s.addMessage({ id: 'm1', threadId: 't', role: 'user', content: 'hi', createdAt: 1 })
      await s.addMessage({ id: 'm2', threadId: 't', role: 'assistant', content: 'yo', tools: ['run_preview', 'write_config'], createdAt: 2 })
      const msgs = await s.listMessages('t')
      expect(msgs.map((m) => m.content)).toEqual(['hi', 'yo'])
      // 工具调用名随 assistant 消息持久化（刷新后仍能展示工具链）
      expect(msgs[0].tools).toBeUndefined()
      expect(msgs[1].tools).toEqual(['run_preview', 'write_config'])
      expect(await s.getWorkingMemory()).toBe('')
      await s.setWorkingMemory('偏好香港分组')
      await s.setWorkingMemory('偏好香港分组+US')
      expect(await s.getWorkingMemory()).toBe('偏好香港分组+US')
    })

    it('消息 trace：思考与工具明细原样往返', async () => {
      const s = make()
      const trace = {
        reasoning: '先看有哪些档，再决定改哪个',
        steps: [
          { id: 'call_1', tool: 'list_profiles', args: {}, result: { profiles: [{ id: 'p1' }] } },
          { id: 'call_2', tool: 'write_script', args: { profileId: 'p1' }, error: '脚本语法错误' },
        ],
      }
      await s.addMessage({ id: 'm1', threadId: 'tr', role: 'user', content: 'hi', createdAt: 1 })
      await s.addMessage({ id: 'm2', threadId: 'tr', role: 'assistant', content: 'ok', tools: ['list_profiles'], trace, createdAt: 2 })
      const msgs = await s.listMessages('tr')
      // 无 trace 的旧消息读出来是 undefined，不是 null / '{}'
      expect(msgs[0].trace).toBeUndefined()
      expect(msgs[1].trace).toEqual(trace)
    })

    it('会话：按组隔离、按 updatedAt 倒序、touch 提前、删除连带清消息', async () => {
      const s = make()
      // 全局组两条 + 某配置档一条
      await s.upsertSession({ id: 's1', title: '全局甲', createdAt: 1, updatedAt: 1 })
      await s.upsertSession({ id: 's2', title: '全局乙', createdAt: 2, updatedAt: 2 })
      await s.upsertSession({ id: 's3', title: '档内', profileId: 'p1', createdAt: 3, updatedAt: 3 })

      // 全局组只看到 profileId 为空的两条，倒序（乙在前）
      expect((await s.listSessions(null)).map((x) => x.id)).toEqual(['s2', 's1'])
      // 某档组只看到该档的
      expect((await s.listSessions('p1')).map((x) => x.id)).toEqual(['s3'])
      // profileId 落库后读出来仍是原值（全局组为 undefined，不是 null）
      expect((await s.getSession('s1'))?.profileId).toBeUndefined()
      expect((await s.getSession('s3'))?.profileId).toBe('p1')

      // touch 把 s1 顶到最前
      await s.touchSession('s1', 99)
      expect((await s.listSessions(null)).map((x) => x.id)).toEqual(['s1', 's2'])
      // touch 不存在的会话是安全 no-op
      await s.touchSession('nope', 100)

      // 删除会话连带删掉它的消息
      await s.addMessage({ id: 'sm1', threadId: 's1', role: 'user', content: 'hi', createdAt: 1 })
      await s.deleteSession('s1')
      expect(await s.getSession('s1')).toBeUndefined()
      expect(await s.listMessages('s1')).toEqual([])
      expect((await s.listSessions(null)).map((x) => x.id)).toEqual(['s2'])
    })

    it('运行时设置：未写入时为 undefined，写入可覆盖', async () => {
      const s = make()
      // 与长期记忆区分：空设置是 undefined 而非 ''，settings.ts 据此走默认值
      expect(await s.getSettings()).toBeUndefined()
      await s.setSettings('{"agent":{"model":"a"}}')
      expect(await s.getSettings()).toBe('{"agent":{"model":"a"}}')
      await s.setSettings('{"agent":{"model":"b"}}')
      expect(await s.getSettings()).toBe('{"agent":{"model":"b"}}')
      // 与长期记忆共用 kv 表但互不干扰
      await s.setWorkingMemory('mem')
      expect(await s.getSettings()).toBe('{"agent":{"model":"b"}}')
    })
  })
}

runContract('InMemoryStorage', () => new InMemoryStorage())
runContract('D1Storage(fake D1 over sqlite)', () => new D1Storage(makeFakeD1()))
