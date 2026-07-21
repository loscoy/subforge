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
  for (const f of ['0001_init.sql', '0002_templates.sql', '0003_message_tools.sql']) {
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

    it('转换档 + token 查询', async () => {
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

    it('消息与工作记忆', async () => {
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
  })
}

runContract('InMemoryStorage', () => new InMemoryStorage())
runContract('D1Storage(fake D1 over sqlite)', () => new D1Storage(makeFakeD1()))
