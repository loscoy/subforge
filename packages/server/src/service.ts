import {
  diffNodes,
  parseSubscription,
  runPipeline,
  type ConversionProfile,
  type PipelineOutput,
  type PipelineStage,
  type ProxyNode,
  type ScriptRunner,
} from '@subforge/core'
import { assertPublicHttpUrl } from './net.js'
import type { Profile, Storage, Subscription } from './storage/index.js'
import type { RefreshState } from './storage/types.js'
import { parseUserInfo, type UserInfo } from './userinfo.js'
import { newId, now } from './util.js'
import { z } from 'zod'

export const subscriptionFetchPolicySchema = z.object({
  userAgent: z.string().max(256).regex(/^[\x20-\x7e]*$/).optional(),
  maxAgeMinutes: z.number().int().min(1).max(1440).optional(),
  autoRefresh: z.boolean().optional(),
  intervalMinutes: z.number().int().min(5).max(10080).optional(),
  failureThreshold: z.number().int().min(1).max(100).optional(),
  dropPercent: z.number().int().min(1).max(100).optional(),
}).strict().optional()
const DEFAULT_FETCH_TIMEOUT_MS = 15_000
const DEFAULT_MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5

// 每个存储实例独立合并刷新；Workers 中仅在当前 isolate 内有效。
const refreshState = new WeakMap<Storage, { active: number; waiters: (() => void)[]; pending: Map<string, Promise<string>>; fetchImpl?: typeof fetch }>()
function stateFor(storage: Storage) {
  let state = refreshState.get(storage)
  if (!state) {
    state = { active: 0, waiters: [], pending: new Map() }
    refreshState.set(storage, state)
  }
  return state
}

/** Node 入口注入绑定已验证 DNS 地址的抓取器；Workers 使用原生 fetch。 */
export function setSubscriptionFetcher(storage: Storage, fetchImpl: typeof fetch): void {
  stateFor(storage).fetchImpl = fetchImpl
}

export interface FetchSubscriptionOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  fetchImpl?: typeof fetch
  userAgent?: string
}

/**
 * 新建配置时的默认「空白骨架」：一个可直接构建的最小节点选择组 + 兜底规则。
 * HTTP 建档与 agent 的 create_profile 共用同一份，避免两处漂移。每次返回全新对象，
 * 调用方可直接改而不影响其它档。
 */
export function newDefaultProfile(): ConversionProfile {
  return {
    groups: [{ name: '🚀 节点选择', type: 'select', includeAll: true, proxies: ['DIRECT'] }],
    rules: ['MATCH,🚀 节点选择'],
  }
}

/** 抓取订阅内容（带 UA），返回正文与解析出的流量信息。失败抛错。 */
export async function fetchSubscriptionContent(
  url: string,
  options: FetchSubscriptionOptions = {},
): Promise<{ content: string; userInfo?: UserInfo }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SUBSCRIPTION_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    let current = assertPublicHttpUrl(url)
    let redirects = 0

    while (true) {
      const res = await fetchImpl(current, {
        headers: { 'User-Agent': options.userAgent || 'clash-verge/1.0 mihomo subforge' },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (isRedirect(res.status)) {
        await res.body?.cancel().catch(() => undefined)
        if (redirects >= maxRedirects) throw new Error(`订阅重定向次数过多（>${maxRedirects}）`)
        const location = res.headers.get('location')
        if (!location) throw new Error(`订阅重定向缺少 Location（HTTP ${res.status}）`)
        current = assertPublicHttpUrl(new URL(location, current).href)
        redirects += 1
        continue
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        throw new Error(`抓取订阅失败 HTTP ${res.status}`)
      }
      const content = await readTextWithLimit(res, maxBytes)
      const userInfo = parseUserInfo(res.headers.get('subscription-userinfo'))
      return { content, userInfo }
    }
  } catch (error) {
    if (timedOut) throw new Error(`抓取订阅超时（>${timeoutMs}ms）`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function readTextWithLimit(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined)
    throw new Error(`订阅响应体过大（上限 ${maxBytes} 字节）`)
  }
  if (!res.body) return ''

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`订阅响应体过大（上限 ${maxBytes} 字节）`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** 确保订阅有较新内容：过期或无缓存则重新抓取并写回。 */
export async function ensureSubscriptionContent(
  storage: Storage,
  sub: Subscription,
  maxAgeMs = (sub.fetchPolicy?.maxAgeMinutes ?? 60) * 60_000,
  force = false,
): Promise<string> {
  const fresh = sub.fetchedAt && now() - sub.fetchedAt < maxAgeMs
  if (!force && fresh && sub.content) return sub.content
  if (!sub.url) {
    // 手工节点：直接用已存 content
    if (sub.content) return sub.content
    throw new Error(`订阅 ${sub.id} 既无 url 也无 content`)
  }
  const state = stateFor(storage)
  const key = JSON.stringify([sub.id, sub.url, sub.updatedAt])
  const pending = state.pending.get(key)
  if (pending) return pending
  const task = (async () => {
    if (state.active >= 4) await new Promise<void>((resolve) => state.waiters.push(resolve))
    else state.active++
    let claim: RefreshState | undefined
    try {
      const previous = await storage.getRefreshState(sub.id)
      if (previous && previous.leaseUntil > now()) throw new Error('Subscription refresh already running; retry later')
      const source = JSON.stringify([sub.url, sub.fetchPolicy?.userAgent || ''])
      claim = { source, lastAttempt: now(), leaseUntil: now() + 60_000, failures: previous?.source === source ? previous.failures : 0, alerts: [], history: previous?.source === source ? previous.history : [] }
      if (!await storage.compareRefreshState(sub.id, previous, claim)) { claim = undefined; throw new Error('Subscription refresh already running; retry later') }
      const { content, userInfo } = await fetchSubscriptionContent(sub.url!, { fetchImpl: state.fetchImpl, userAgent: sub.fetchPolicy?.userAgent })
      const nodes = parseSubscription(content)
      if (!nodes.length) throw new Error('Subscription contains no valid nodes; previous cache retained')
      if (!await storage.replaceSubscription(sub, { ...sub, content, userInfo, fetchedAt: now(), updatedAt: now() })) {
        throw new Error('Subscription changed during refresh; retry with the current source')
      }
      const delta = diffNodes(parseSubscription(sub.content || ''), nodes)
      const alerts = delta.before > 0 && (delta.before - delta.after) * 100 / delta.before >= (sub.fetchPolicy?.dropPercent ?? 50)
        ? [`节点数量骤减：${delta.before} → ${delta.after}，请检查上游变更`] : []
      // 历史有界；计数完整，增删名称各保留前 100 项供定位，不保存节点凭据。
      delta.added = delta.added.slice(0, 100); delta.removed = delta.removed.slice(0, 100)
      await storage.compareRefreshState(sub.id, claim, { ...claim, leaseUntil: 0, failures: 0, alerts, history: [{ at: now(), ok: true, delta }, ...claim.history].slice(0, 20) })
      return content
    } catch (error) {
      if (claim) {
        const failures = claim.failures + 1
        await storage.compareRefreshState(sub.id, claim, { ...claim, leaseUntil: 0, failures,
          alerts: failures >= (sub.fetchPolicy?.failureThreshold ?? 3) ? [`连续刷新失败 ${failures} 次；保留最后有效缓存`] : [],
          history: [{ at: now(), ok: false, error: error instanceof Error ? error.message : String(error) }, ...claim.history].slice(0, 20) })
      }
      throw error
    } finally {
      const next = state.waiters.shift()
      if (next) next()
      else state.active--
    }
  })()
  state.pending.set(key, task)
  try { return await task } finally { state.pending.delete(key) }
}

/** 两个运行时共用的定时入口；仅处理用户显式启用且到期的 URL 来源。 */
export async function refreshDueSubscriptions(storage: Storage): Promise<void> {
  const subscriptions = await storage.listSubscriptions()
  for (const sub of subscriptions) {
    if (!sub.url || !sub.fetchPolicy?.autoRefresh) continue
    const status = await storage.getRefreshState(sub.id)
    const sameSource = status?.source === JSON.stringify([sub.url, sub.fetchPolicy?.userAgent || ''])
    const last = Math.max(sub.fetchedAt || 0, sameSource ? status?.lastAttempt || 0 : 0)
    if (now() - last < (sub.fetchPolicy.intervalMinutes ?? 60) * 60_000) continue
    try { await ensureSubscriptionContent(storage, sub, 0, true) } catch { /* 失败原因与提醒已持久化；其它来源继续。 */ }
  }
}

export async function getSubscriptionRefreshStatus(storage: Storage, sub: Subscription) {
  const status = await storage.getRefreshState(sub.id)
  if (!status || status.source !== JSON.stringify([sub.url, sub.fetchPolicy?.userAgent || ''])) return { failures: 0, alerts: [], history: [] }
  return { lastAttempt: status.lastAttempt, failures: status.failures, alerts: status.alerts, history: status.history }
}

/** 取一个配置关联的所有订阅原文。 */
export async function collectRawSubscriptions(
  storage: Storage,
  profile: Profile,
  opts: { force?: boolean } = {},
): Promise<string[]> {
  // 并行抓取各订阅：总耗时从「逐个求和」变为「取最慢的一个」。保持原始顺序。
  const raws = await Promise.all(
    profile.subscriptionIds.map(async (id) => {
      const sub = await storage.getSubscription(id)
      if (!sub) throw new Error(`Missing subscription: ${id}`)
      return ensureSubscriptionContent(storage, sub, undefined, opts.force)
    }),
  )
  return raws.filter((r): r is string => r !== null)
}

/** 端到端构建一个配置的最终输出。 */
export async function buildProfileOutput(
  storage: Storage,
  runner: ScriptRunner,
  profile: Profile,
  opts: { force?: boolean } = {},
): Promise<PipelineOutput> {
  const raws = await collectRawSubscriptions(storage, profile, opts)
  return runPipeline({
    rawSubscriptions: raws,
    sourceIds: profile.subscriptionIds,
    target: profile.target,
    profile: profile.profile,
    script: profile.script,
    runner,
  })
}

export interface PreviewResult {
  ok: boolean
  before: ProxyNode[]
  after: ProxyNode[]
  logs: string[]
  warnings?: string[]
  config?: string
  stages?: PipelineStage[]
  error?: string
}

/**
 * Dry-run 预览：对配置的节点跑一段脚本，返回处理前后的节点与日志。
 * 供编辑器实时预览 & Agent 的 run_preview 工具使用。
 */
export async function previewScript(
  storage: Storage,
  runner: ScriptRunner,
  profile: Profile,
  script: string,
): Promise<PreviewResult> {
  const raws = await collectRawSubscriptions(storage, profile)
  const before: ProxyNode[] = []
  for (const [index, raw] of raws.entries()) before.push(...parseSubscription(raw).map((n) => ({ ...n, meta: { ...n.meta, source: profile.subscriptionIds[index] } })))

  const stages: PipelineStage[] = []
  try {
    const result = await runPipeline({ rawSubscriptions: raws, sourceIds: profile.subscriptionIds, target: profile.target, profile: profile.profile, script, runner, onStage: (stage) => stages.push(stage) })
    return { ok: true, before, after: result.nodes, logs: result.logs, warnings: result.warnings, config: result.config, stages }
  } catch (error) {
    return { ok: false, before, after: [], logs: [], stages, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 所有入口共用引用约束。 */
export async function deleteSubscription(storage: Storage, id: string): Promise<void> {
  const used = (await storage.listProfiles()).filter((p) => p.subscriptionIds.includes(id))
  if (used.length) throw new Error(`Subscription is referenced by: ${used.map((p) => p.name).join(', ')}`)
  await storage.deleteSubscription(id)
}

/** 来源改变后，旧地址的缓存不能继续作为新来源内容使用。 */
export async function updateSubscription(storage: Storage, cur: Subscription, patch: Partial<Subscription>): Promise<Subscription> {
  const fetchPolicy = subscriptionFetchPolicySchema.parse(patch.fetchPolicy)
  const changed = (patch.url !== undefined && patch.url !== cur.url) ||
    (fetchPolicy !== undefined && fetchPolicy.userAgent !== cur.fetchPolicy?.userAgent)
  const next: Subscription = {
    ...cur,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.url !== undefined ? { url: patch.url } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(fetchPolicy !== undefined ? { fetchPolicy } : {}),
    ...(changed ? { content: (patch.url ?? cur.url) ? undefined : patch.content ?? (cur.url ? undefined : cur.content), fetchedAt: undefined, userInfo: undefined } : {}),
    updatedAt: now(),
  }
  await storage.upsertSubscription(next)
  return next
}

/** 以调用方实际读取的版本为条件，配置与旧版本快照原子写入。 */
export async function saveProfileWithVersion(storage: Storage, prev: Profile, next: Profile, note?: string): Promise<Profile> {
  const saved = { ...next, id: prev.id, token: prev.token, shareDisabled: prev.shareDisabled, createdAt: prev.createdAt, updatedAt: Math.max(now(), prev.updatedAt + 1) }
  if (!await storage.replaceProfile(prev, saved, {
      id: newId(),
      entity: 'profile',
      entityId: prev.id,
      // 用 null 显式表示「无脚本」，避免 JSON.stringify 丢弃 undefined 字段导致回滚无法清空脚本
      snapshot: JSON.stringify({ script: prev.script ?? null, profile: prev.profile, target: prev.target, name: prev.name, subscriptionIds: prev.subscriptionIds }),
      note,
      createdAt: now(),
    })) {
    const sources = await Promise.all(next.subscriptionIds.map(id => storage.getSubscription(id)))
    const missing = next.subscriptionIds.filter((_, i) => !sources[i])
    if (missing.length) throw new Error(`Missing subscriptions: ${missing.join(', ')}`)
    throw new Error('Profile changed concurrently; reload before saving')
  }
  return saved
}

/** 回滚到某个版本快照。 */
export async function rollbackProfile(storage: Storage, profileId: string, versionId: string): Promise<Profile> {
  const cur = await storage.getProfile(profileId)
  if (!cur) throw new Error('配置不存在')
  const ver = await storage.getVersion(versionId)
  if (!ver || ver.entityId !== profileId) throw new Error('版本不存在')
  const snap = JSON.parse(ver.snapshot) as { script?: string | null; profile?: Profile['profile']; target?: string; name?: string; subscriptionIds?: string[] }
  const restored: Profile = {
    ...cur,
    name: snap.name ?? cur.name,
    subscriptionIds: snap.subscriptionIds ?? cur.subscriptionIds,
    target: snap.target ?? cur.target,
    profile: snap.profile ?? cur.profile,
    // null 哨兵 → 清空脚本
    script: snap.script == null ? undefined : snap.script,
  }
  // 回滚本身也留一份快照
  return saveProfileWithVersion(storage, cur, restored, `回滚到版本 ${versionId}`)
}
