import Database from 'better-sqlite3'
import type { ConversionProfile } from '@subforge/core'
import type { AgentMessage, Profile, Session, StoredTemplate, Storage, Subscription, Version } from './types.js'

/**
 * better-sqlite3 持久化实现。
 * better-sqlite3 本身是同步 API，这里用 async 方法包一层以符合 Storage 接口。
 */
export class SqliteStorage implements Storage {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT, content TEXT,
        fetchedAt INTEGER, userInfo TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, subscriptionIds TEXT NOT NULL,
        target TEXT NOT NULL, script TEXT, profile TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY, entity TEXT NOT NULL, entityId TEXT NOT NULL,
        snapshot TEXT NOT NULL, note TEXT, createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_versions_entity ON versions(entityId, createdAt DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, threadId TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, tools TEXT, trace TEXT, createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(threadId, createdAt);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, profile TEXT NOT NULL,
        script TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, profileId TEXT,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profileId, updatedAt DESC);
    `)
    const cols = this.db.prepare('PRAGMA table_info(subscriptions)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'userInfo')) {
      this.db.exec('ALTER TABLE subscriptions ADD COLUMN userInfo TEXT')
    }
    const msgCols = this.db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
    if (!msgCols.some((c) => c.name === 'tools')) {
      this.db.exec('ALTER TABLE messages ADD COLUMN tools TEXT')
    }
    if (!msgCols.some((c) => c.name === 'trace')) {
      this.db.exec('ALTER TABLE messages ADD COLUMN trace TEXT')
    }
    // 回填：把 sessions 之前就存在的对话线程（global / profile:<id>）变成会话记录，
    // 历史消息一条不动。只在 sessions 空且确有历史消息时跑一次；新库两者皆空，天然跳过。
    const hasSession = this.db.prepare('SELECT 1 FROM sessions LIMIT 1').get()
    if (!hasSession) {
      this.db.exec(`
        INSERT INTO sessions (id, title, profileId, createdAt, updatedAt)
        SELECT threadId, '默认会话',
               CASE WHEN threadId LIKE 'profile:%' THEN substr(threadId, 9) END,
               MIN(createdAt), MAX(createdAt)
        FROM messages GROUP BY threadId;
      `)
    }
  }

  // ---- 订阅 ----
  private rowToSub(row: any): Subscription {
    return { ...row, userInfo: row.userInfo ? JSON.parse(row.userInfo) : undefined }
  }
  async listSubscriptions(): Promise<Subscription[]> {
    return (this.db.prepare('SELECT * FROM subscriptions ORDER BY createdAt').all() as any[]).map((r) => this.rowToSub(r))
  }
  async getSubscription(id: string): Promise<Subscription | undefined> {
    const r = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id)
    return r ? this.rowToSub(r) : undefined
  }
  async upsertSubscription(s: Subscription): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO subscriptions (id,name,url,content,fetchedAt,userInfo,createdAt,updatedAt)
         VALUES (@id,@name,@url,@content,@fetchedAt,@userInfo,@createdAt,@updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name=@name,url=@url,content=@content,fetchedAt=@fetchedAt,userInfo=@userInfo,updatedAt=@updatedAt`,
      )
      .run({ url: null, content: null, fetchedAt: null, ...s, userInfo: s.userInfo ? JSON.stringify(s.userInfo) : null })
  }
  async deleteSubscription(id: string): Promise<void> {
    this.db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
  }

  // ---- 配置 ----
  private rowToProfile(row: any): Profile {
    return {
      ...row,
      subscriptionIds: JSON.parse(row.subscriptionIds) as string[],
      profile: JSON.parse(row.profile) as ConversionProfile,
    }
  }
  async listProfiles(): Promise<Profile[]> {
    return (this.db.prepare('SELECT * FROM profiles ORDER BY createdAt').all() as any[]).map((r) => this.rowToProfile(r))
  }
  async getProfile(id: string): Promise<Profile | undefined> {
    const r = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
    return r ? this.rowToProfile(r) : undefined
  }
  async getProfileByToken(token: string): Promise<Profile | undefined> {
    const r = this.db.prepare('SELECT * FROM profiles WHERE token = ?').get(token)
    return r ? this.rowToProfile(r) : undefined
  }
  async upsertProfile(p: Profile): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO profiles (id,name,subscriptionIds,target,script,profile,token,createdAt,updatedAt)
         VALUES (@id,@name,@subscriptionIds,@target,@script,@profile,@token,@createdAt,@updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name=@name,subscriptionIds=@subscriptionIds,target=@target,script=@script,
           profile=@profile,token=@token,updatedAt=@updatedAt`,
      )
      .run({
        ...p,
        script: p.script ?? null,
        subscriptionIds: JSON.stringify(p.subscriptionIds),
        profile: JSON.stringify(p.profile),
      })
  }
  async deleteProfile(id: string): Promise<void> {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }

  // ---- 版本 ----
  async listVersions(entityId: string): Promise<Version[]> {
    return this.db
      .prepare('SELECT * FROM versions WHERE entityId = ? ORDER BY createdAt DESC')
      .all(entityId) as Version[]
  }
  async getVersion(id: string): Promise<Version | undefined> {
    return this.db.prepare('SELECT * FROM versions WHERE id = ?').get(id) as Version | undefined
  }
  async addVersion(v: Version): Promise<void> {
    this.db
      .prepare('INSERT INTO versions (id,entity,entityId,snapshot,note,createdAt) VALUES (@id,@entity,@entityId,@snapshot,@note,@createdAt)')
      .run({ note: null, ...v })
  }

  // ---- 模板 ----
  private rowToTemplate(row: any): StoredTemplate {
    return { ...row, profile: JSON.parse(row.profile) as ConversionProfile }
  }
  async listTemplates(): Promise<StoredTemplate[]> {
    return (this.db.prepare('SELECT * FROM templates ORDER BY updatedAt DESC').all() as any[]).map((r) => this.rowToTemplate(r))
  }
  async getTemplate(id: string): Promise<StoredTemplate | undefined> {
    const r = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id)
    return r ? this.rowToTemplate(r) : undefined
  }
  async upsertTemplate(t: StoredTemplate): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO templates (id,name,description,profile,script,createdAt,updatedAt)
         VALUES (@id,@name,@description,@profile,@script,@createdAt,@updatedAt)
         ON CONFLICT(id) DO UPDATE SET name=@name,description=@description,profile=@profile,script=@script,updatedAt=@updatedAt`,
      )
      .run({ description: null, script: null, ...t, profile: JSON.stringify(t.profile) })
  }
  async deleteTemplate(id: string): Promise<void> {
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  }

  // ---- 会话 ----
  private rowToSession(r: any): Session {
    return { id: r.id, title: r.title, profileId: r.profileId ?? undefined, createdAt: r.createdAt, updatedAt: r.updatedAt }
  }
  async listSessions(profileId: string | null): Promise<Session[]> {
    const rows = (
      profileId == null
        ? this.db.prepare('SELECT * FROM sessions WHERE profileId IS NULL ORDER BY updatedAt DESC').all()
        : this.db.prepare('SELECT * FROM sessions WHERE profileId = ? ORDER BY updatedAt DESC').all(profileId)
    ) as any[]
    return rows.map((r) => this.rowToSession(r))
  }
  async getSession(id: string): Promise<Session | undefined> {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
    return r ? this.rowToSession(r) : undefined
  }
  async upsertSession(s: Session): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sessions (id,title,profileId,createdAt,updatedAt)
         VALUES (@id,@title,@profileId,@createdAt,@updatedAt)
         ON CONFLICT(id) DO UPDATE SET title=@title,profileId=@profileId,updatedAt=@updatedAt`,
      )
      .run({ ...s, profileId: s.profileId ?? null })
  }
  async touchSession(id: string, at: number): Promise<void> {
    this.db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(at, id)
  }
  async deleteSession(id: string): Promise<void> {
    // 会话与其消息一并删除，避免留下无归属的孤儿消息
    const tx = this.db.transaction((sid: string) => {
      this.db.prepare('DELETE FROM messages WHERE threadId = ?').run(sid)
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid)
    })
    tx(id)
  }

  // ---- 记忆 ----
  async listMessages(threadId: string): Promise<AgentMessage[]> {
    const rows = this.db.prepare('SELECT * FROM messages WHERE threadId = ? ORDER BY createdAt').all(threadId) as any[]
    return rows.map((r) => ({
      ...r,
      tools: r.tools ? JSON.parse(r.tools) : undefined,
      trace: r.trace ? JSON.parse(r.trace) : undefined,
    }))
  }
  async addMessage(m: AgentMessage): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO messages (id,threadId,role,content,tools,trace,createdAt) VALUES (@id,@threadId,@role,@content,@tools,@trace,@createdAt)',
      )
      .run({
        id: m.id,
        threadId: m.threadId,
        role: m.role,
        content: m.content,
        tools: m.tools ? JSON.stringify(m.tools) : null,
        trace: m.trace ? JSON.stringify(m.trace) : null,
        createdAt: m.createdAt,
      })
  }
  async clearThread(threadId: string): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE threadId = ?').run(threadId)
  }
  async getWorkingMemory(): Promise<string> {
    const r = this.db.prepare("SELECT v FROM kv WHERE k = 'working_memory'").get() as { v: string } | undefined
    return r?.v ?? ''
  }
  async setWorkingMemory(text: string): Promise<void> {
    this.db
      .prepare("INSERT INTO kv (k,v) VALUES ('working_memory',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .run(text)
  }

  async getSettings(): Promise<string | undefined> {
    const r = this.db.prepare("SELECT v FROM kv WHERE k = 'settings'").get() as { v: string } | undefined
    return r?.v
  }
  async setSettings(json: string): Promise<void> {
    this.db.prepare("INSERT INTO kv (k,v) VALUES ('settings',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(json)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
