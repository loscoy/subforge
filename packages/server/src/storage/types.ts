import type { ConversionProfile } from '@subforge/core'

/** 一个订阅源。 */
export interface Subscription {
  id: string
  name: string
  /** 订阅 URL；为空表示手工粘贴节点（存 content） */
  url?: string
  /** 缓存的订阅原文 */
  content?: string
  /** 上次抓取时间（epoch ms） */
  fetchedAt?: number
  createdAt: number
  updatedAt: number
}

/**
 * 一份「转换档」：把若干订阅按 profile（组/规则）+ script 转成目标格式，
 * 通过 token 短链对外分享。
 */
export interface Profile {
  id: string
  name: string
  /** 关联的订阅 id */
  subscriptionIds: string[]
  /** 目标格式，如 'mihomo' */
  target: string
  /** 转换脚本体（可空） */
  script?: string
  /** 组 / 规则 / 规则集 */
  profile: ConversionProfile
  /** 分享 token（出口 /sub/:token） */
  token: string
  createdAt: number
  updatedAt: number
}

/** 版本快照，供回滚。 */
export interface Version {
  id: string
  /** 关联实体：目前是 profile */
  entity: 'profile'
  entityId: string
  /** 快照内容（JSON 序列化的 Profile 关键字段） */
  snapshot: string
  note?: string
  createdAt: number
}

/** Agent 会话消息。 */
export interface AgentMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  createdAt: number
}

/** Storage 抽象：Node 用 sqlite，测试用内存，serverless 后续换 KV/D1。 */
export interface Storage {
  // 订阅
  listSubscriptions(): Subscription[]
  getSubscription(id: string): Subscription | undefined
  upsertSubscription(sub: Subscription): void
  deleteSubscription(id: string): void

  // 转换档
  listProfiles(): Profile[]
  getProfile(id: string): Profile | undefined
  getProfileByToken(token: string): Profile | undefined
  upsertProfile(p: Profile): void
  deleteProfile(id: string): void

  // 版本历史
  listVersions(entityId: string): Version[]
  getVersion(id: string): Version | undefined
  addVersion(v: Version): void

  // Agent 记忆
  listMessages(threadId: string): AgentMessage[]
  addMessage(m: AgentMessage): void
  clearThread(threadId: string): void
  getWorkingMemory(): string
  setWorkingMemory(text: string): void

  close(): void
}
