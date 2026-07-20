import type { AgentMessage, Profile, Storage, Subscription, Version } from './types.js'

/** 纯内存实现：用于测试，也可作无持久化的临时运行。 */
export class InMemoryStorage implements Storage {
  private subs = new Map<string, Subscription>()
  private profiles = new Map<string, Profile>()
  private versions = new Map<string, Version>()
  private messages: AgentMessage[] = []
  private workingMemory = ''

  listSubscriptions(): Subscription[] {
    return [...this.subs.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  getSubscription(id: string) {
    return this.subs.get(id)
  }
  upsertSubscription(sub: Subscription) {
    this.subs.set(sub.id, sub)
  }
  deleteSubscription(id: string) {
    this.subs.delete(id)
  }

  listProfiles(): Profile[] {
    return [...this.profiles.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  getProfile(id: string) {
    return this.profiles.get(id)
  }
  getProfileByToken(token: string) {
    return [...this.profiles.values()].find((p) => p.token === token)
  }
  upsertProfile(p: Profile) {
    this.profiles.set(p.id, p)
  }
  deleteProfile(id: string) {
    this.profiles.delete(id)
  }

  listVersions(entityId: string): Version[] {
    return [...this.versions.values()]
      .filter((v) => v.entityId === entityId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }
  getVersion(id: string) {
    return this.versions.get(id)
  }
  addVersion(v: Version) {
    this.versions.set(v.id, v)
  }

  listMessages(threadId: string): AgentMessage[] {
    return this.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt)
  }
  addMessage(m: AgentMessage) {
    this.messages.push(m)
  }
  clearThread(threadId: string) {
    this.messages = this.messages.filter((m) => m.threadId !== threadId)
  }
  getWorkingMemory() {
    return this.workingMemory
  }
  setWorkingMemory(text: string) {
    this.workingMemory = text
  }

  close() {}
}
