import type { ConversionProfile } from '@subforge/core'
import type { D1Database } from '@cloudflare/workers-types'
import type { AgentMessage, ChangeDraft, RefreshState, LoginThrottle, Profile, Session, StoredTemplate, Storage, Subscription, Version } from './types.js'
import { draftStatements, profileUpdateStatements, subscriptionUpdateStatement } from './draftSql.js'

/**
 * Cloudflare D1 存储实现（异步）。
 * 表结构与 sqlite 实现一致；建表见 migrations/0001_init.sql（由 wrangler d1 migrations apply 执行）。
 */
export class D1Storage implements Storage {
  constructor(private readonly db: D1Database) {}

  async getRefreshState(id: string): Promise<RefreshState | undefined> {
    const value = await this.db.prepare('SELECT v FROM kv WHERE k = ?').bind(`refresh:${id}`).first<string>('v')
    return value ? JSON.parse(value) : undefined
  }
  async compareRefreshState(id: string, expected: RefreshState | undefined, next: RefreshState): Promise<boolean> {
    const result = expected
      ? await this.db.prepare('UPDATE kv SET v = ? WHERE k = ? AND v = ?').bind(JSON.stringify(next), `refresh:${id}`, JSON.stringify(expected)).run()
      : await this.db.prepare('INSERT OR IGNORE INTO kv (k,v) VALUES (?,?)').bind(`refresh:${id}`, JSON.stringify(next)).run()
    return result.meta.changes === 1
  }

  async listDrafts(): Promise<ChangeDraft[]> {
    const { results } = await this.db.prepare("SELECT v FROM kv WHERE k LIKE 'draft:%'").all<{ v: string }>()
    return results.map((r) => JSON.parse(r.v))
  }
  async getDraft(id: string): Promise<ChangeDraft | undefined> {
    const value = await this.db.prepare('SELECT v FROM kv WHERE k = ?').bind(`draft:${id}`).first<string>('v')
    return value ? JSON.parse(value) : undefined
  }
  async putDraft(draft: ChangeDraft): Promise<void> {
    await this.db.prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(`draft:${draft.id}`, JSON.stringify(draft)).run()
  }
  async deleteDraft(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM kv WHERE k = ?').bind(`draft:${id}`).run()
  }
  async applyDraftChange(draft: ChangeDraft, version?: Version): Promise<boolean> {
    const results = await this.db.batch(draftStatements(draft, version).map((s) => this.db.prepare(s.sql).bind(...s.values)))
    return results[0]!.meta.changes === 1
  }

  // ---- 订阅 ----
  private rowToSub(row: any): Subscription {
    return { ...row, userInfo: row.userInfo ? JSON.parse(row.userInfo) : undefined, fetchPolicy: row.fetchPolicy ? JSON.parse(row.fetchPolicy) : undefined }
  }
  async listSubscriptions(): Promise<Subscription[]> {
    const { results } = await this.db.prepare('SELECT * FROM subscriptions ORDER BY createdAt').all()
    return (results as any[]).map((r) => this.rowToSub(r))
  }
  async getSubscription(id: string): Promise<Subscription | undefined> {
    const r = await this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first()
    return r ? this.rowToSub(r) : undefined
  }
  async replaceSubscription(expected: Subscription, next: Subscription): Promise<boolean> {
    const statement = subscriptionUpdateStatement(expected, next)
    return (await this.db.prepare(statement.sql).bind(...statement.values).run()).meta.changes === 1
  }
  async upsertSubscription(s: Subscription): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO subscriptions (id,name,url,content,fetchedAt,userInfo,fetchPolicy,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,url=excluded.url,content=excluded.content,
           fetchedAt=excluded.fetchedAt,userInfo=excluded.userInfo,fetchPolicy=excluded.fetchPolicy,updatedAt=excluded.updatedAt`,
      )
      .bind(
        s.id, s.name, s.url ?? null, s.content ?? null, s.fetchedAt ?? null,
        s.userInfo ? JSON.stringify(s.userInfo) : null, s.fetchPolicy ? JSON.stringify(s.fetchPolicy) : null, s.createdAt, s.updatedAt,
      )
      .run()
  }
  async deleteSubscription(id: string): Promise<void> {
    const result = await this.db.prepare('DELETE FROM subscriptions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM profiles, json_each(profiles.subscriptionIds) WHERE json_each.value = ?)').bind(id, id).run()
    if (!result.meta.changes && await this.getSubscription(id)) throw new Error(`Subscription is referenced: ${id}`)
  }

  // ---- 配置 ----
  private rowToProfile(row: any): Profile {
    return {
      ...row,
      shareDisabled: !!row.shareDisabled,
      subscriptionIds: JSON.parse(row.subscriptionIds) as string[],
      profile: JSON.parse(row.profile) as ConversionProfile,
    }
  }
  async listProfiles(): Promise<Profile[]> {
    const { results } = await this.db.prepare('SELECT * FROM profiles ORDER BY createdAt').all()
    return (results as any[]).map((r) => this.rowToProfile(r))
  }
  async getProfile(id: string): Promise<Profile | undefined> {
    const r = await this.db.prepare('SELECT * FROM profiles WHERE id = ?').bind(id).first()
    return r ? this.rowToProfile(r) : undefined
  }
  async getProfileByToken(token: string): Promise<Profile | undefined> {
    const r = await this.db.prepare('SELECT * FROM profiles WHERE token = ?').bind(token).first()
    return r ? this.rowToProfile(r) : undefined
  }
  async replaceProfile(expected: Profile, next: Profile, version?: Version): Promise<boolean> {
    const results = await this.db.batch(profileUpdateStatements(expected, next, version).map(s => this.db.prepare(s.sql).bind(...s.values)))
    return results[0]!.meta.changes === 1
  }
  async upsertProfile(p: Profile): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO profiles (id,name,subscriptionIds,target,script,profile,token,shareDisabled,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,subscriptionIds=excluded.subscriptionIds,target=excluded.target,
           script=excluded.script,profile=excluded.profile,token=excluded.token,shareDisabled=excluded.shareDisabled,updatedAt=excluded.updatedAt`,
      )
      .bind(
        p.id, p.name, JSON.stringify(p.subscriptionIds), p.target, p.script ?? null,
        JSON.stringify(p.profile), p.token, p.shareDisabled ? 1 : 0, p.createdAt, p.updatedAt,
      )
      .run()
  }
  async deleteProfile(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM profiles WHERE id = ?').bind(id).run()
  }

  // ---- 版本 ----
  async listVersions(entityId: string): Promise<Version[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM versions WHERE entityId = ? ORDER BY createdAt DESC')
      .bind(entityId)
      .all()
    return results as unknown as Version[]
  }
  async getVersion(id: string): Promise<Version | undefined> {
    const r = await this.db.prepare('SELECT * FROM versions WHERE id = ?').bind(id).first()
    return (r as unknown as Version) ?? undefined
  }
  async addVersion(v: Version): Promise<void> {
    await this.db
      .prepare('INSERT INTO versions (id,entity,entityId,snapshot,note,createdAt) VALUES (?,?,?,?,?,?)')
      .bind(v.id, v.entity, v.entityId, v.snapshot, v.note ?? null, v.createdAt)
      .run()
  }

  // ---- 模板 ----
  private rowToTemplate(row: any): StoredTemplate {
    return { ...row, profile: JSON.parse(row.profile) as ConversionProfile }
  }
  async listTemplates(): Promise<StoredTemplate[]> {
    const { results } = await this.db.prepare('SELECT * FROM templates ORDER BY updatedAt DESC').all()
    return (results as any[]).map((r) => this.rowToTemplate(r))
  }
  async getTemplate(id: string): Promise<StoredTemplate | undefined> {
    const r = await this.db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first()
    return r ? this.rowToTemplate(r) : undefined
  }
  async upsertTemplate(t: StoredTemplate): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO templates (id,name,description,profile,script,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
           profile=excluded.profile,script=excluded.script,updatedAt=excluded.updatedAt`,
      )
      .bind(t.id, t.name, t.description ?? null, JSON.stringify(t.profile), t.script ?? null, t.createdAt, t.updatedAt)
      .run()
  }
  async deleteTemplate(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM templates WHERE id = ?').bind(id).run()
  }

  // ---- 会话 ----
  private rowToSession(r: any): Session {
    return { id: r.id, title: r.title, profileId: r.profileId ?? undefined, createdAt: r.createdAt, updatedAt: r.updatedAt }
  }
  async listSessions(profileId: string | null): Promise<Session[]> {
    const { results } =
      profileId == null
        ? await this.db.prepare('SELECT * FROM sessions WHERE profileId IS NULL ORDER BY updatedAt DESC').all()
        : await this.db.prepare('SELECT * FROM sessions WHERE profileId = ? ORDER BY updatedAt DESC').bind(profileId).all()
    return (results as any[]).map((r) => this.rowToSession(r))
  }
  async getSession(id: string): Promise<Session | undefined> {
    const r = await this.db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first()
    return r ? this.rowToSession(r) : undefined
  }
  async upsertSession(s: Session): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sessions (id,title,profileId,createdAt,updatedAt)
         VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title,profileId=excluded.profileId,updatedAt=excluded.updatedAt`,
      )
      .bind(s.id, s.title, s.profileId ?? null, s.createdAt, s.updatedAt)
      .run()
  }
  async touchSession(id: string, at: number): Promise<void> {
    await this.db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').bind(at, id).run()
  }
  async deleteSession(id: string): Promise<void> {
    // 先删消息再删会话；D1 无本地事务，两条顺序执行即可（删消息失败则会话仍在，可重试）
    await this.db.prepare('DELETE FROM messages WHERE threadId = ?').bind(id).run()
    await this.db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
  }

  // ---- 记忆 ----
  async listMessages(threadId: string): Promise<AgentMessage[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM messages WHERE threadId = ? ORDER BY createdAt')
      .bind(threadId)
      .all()
    return (results as any[]).map((r) => ({
      ...r,
      tools: r.tools ? JSON.parse(r.tools) : undefined,
      trace: r.trace ? JSON.parse(r.trace) : undefined,
    })) as AgentMessage[]
  }
  async addMessage(m: AgentMessage): Promise<void> {
    await this.db
      .prepare('INSERT INTO messages (id,threadId,role,content,tools,trace,createdAt) VALUES (?,?,?,?,?,?,?)')
      .bind(
        m.id,
        m.threadId,
        m.role,
        m.content,
        m.tools ? JSON.stringify(m.tools) : null,
        m.trace ? JSON.stringify(m.trace) : null,
        m.createdAt,
      )
      .run()
  }
  async clearThread(threadId: string): Promise<void> {
    await this.db.prepare('DELETE FROM messages WHERE threadId = ?').bind(threadId).run()
  }
  async getWorkingMemory(): Promise<string> {
    const r = (await this.db.prepare("SELECT v FROM kv WHERE k = 'working_memory'").first('v')) as string | null
    return r ?? ''
  }
  async setWorkingMemory(text: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO kv (k,v) VALUES ('working_memory',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(text)
      .run()
  }

  async getSettings(): Promise<string | undefined> {
    const r = (await this.db.prepare("SELECT v FROM kv WHERE k = 'settings'").first('v')) as string | null
    return r ?? undefined
  }
  async setSettings(json: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO kv (k,v) VALUES ('settings',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(json)
      .run()
  }

  async getAuth(): Promise<string | undefined> {
    const r = (await this.db.prepare("SELECT v FROM kv WHERE k = 'auth'").first('v')) as string | null
    return r ?? undefined
  }
  async setAuth(json: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO kv (k,v) VALUES ('auth',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(json)
      .run()
  }
  async createAuthIfUninitialized(json: string): Promise<boolean> {
    const result = await this.db
      .prepare(
         `INSERT INTO kv (k,v) VALUES ('auth',?)
         ON CONFLICT(k) DO UPDATE SET v=excluded.v
         WHERE CASE WHEN json_valid(kv.v) THEN json_extract(kv.v, '$.account') IS NULL ELSE 0 END`,
      )
      .bind(json)
      .run()
    return result.meta.changes === 1
  }

  async getLoginThrottle(key: string): Promise<LoginThrottle | undefined> {
    const row = await this.db
      .prepare('SELECT failures, lockedUntil FROM login_throttles WHERE key = ?')
      .bind(key)
      .first<LoginThrottle>()
    return row ?? undefined
  }
  async recordLoginFailure(key: string, at: number): Promise<LoginThrottle> {
    const row = await this.db.prepare(loginFailureUpsertSql()).bind(key, at).first<LoginThrottle>()
    if (!row) throw new Error('登录限流状态写入失败')
    return row
  }
  async clearLoginThrottle(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM login_throttles WHERE key = ?').bind(key).run()
  }

  async close(): Promise<void> {
    /* D1 无需显式关闭 */
  }
}

function loginFailureUpsertSql(): string {
  const next = 'MIN(login_throttles.failures + 1, 12)'
  return `INSERT INTO login_throttles (key, failures, lockedUntil, updatedAt)
    VALUES (?, 1, 0, ?)
    ON CONFLICT(key) DO UPDATE SET
      failures = ${next},
      lockedUntil = CASE ${next}
        WHEN 5 THEN excluded.updatedAt + 30000 WHEN 6 THEN excluded.updatedAt + 60000
        WHEN 7 THEN excluded.updatedAt + 120000 WHEN 8 THEN excluded.updatedAt + 240000
        WHEN 9 THEN excluded.updatedAt + 480000 WHEN 10 THEN excluded.updatedAt + 960000
        WHEN 11 THEN excluded.updatedAt + 1920000 WHEN 12 THEN excluded.updatedAt + 3600000
        ELSE 0 END,
      updatedAt = excluded.updatedAt
    RETURNING failures, lockedUntil`
}
