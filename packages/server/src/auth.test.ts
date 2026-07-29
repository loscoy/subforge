import { describe, expect, it } from 'vitest'
import {
  SESSION_TTL_MS,
  addSession,
  hashPassword,
  hasValidSession,
  loadAuthState,
  revokeSession,
  saveAuthState,
  verifyPassword,
  type AuthState,
} from './auth.js'
import { InMemoryStorage } from './storage/index.js'

describe('密码哈希', () => {
  it('正确密码通过、错误密码拒绝', async () => {
    const account = { username: 'admin', ...(await hashPassword('s3cret-pass')) }
    expect(await verifyPassword('s3cret-pass', account)).toBe(true)
    expect(await verifyPassword('wrong', account)).toBe(false)
  })

  it('同一密码两次哈希盐与结果都不同', async () => {
    const a = await hashPassword('p@ssw0rd!')
    const b = await hashPassword('p@ssw0rd!')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })
})

describe('会话', () => {
  it('建立 → 校验 → 吊销；过期与伪造 token 均拒绝', async () => {
    const state: AuthState = { sessions: [] }
    const token = await addSession(state, 1000)
    expect(await hasValidSession(state, token, 2000)).toBe(true)
    expect(await hasValidSession(state, 'bogus-token', 2000)).toBe(false)
    expect(await hasValidSession(state, token, 1000 + SESSION_TTL_MS + 1)).toBe(false)
    await revokeSession(state, token)
    expect(await hasValidSession(state, token, 2000)).toBe(false)
  })

  it('addSession 顺带清理过期会话', async () => {
    const state: AuthState = { sessions: [{ tokenHash: 'old', createdAt: 0, expiresAt: 10 }] }
    await addSession(state, 1000)
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]!.tokenHash).not.toBe('old')
  })

  it('状态经存储 round-trip 后会话仍有效', async () => {
    const storage = new InMemoryStorage()
    const state: AuthState = { account: { username: 'admin', ...(await hashPassword('p@ssw0rd!')) }, sessions: [] }
    const token = await addSession(state, 1)
    await saveAuthState(storage, state)
    const loaded = await loadAuthState(storage)
    expect(loaded.account?.username).toBe('admin')
    expect(await hasValidSession(loaded, token, 2)).toBe(true)
  })

  it('auth 键损坏时按未初始化处理（失败关闭同款语义）', async () => {
    const storage = new InMemoryStorage()
    await storage.setAuth('not-json{{{')
    const loaded = await loadAuthState(storage)
    expect(loaded.account).toBeUndefined()
    expect(loaded.sessions).toEqual([])
  })
})
