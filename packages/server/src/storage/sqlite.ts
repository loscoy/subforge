import Database from 'better-sqlite3'
import type { ConversionProfile } from '@subforge/core'
import type { AgentMessage, Profile, Storage, Subscription, Version } from './types.js'

/** better-sqlite3 持久化实现。 */
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
        content TEXT NOT NULL, createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(threadId, createdAt);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `)
    // 旧库补列（幂等）
    const cols = this.db.prepare('PRAGMA table_info(subscriptions)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'userInfo')) {
      this.db.exec('ALTER TABLE subscriptions ADD COLUMN userInfo TEXT')
    }
  }

  // ---- 订阅 ----
  private rowToSub(row: any): Subscription {
    return { ...row, userInfo: row.userInfo ? JSON.parse(row.userInfo) : undefined }
  }
  listSubscriptions(): Subscription[] {
    return (this.db.prepare('SELECT * FROM subscriptions ORDER BY createdAt').all() as any[]).map((r) => this.rowToSub(r))
  }
  getSubscription(id: string): Subscription | undefined {
    const r = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id)
    return r ? this.rowToSub(r) : undefined
  }
  upsertSubscription(s: Subscription): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (id,name,url,content,fetchedAt,userInfo,createdAt,updatedAt)
         VALUES (@id,@name,@url,@content,@fetchedAt,@userInfo,@createdAt,@updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name=@name,url=@url,content=@content,fetchedAt=@fetchedAt,userInfo=@userInfo,updatedAt=@updatedAt`,
      )
      .run({ url: null, content: null, fetchedAt: null, ...s, userInfo: s.userInfo ? JSON.stringify(s.userInfo) : null })
  }
  deleteSubscription(id: string): void {
    this.db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
  }

  // ---- 转换档 ----
  private rowToProfile(row: any): Profile {
    return {
      ...row,
      subscriptionIds: JSON.parse(row.subscriptionIds) as string[],
      profile: JSON.parse(row.profile) as ConversionProfile,
    }
  }
  listProfiles(): Profile[] {
    return (this.db.prepare('SELECT * FROM profiles ORDER BY createdAt').all() as any[]).map((r) => this.rowToProfile(r))
  }
  getProfile(id: string): Profile | undefined {
    const r = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
    return r ? this.rowToProfile(r) : undefined
  }
  getProfileByToken(token: string): Profile | undefined {
    const r = this.db.prepare('SELECT * FROM profiles WHERE token = ?').get(token)
    return r ? this.rowToProfile(r) : undefined
  }
  upsertProfile(p: Profile): void {
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
  deleteProfile(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }

  // ---- 版本 ----
  listVersions(entityId: string): Version[] {
    return this.db
      .prepare('SELECT * FROM versions WHERE entityId = ? ORDER BY createdAt DESC')
      .all(entityId) as Version[]
  }
  getVersion(id: string): Version | undefined {
    return this.db.prepare('SELECT * FROM versions WHERE id = ?').get(id) as Version | undefined
  }
  addVersion(v: Version): void {
    this.db
      .prepare('INSERT INTO versions (id,entity,entityId,snapshot,note,createdAt) VALUES (@id,@entity,@entityId,@snapshot,@note,@createdAt)')
      .run({ note: null, ...v })
  }

  // ---- 记忆 ----
  listMessages(threadId: string): AgentMessage[] {
    return this.db.prepare('SELECT * FROM messages WHERE threadId = ? ORDER BY createdAt').all(threadId) as AgentMessage[]
  }
  addMessage(m: AgentMessage): void {
    this.db
      .prepare('INSERT INTO messages (id,threadId,role,content,createdAt) VALUES (@id,@threadId,@role,@content,@createdAt)')
      .run(m)
  }
  clearThread(threadId: string): void {
    this.db.prepare('DELETE FROM messages WHERE threadId = ?').run(threadId)
  }
  getWorkingMemory(): string {
    const r = this.db.prepare("SELECT v FROM kv WHERE k = 'working_memory'").get() as { v: string } | undefined
    return r?.v ?? ''
  }
  setWorkingMemory(text: string): void {
    this.db
      .prepare("INSERT INTO kv (k,v) VALUES ('working_memory',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .run(text)
  }

  close(): void {
    this.db.close()
  }
}
