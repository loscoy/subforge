import type { AgentMessage, Profile, Storage, Subscription, Version } from './types.js'

/** 纯内存实现：用于测试，也可作无持久化的临时运行。方法为 async 以符合 Storage 接口。 */
export class InMemoryStorage implements Storage {
  private subs = new Map<string, Subscription>()
  private profiles = new Map<string, Profile>()
  private versions = new Map<string, Version>()
  private messages: AgentMessage[] = []
  private workingMemory = ''

  async listSubscriptions(): Promise<Subscription[]> {
    return [...this.subs.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  async getSubscription(id: string) {
    return this.subs.get(id)
  }
  async upsertSubscription(sub: Subscription) {
    this.subs.set(sub.id, sub)
  }
  async deleteSubscription(id: string) {
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

  async close() {}
}
