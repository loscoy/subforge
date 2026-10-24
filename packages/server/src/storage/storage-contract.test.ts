import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { D1Storage } from './d1.js'
import { InMemoryStorage } from './memory.js'
import { SqliteStorage } from './sqlite.js'
import type { ChangeDraft, Profile, Storage } from './types.js'
import { createApp } from '../routes/app.js'
import { getConfig } from '../config.js'
import { QuickJsRunner } from '../sandbox/quickjs.js'
import { rollbackProfile, saveProfileWithVersion } from '../service.js'

/**
 * 用 better-sqlite3 伪造一个 D1Database，实现 D1Storage 用到的 prepare/bind/all/first/run，
 * 从而在无 workerd 的环境下验证 D1Storage 的 SQL 与参数绑定正确性。
 */
function makeFakeD1(): any {
  const db = new Database(':memory:')
  for (const f of [
    '0001_init.sql',
    '0002_templates.sql',
    '0003_message_tools.sql',
    '0004_message_trace.sql',
    '0005_sessions.sql',
    '0006_login_throttles.sql',
    '0007_share_disabled.sql',
    '0008_subscription_policy.sql',
  ]) {
    db.exec(readFileSync(fileURLToPath(new URL(`../../migrations/${f}`, import.meta.url)), 'utf-8'))
  }
  return {
    async batch(statements: { runSync(): unknown }[]) {
      return db.transaction(() => statements.map((s) => s.runSync()))()
    },
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
          return api.runSync()
        },
        runSync() {
          const result = stmt.run(...args)
          return { success: true, meta: { changes: result.changes } }
        },
      }
      return api
    },
  }
}

function runContract(name: string, make: () => Storage) {
  describe(`Storage 契约: ${name}`, () => {
    it.each(['save', 'rollback', 'share'])('HTTP %s 的过期写入不能覆盖并发配置或分享变更', async (action) => {
      const s = make()
      const original: Profile = { id: 'p', name: 'Original', target: 'mihomo', subscriptionIds: [], profile: { groups: [], rules: [] }, token: 'old-token', createdAt: 1, updatedAt: 1 }
      await s.upsertProfile(original)
      await s.addVersion({ id: 'old', entity: 'profile', entityId: 'p', snapshot: JSON.stringify({ ...original, name: 'Rollback' }), createdAt: 1 })
      let release!: () => void
      let reached!: () => void
      const paused = new Promise<void>(resolve => { reached = resolve })
      const resume = new Promise<void>(resolve => { release = resolve })
      let first = true
      const storage = new Proxy(s, {
        get(target, key) {
          if (key === 'replaceProfile') return async (...args: Parameters<Storage['replaceProfile']>) => {
            if (first) { first = false; reached(); await resume }
            return target.replaceProfile(...args)
          }
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const app = createApp({ storage, runner: new QuickJsRunner(), config: { ...getConfig(), allowNoAuth: true } })
      const request = (path: string, method: string, body: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const pending = action === 'save' ? request('/api/profiles/p', 'PUT', { name: 'Stale save' })
        : action === 'rollback' ? request('/api/profiles/p/rollback', 'POST', { versionId: 'old' })
        : request('/api/profiles/p/share', 'POST', { action: 'disable' })
      await paused
      if (action === 'share') {
        expect((await request('/api/profiles/p', 'PUT', { name: 'New config' })).status).toBe(200)
      } else {
        expect((await request('/api/profiles/p/share', 'POST', { action: 'rotate' })).status).toBe(200)
        expect((await request('/api/profiles/p/share', 'POST', { action: 'disable' })).status).toBe(200)
      }
      release()
      expect((await pending).status).toBe(action === 'rollback' ? 400 : 409)
      const current = (await s.getProfile('p'))!
      if (action === 'share') {
        expect(current.name).toBe('New config')
        expect(current.shareDisabled).toBeFalsy()
        expect(await s.listVersions('p')).toHaveLength(2)
      } else {
        expect(current.name).toBe('Original')
        expect(current.token).not.toBe('old-token')
        expect(current.shareDisabled).toBe(true)
        expect((await app.request('/sub/old-token')).status).toBe(404)
        expect((await app.request(`/sub/${current.token}`)).status).toBe(404)
        expect(await s.listVersions('p')).toHaveLength(1)
      }
      expect((await request('/api/profiles/p', 'PUT', { name: 'Stale editor', updatedAt: 1 })).status).toBe(409)
      await s.close()
    })

    it('回滚与删除来源在写入边界互斥；缺失来源回滚不落版本并说明 ID', async () => {
      const s = make()
      await s.upsertSubscription({ id: 'source-a', name: 'A', createdAt: 1, updatedAt: 1 })
      const original: Profile = { id: 'p', name: 'Original', target: 'mihomo', subscriptionIds: ['source-a'], profile: { groups: [], rules: [] }, token: 'token', createdAt: 1, updatedAt: 1 }
      await s.upsertProfile(original)
      let detached = await saveProfileWithVersion(s, original, { ...original, subscriptionIds: [] })
      const [version] = await s.listVersions('p')
      // 恢复引用先写入时，紧随其后的删除必须失败。
      expect(await s.replaceProfile(detached, original)).toBe(true)
      await expect(s.deleteSubscription('source-a')).rejects.toThrow('referenced')
      detached = await saveProfileWithVersion(s, original, { ...original, subscriptionIds: [] })
      const count = (await s.listVersions('p')).length
      // 删除先写入时，过期的恢复引用写入必须失败。
      await s.deleteSubscription('source-a')
      expect(await s.replaceProfile(detached, original, { ...version!, id: 'rejected' })).toBe(false)
      await expect(rollbackProfile(s, 'p', version!.id)).rejects.toThrow('Missing subscriptions: source-a')
      expect((await s.getProfile('p'))!.subscriptionIds).toEqual([])
      expect(await s.listVersions('p')).toHaveLength(count)
      await s.close()
    })

    it('缓存写回比较完整旧值，时间戳相同也不能覆盖已编辑来源', async () => {
      const s = make()
      const source = { id: 's', name: 'S', url: 'https://example.com/old', content: 'old', createdAt: 1, updatedAt: 1 }
      await s.upsertSubscription(source)
      const changed = { ...source, url: 'https://example.com/new', content: undefined }
      await s.upsertSubscription(changed)
      expect(await s.replaceSubscription(source, { ...source, content: 'stale result' })).toBe(false)
      expect((await s.getSubscription('s'))!.url).toBe(changed.url)
      expect(await s.replaceSubscription(changed, { ...changed, content: 'new result' })).toBe(true)
      expect((await s.getSubscription('s'))!.content).toBe('new result')
      await s.close()
    })

    it('刷新状态原子抢占、过期写入不能覆盖新状态', async () => {
      const s = make()
      const first = { source: 'source', lastAttempt: 1, leaseUntil: 60, failures: 0, alerts: [], history: [] }
      expect(await s.getRefreshState('s')).toBeUndefined()
      expect(await s.compareRefreshState('s', undefined, first)).toBe(true)
      expect(await s.compareRefreshState('s', undefined, first)).toBe(false)
      const next = { ...first, leaseUntil: 0, failures: 1, alerts: ['failed'], history: [{ at: 2, ok: false, error: 'HTTP 500' }] }
      expect(await s.compareRefreshState('s', first, next)).toBe(true)
      expect(await s.compareRefreshState('s', first, first)).toBe(false)
      expect(await s.getRefreshState('s')).toEqual(next)
      await s.close()
    })

    it('草稿原子应用、拒绝过期来源、单次消费并保留版本', async () => {
      const s = make()
      const source = { id: 's', name: 'S', content: 'trojan://p@example.com:443#A', createdAt: 1, updatedAt: 1 }
      await s.upsertSubscription(source)
      const profile: Profile = { id: 'p', name: 'P', target: 'mihomo', subscriptionIds: ['s'], profile: { groups: [], rules: [] }, token: 'token', createdAt: 1, updatedAt: 1 }
      await s.upsertProfile(profile)
      const before = (await s.getProfile('p'))!
      const draft: ChangeDraft = { id: 'd', tool: 'update_profile', entity: 'profiles', entityId: 'p', before, after: { ...before, name: 'Changed', updatedAt: 2 }, createdAt: 2, sources: [(await s.getSubscription('s'))!], validation: { ok: true, warnings: [] }, diff: [] }
      await s.putDraft(draft)
      await s.upsertSubscription({ ...source, content: 'trojan://q@example.org:443#B' })
      const version = { id: 'v', entity: 'profile' as const, entityId: 'p', snapshot: '{}', createdAt: 2 }
      expect(await s.applyDraftChange(draft, version)).toBe(false)
      expect(await s.listVersions('p')).toEqual([])
      expect((await s.getProfile('p'))!.name).toBe('P')
      await s.upsertSubscription(source)
      expect(await s.applyDraftChange(draft, version)).toBe(true)
      expect((await s.getProfile('p'))!.name).toBe('Changed')
      expect(await s.listVersions('p')).toHaveLength(1)
      expect(await s.getDraft('d')).toBeUndefined()
      expect(await s.applyDraftChange(draft, version)).toBe(false)
      await s.putDraft({ ...draft, id: 'stale', sources: [] })
      expect(await s.applyDraftChange((await s.getDraft('stale'))!)).toBe(false)
      expect(await s.listDrafts()).toHaveLength(1)
      await s.deleteDraft('stale')
      expect(await s.listDrafts()).toEqual([])
    })

    it('订阅 CRUD', async () => {
      const s = make()
      await s.upsertSubscription({ id: 'a', name: '订阅A', url: 'http://x', createdAt: 1, updatedAt: 1 })
      await s.upsertSubscription({ id: 'a', name: '订阅A改', createdAt: 1, updatedAt: 2, userInfo: { total: 100, download: 30 }, fetchPolicy: { userAgent: 'test-agent', maxAgeMinutes: 30 } })
      const got = await s.getSubscription('a')
      expect(got!.name).toBe('订阅A改')
      expect(got!.userInfo!.total).toBe(100)
      expect(got!.fetchPolicy).toEqual({ userAgent: 'test-agent', maxAgeMinutes: 30 })
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
      await s.upsertProfile({ ...byId!, token: 'rotated', shareDisabled: true })
      expect(await s.getProfileByToken('tok123')).toBeUndefined()
      expect((await s.getProfileByToken('rotated'))!.shareDisabled).toBe(true)
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

    it('auth kv 读写', async () => {
      const s = make()
      expect(await s.getAuth()).toBeUndefined()
      await s.setAuth('{"sessions":[]}')
      expect(await s.getAuth()).toBe('{"sessions":[]}')
      await s.setAuth('{"sessions":[{"tokenHash":"x"}]}')
      expect(await s.getAuth()).toBe('{"sessions":[{"tokenHash":"x"}]}')
      // 与 settings 共用 kv 表但互不干扰
      await s.setSettings('{}')
      expect(await s.getAuth()).toBe('{"sessions":[{"tokenHash":"x"}]}')
    })

    it('auth 首建是条件写，不能覆盖已有账号', async () => {
      const s = make()
      const first = '{"account":{"username":"a"},"sessions":[]}'
      const second = '{"account":{"username":"b"},"sessions":[]}'
      expect(await s.createAuthIfUninitialized(first)).toBe(true)
      expect(await s.createAuthIfUninitialized(second)).toBe(false)
      expect(await s.getAuth()).toBe(first)
    })

    it('auth 首建可接管无账号状态，但不覆盖损坏状态', async () => {
      const empty = make()
      await empty.setAuth('{"sessions":[]}')
      expect(await empty.createAuthIfUninitialized('{"account":{"username":"a"},"sessions":[]}')).toBe(true)

      const damaged = make()
      await damaged.setAuth('not-json')
      expect(await damaged.createAuthIfUninitialized('{"account":{"username":"a"},"sessions":[]}')).toBe(false)
      expect(await damaged.getAuth()).toBe('not-json')
    })

    it('登录失败计数跨请求持久化并递增退避', async () => {
      const s = make()
      expect(await s.getLoginThrottle('k')).toBeUndefined()
      for (let i = 1; i <= 4; i += 1) {
        expect(await s.recordLoginFailure('k', 1000)).toEqual({ failures: i, lockedUntil: 0 })
      }
      expect(await s.recordLoginFailure('k', 1000)).toEqual({ failures: 5, lockedUntil: 31_000 })
      expect(await s.recordLoginFailure('k', 40_000)).toEqual({ failures: 6, lockedUntil: 100_000 })
      expect(await s.getLoginThrottle('k')).toEqual({ failures: 6, lockedUntil: 100_000 })
      await s.clearLoginThrottle('k')
      expect(await s.getLoginThrottle('k')).toBeUndefined()
    })
  })
}

runContract('InMemoryStorage', () => new InMemoryStorage())
runContract('SqliteStorage', () => new SqliteStorage(':memory:'))
runContract('D1Storage(fake D1 over sqlite)', () => new D1Storage(makeFakeD1()))
