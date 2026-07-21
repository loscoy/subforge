import type { ConversionProfile } from '@subforge/core'
import type { UserInfo } from '../userinfo.js'

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
  /** 机场返回的流量/到期信息（subscription-userinfo 头） */
  userInfo?: UserInfo
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

/** 服务端保存的模板（可跨设备、被 agent 管理）。 */
export interface StoredTemplate {
  id: string
  name: string
  description?: string
  /** ConversionProfile（组/规则/操作） */
  profile: ConversionProfile
  /** 可选转换脚本（transform 或 override） */
  script?: string
  createdAt: number
  updatedAt: number
}

/**
 * Storage 抽象（异步）：Node 用 sqlite、测试用内存、serverless 用 D1/KV。
 * 全部方法返回 Promise，以兼容 Cloudflare D1/KV 这类异步存储。
 */
export interface Storage {
  // 订阅
  listSubscriptions(): Promise<Subscription[]>
  getSubscription(id: string): Promise<Subscription | undefined>
  upsertSubscription(sub: Subscription): Promise<void>
  deleteSubscription(id: string): Promise<void>

  // 转换档
  listProfiles(): Promise<Profile[]>
  getProfile(id: string): Promise<Profile | undefined>
  getProfileByToken(token: string): Promise<Profile | undefined>
  upsertProfile(p: Profile): Promise<void>
  deleteProfile(id: string): Promise<void>

  // 版本历史
  listVersions(entityId: string): Promise<Version[]>
  getVersion(id: string): Promise<Version | undefined>
  addVersion(v: Version): Promise<void>

  // 模板
  listTemplates(): Promise<StoredTemplate[]>
  getTemplate(id: string): Promise<StoredTemplate | undefined>
  upsertTemplate(t: StoredTemplate): Promise<void>
  deleteTemplate(id: string): Promise<void>

  // Agent 记忆
  listMessages(threadId: string): Promise<AgentMessage[]>
  addMessage(m: AgentMessage): Promise<void>
  clearThread(threadId: string): Promise<void>
  getWorkingMemory(): Promise<string>
  setWorkingMemory(text: string): Promise<void>

  close(): Promise<void>
}
