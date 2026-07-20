import {
  parseSubscription,
  runPipeline,
  type PipelineOutput,
  type ProxyNode,
  type ScriptRunner,
} from '@subforge/core'
import type { Profile, Storage, Subscription } from './storage/index.js'
import { newId, now } from './util.js'

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000 // 1h 缓存

/** 抓取订阅内容（带 UA），失败抛错。 */
export async function fetchSubscriptionContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'clash-verge/1.0 mihomo subforge' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`抓取订阅失败 HTTP ${res.status}`)
  return await res.text()
}

/** 确保订阅有较新内容：过期或无缓存则重新抓取并写回。 */
export async function ensureSubscriptionContent(
  storage: Storage,
  sub: Subscription,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  force = false,
): Promise<string> {
  const fresh = sub.fetchedAt && now() - sub.fetchedAt < maxAgeMs
  if (!force && fresh && sub.content) return sub.content
  if (!sub.url) {
    // 手工节点：直接用已存 content
    if (sub.content) return sub.content
    throw new Error(`订阅 ${sub.id} 既无 url 也无 content`)
  }
  const content = await fetchSubscriptionContent(sub.url)
  const updated: Subscription = { ...sub, content, fetchedAt: now(), updatedAt: now() }
  storage.upsertSubscription(updated)
  return content
}

/** 取一个转换档关联的所有订阅原文。 */
export async function collectRawSubscriptions(
  storage: Storage,
  profile: Profile,
  opts: { force?: boolean } = {},
): Promise<string[]> {
  const raws: string[] = []
  for (const id of profile.subscriptionIds) {
    const sub = storage.getSubscription(id)
    if (!sub) continue
    raws.push(await ensureSubscriptionContent(storage, sub, DEFAULT_MAX_AGE_MS, opts.force))
  }
  return raws
}

/** 端到端构建一个转换档的输出配置。 */
export async function buildProfileOutput(
  storage: Storage,
  runner: ScriptRunner,
  profile: Profile,
  opts: { force?: boolean } = {},
): Promise<PipelineOutput> {
  const raws = await collectRawSubscriptions(storage, profile, opts)
  return runPipeline({
    rawSubscriptions: raws,
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
  error?: string
}

/**
 * Dry-run 预览：对转换档的节点跑一段脚本，返回处理前后的节点与日志。
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
  for (const raw of raws) before.push(...parseSubscription(raw))

  if (!script.trim()) return { ok: true, before, after: before, logs: [] }

  const result = await runner.run(script, before)
  return {
    ok: result.ok,
    before,
    after: result.ok ? result.nodes : before,
    logs: result.logs,
    error: result.error,
  }
}

/** 写入转换档前先快照当前版本，保证可回滚。 */
export function saveProfileWithVersion(storage: Storage, next: Profile, note?: string): void {
  const prev = storage.getProfile(next.id)
  if (prev) {
    storage.addVersion({
      id: newId(),
      entity: 'profile',
      entityId: prev.id,
      // 用 null 显式表示「无脚本」，避免 JSON.stringify 丢弃 undefined 字段导致回滚无法清空脚本
      snapshot: JSON.stringify({ script: prev.script ?? null, profile: prev.profile, target: prev.target, name: prev.name }),
      note,
      createdAt: now(),
    })
  }
  storage.upsertProfile({ ...next, updatedAt: now() })
}

/** 回滚到某个版本快照。 */
export function rollbackProfile(storage: Storage, profileId: string, versionId: string): Profile {
  const cur = storage.getProfile(profileId)
  if (!cur) throw new Error('转换档不存在')
  const ver = storage.getVersion(versionId)
  if (!ver || ver.entityId !== profileId) throw new Error('版本不存在')
  const snap = JSON.parse(ver.snapshot) as { script?: string | null; profile?: Profile['profile']; target?: string; name?: string }
  const restored: Profile = {
    ...cur,
    name: snap.name ?? cur.name,
    target: snap.target ?? cur.target,
    profile: snap.profile ?? cur.profile,
    // null 哨兵 → 清空脚本
    script: snap.script == null ? undefined : snap.script,
  }
  // 回滚本身也留一份快照
  saveProfileWithVersion(storage, restored, `回滚到版本 ${versionId}`)
  return restored
}
