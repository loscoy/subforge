import type { AgentMessage, ChangeDraft, RefreshState, LoginThrottle, Profile, Session, StoredTemplate, Storage, Subscription, Version } from './types.js'
import { draftValues } from './draftSql.js'

/** 纯内存实现：用于测试，也可作无持久化的临时运行。方法为 async 以符合 Storage 接口。 */
export class InMemoryStorage implements Storage {
  private subs = new Map<string, Subscription>()
  private profiles = new Map<string, Profile>()
  private versions = new Map<string, Version>()
  private templates = new Map<string, StoredTemplate>()
  private sessions = new Map<string, Session>()
  private messages: AgentMessage[] = []
  private workingMemory = ''
  private settings: string | undefined
  private auth: string | undefined
  private loginThrottles = new Map<string, LoginThrottle>()
  private drafts = new Map<string, ChangeDraft>()
  private refreshStates = new Map<string, RefreshState>()

  async getRefreshState(id: string) { return structuredClone(this.refreshStates.get(id)) }
  async compareRefreshState(id: string, expected: RefreshState | undefined, next: RefreshState) {
    if (JSON.stringify(this.refreshStates.get(id)) !== JSON.stringify(expected)) return false
    this.refreshStates.set(id, structuredClone(next))
    return true
  }

  async listDrafts() { return structuredClone([...this.drafts.values()]) }
  async getDraft(id: string) { return structuredClone(this.drafts.get(id)) }
  async putDraft(draft: ChangeDraft) { this.drafts.set(draft.id, structuredClone(draft)) }
  async deleteDraft(id: string) { this.drafts.delete(id) }
  async applyDraftChange(draft: ChangeDraft, version?: Version): Promise<boolean> {
    if (JSON.stringify(this.drafts.get(draft.id)) !== JSON.stringify(draft)) return false
    const map = (draft.entity === 'profiles' ? this.profiles : draft.entity === 'subscriptions' ? this.subs : this.templates) as Map<string, NonNullable<ChangeDraft['before']>>
    const current = map.get(draft.entityId) ?? null
    if (!!current !== !!draft.before || JSON.stringify(draftValues(draft.entity, current)) !== JSON.stringify(draftValues(draft.entity, draft.before))) return false
    if (draft.entity === 'subscriptions' && !draft.after && [...this.profiles.values()].some((p) => p.subscriptionIds.includes(draft.entityId))) return false
    if (draft.entity === 'profiles' && draft.after && (draft.after as Profile).subscriptionIds.some((id) => !this.subs.has(id))) return false
    if (draft.sources?.some((source) => JSON.stringify(draftValues('subscriptions', this.subs.get(source.id) ?? null)) !== JSON.stringify(draftValues('subscriptions', source)))) return false
    if (draft.after) map.set(draft.entityId, structuredClone(draft.after))
    else map.delete(draft.entityId)
    if (version) this.versions.set(version.id, structuredClone(version))
    this.drafts.delete(draft.id)
    return true
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return [...this.subs.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  async getSubscription(id: string) {
    return this.subs.get(id)
  }
  async upsertSubscription(sub: Subscription) {
    this.subs.set(sub.id, sub)
  }
  async replaceSubscription(expected: Subscription, next: Subscription) {
    const current = this.subs.get(expected.id)
    if (!current || JSON.stringify(draftValues('subscriptions', current)) !== JSON.stringify(draftValues('subscriptions', expected))) return false
    this.subs.set(expected.id, structuredClone(next))
    return true
  }
  async deleteSubscription(id: string) {
    if ([...this.profiles.values()].some(p => p.subscriptionIds.includes(id))) throw new Error(`Subscription is referenced: ${id}`)
    this.subs.delete(id)
  }

  async listProfiles(): Promise<Profile[]> {
    return [...this.profiles.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  async getProfile(id: string) {
    return this.profiles.get(id)
  }
  async getProfileByToken(token: string) {
    return [...this.profiles.values()].find((p) => p.token === token)
  }
  async upsertProfile(p: Profile) {
    this.profiles.set(p.id, p)
  }
  async replaceProfile(expected: Profile, next: Profile, version?: Version) {
    const current = this.profiles.get(expected.id)
    if (!current || JSON.stringify(draftValues('profiles', current)) !== JSON.stringify(draftValues('profiles', expected))) return false
    if (next.subscriptionIds.some(id => !this.subs.has(id))) return false
    this.profiles.set(expected.id, structuredClone(next))
    if (version) this.versions.set(version.id, structuredClone(version))
    return true
  }
  async deleteProfile(id: string) {
    this.profiles.delete(id)
  }

  async listVersions(entityId: string): Promise<Version[]> {
    return [...this.versions.values()]
      .filter((v) => v.entityId === entityId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }
  async getVersion(id: string) {
    return this.versions.get(id)
  }
  async addVersion(v: Version) {
    this.versions.set(v.id, v)
  }

  async listTemplates(): Promise<StoredTemplate[]> {
    return [...this.templates.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }
  async getTemplate(id: string) {
    return this.templates.get(id)
  }
  async upsertTemplate(t: StoredTemplate) {
    this.templates.set(t.id, t)
  }
  async deleteTemplate(id: string) {
    this.templates.delete(id)
  }

  async listSessions(profileId: string | null): Promise<Session[]> {
    return [...this.sessions.values()]
      .filter((s) => (profileId == null ? s.profileId == null : s.profileId === profileId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }
  async getSession(id: string) {
    return this.sessions.get(id)
  }
  async upsertSession(s: Session) {
    this.sessions.set(s.id, { ...s })
  }
  async touchSession(id: string, at: number) {
    const s = this.sessions.get(id)
    if (s) s.updatedAt = at
  }
  async deleteSession(id: string) {
    this.sessions.delete(id)
    this.messages = this.messages.filter((m) => m.threadId !== id)
  }

  async listMessages(threadId: string): Promise<AgentMessage[]> {
    return this.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt)
  }
  async addMessage(m: AgentMessage) {
    this.messages.push(m)
  }
  async clearThread(threadId: string) {
    this.messages = this.messages.filter((m) => m.threadId !== threadId)
  }
  async getWorkingMemory() {
    return this.workingMemory
  }
  async setWorkingMemory(text: string) {
    this.workingMemory = text
  }

  async getSettings() {
    return this.settings
  }
  async setSettings(json: string) {
    this.settings = json
  }

  async getAuth() {
    return this.auth
  }
  async setAuth(json: string) {
    this.auth = json
  }
  async createAuthIfUninitialized(json: string) {
    if (this.auth !== undefined) {
      try {
        const current = JSON.parse(this.auth) as { account?: unknown }
        if (!current || typeof current !== 'object' || current.account) return false
      } catch {
        return false
      }
    }
    this.auth = json
    return true
  }

  async getLoginThrottle(key: string) {
    return this.loginThrottles.get(key)
  }
  async recordLoginFailure(key: string, at: number) {
    const failures = Math.min((this.loginThrottles.get(key)?.failures ?? 0) + 1, 12)
    const delay = loginLockDelay(failures)
    const value = { failures, lockedUntil: delay ? at + delay : 0 }
    this.loginThrottles.set(key, value)
    return value
  }
  async clearLoginThrottle(key: string) {
    this.loginThrottles.delete(key)
  }

  async close() {}
}

function loginLockDelay(failures: number): number {
  return failures < 5 ? 0 : Math.min(30_000 * 2 ** (failures - 5), 3_600_000)
}
