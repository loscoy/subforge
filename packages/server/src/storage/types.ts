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
 * 一份「配置」：把若干订阅按 profile（组/规则）+ script 转成目标格式，
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

/** 一次工具调用的完整记录。 */
export interface AgentToolStep {
  /** provider 给的调用 id，流式下用它把「调用」与「结果」配对 */
  id?: string
  tool: string
  args?: unknown
  /** 成功时的返回值 */
  result?: unknown
  /** 失败时的错误信息（与 result 二选一） */
  error?: string
}

/** assistant 消息的中间过程：思考文本 + 工具调用明细，用于刷新后仍能展开回看。 */
export interface AgentTrace {
  reasoning?: string
  steps?: AgentToolStep[]
}

/** Agent 会话消息。 */
export interface AgentMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  /** assistant 消息附带的本轮工具调用名（用于刷新后仍能展示工具链）。 */
  tools?: string[]
  /**
   * 本轮的中间过程。tools 只有名字，够画一排 chip；trace 带参数/结果/思考，
   * 够展开细看。两者并存是为了兼容 0004 之前写入的历史消息。
   */
  trace?: AgentTrace
  createdAt: number
}

/**
 * 一组 Agent 对话会话。会话 id 即消息表的 threadId——不新增外键列，
 * 老的 'global' / 'profile:<id>' 线程经 0005 回填后原地变成会话记录。
 */
export interface Session {
  id: string
  title: string
  /** 归属的配置档 id；缺省 = 全局会话组 */
  profileId?: string
  createdAt: number
  updatedAt: number
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

  // 配置
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

  // Agent 会话（threadId = session.id）
  /** 列出某会话组，按 updatedAt 倒序。profileId=null 取全局组（profileId 为空的会话）。 */
  listSessions(profileId: string | null): Promise<Session[]>
  getSession(id: string): Promise<Session | undefined>
  upsertSession(s: Session): Promise<void>
  /** 只刷新 updatedAt（发消息时用，让会话浮到列表顶部），不存在则无操作。 */
  touchSession(id: string, at: number): Promise<void>
  /** 删除会话，连带删除该 threadId 的全部消息。 */
  deleteSession(id: string): Promise<void>

  // Agent 记忆
  listMessages(threadId: string): Promise<AgentMessage[]>
  addMessage(m: AgentMessage): Promise<void>
  clearThread(threadId: string): Promise<void>
  getWorkingMemory(): Promise<string>
  setWorkingMemory(text: string): Promise<void>

  // 运行时设置（原始 JSON 字符串）。存储层只当它是块不透明数据：
  // 加解密与语义都在 settings.ts，换加密方案不影响三个存储实现。
  getSettings(): Promise<string | undefined>
  setSettings(json: string): Promise<void>

  close(): Promise<void>
}
