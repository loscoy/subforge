import type { ConversionProfile } from '@subforge/core'
import type { D1Database } from '@cloudflare/workers-types'
import type { AgentMessage, Profile, StoredTemplate, Storage, Subscription, Version } from './types.js'

/**
 * Cloudflare D1 存储实现（异步）。
 * 表结构与 sqlite 实现一致；建表见 migrations/0001_init.sql（由 wrangler d1 migrations apply 执行）。
 */
export class D1Storage implements Storage {
  constructor(private readonly db: D1Database) {}

  // ---- 订阅 ----
  private rowToSub(row: any): Subscription {
    return { ...row, userInfo: row.userInfo ? JSON.parse(row.userInfo) : undefined }
  }
  async listSubscriptions(): Promise<Subscription[]> {
    const { results } = await this.db.prepare('SELECT * FROM subscriptions ORDER BY createdAt').all()
    return (results as any[]).map((r) => this.rowToSub(r))
  }
  async getSubscription(id: string): Promise<Subscription | undefined> {
    const r = await this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first()
    return r ? this.rowToSub(r) : undefined
  }
  async upsertSubscription(s: Subscription): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO subscriptions (id,name,url,content,fetchedAt,userInfo,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,url=excluded.url,content=excluded.content,
           fetchedAt=excluded.fetchedAt,userInfo=excluded.userInfo,updatedAt=excluded.updatedAt`,
      )
      .bind(
        s.id, s.name, s.url ?? null, s.content ?? null, s.fetchedAt ?? null,
        s.userInfo ? JSON.stringify(s.userInfo) : null, s.createdAt, s.updatedAt,
      )
      .run()
  }
  async deleteSubscription(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run()
  }

  // ---- 转换档 ----
  private rowToProfile(row: any): Profile {
    return {
      ...row,
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
  async upsertProfile(p: Profile): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO profiles (id,name,subscriptionIds,target,script,profile,token,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,subscriptionIds=excluded.subscriptionIds,target=excluded.target,
           script=excluded.script,profile=excluded.profile,token=excluded.token,updatedAt=excluded.updatedAt`,
      )
      .bind(
        p.id, p.name, JSON.stringify(p.subscriptionIds), p.target, p.script ?? null,
        JSON.stringify(p.profile), p.token, p.createdAt, p.updatedAt,
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

  // ---- 记忆 ----
  async listMessages(threadId: string): Promise<AgentMessage[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM messages WHERE threadId = ? ORDER BY createdAt')
      .bind(threadId)
      .all()
    return (results as any[]).map((r) => ({ ...r, tools: r.tools ? JSON.parse(r.tools) : undefined })) as AgentMessage[]
  }
  async addMessage(m: AgentMessage): Promise<void> {
    await this.db
      .prepare('INSERT INTO messages (id,threadId,role,content,tools,createdAt) VALUES (?,?,?,?,?,?)')
      .bind(m.id, m.threadId, m.role, m.content, m.tools ? JSON.stringify(m.tools) : null, m.createdAt)
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

  async close(): Promise<void> {
    /* D1 无需显式关闭 */
  }
}
