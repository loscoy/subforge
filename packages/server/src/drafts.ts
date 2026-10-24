import { diffConfigSections, diffNodes, parseSubscription, runPipeline, type ScriptRunner } from '@subforge/core'
import type { ChangeDraft, DraftEntity, Profile, Storage, Subscription, Version } from './storage/types.js'
import type { Tool, ToolContext } from './tools/registry.js'
import { assertPublicHttpUrl } from './net.js'
import { newId, now } from './util.js'

const mutations: Record<string, { entity: DraftEntity; getter: 'getProfile' | 'getSubscription' | 'getTemplate'; remove?: boolean }> = {
  upsertProfile: { entity: 'profiles', getter: 'getProfile' },
  deleteProfile: { entity: 'profiles', getter: 'getProfile', remove: true },
  upsertSubscription: { entity: 'subscriptions', getter: 'getSubscription' },
  deleteSubscription: { entity: 'subscriptions', getter: 'getSubscription', remove: true },
  upsertTemplate: { entity: 'templates', getter: 'getTemplate' },
  deleteTemplate: { entity: 'templates', getter: 'getTemplate', remove: true },
}

export const DRAFT_TOOLS = new Set(['create_subscription', 'update_subscription', 'delete_subscription', 'create_profile', 'update_profile', 'delete_profile', 'patch_script', 'write_script', 'write_config', 'patch_config', 'rollback_profile', 'save_template', 'apply_template', 'delete_template'])

/** 复用现有工具的业务约束，但把领域写入截为候选值；模型没有应用草稿的工具。 */
export async function proposeToolChange(tool: Tool, input: unknown, ctx: ToolContext) {
  let change: Pick<ChangeDraft, 'entity' | 'entityId' | 'before' | 'after'> | undefined
  const reads = new Map<string, unknown>()
  const previewStorage = new Proxy(ctx.storage, {
    get(target, key: keyof Storage) {
      if (key === 'addVersion') return async () => undefined
      if (key === 'replaceProfile') return async (before: Profile, after: Profile) => {
        if (change) throw new Error('A draft must change exactly one entity')
        change = { entity: 'profiles', entityId: before.id, before: structuredClone(before), after: structuredClone(after) }
        return true
      }
      const mutation = mutations[key]
      if (mutation) return async (value: ChangeDraft['after'] | string) => {
        if (change) throw new Error('A draft must change exactly one entity')
        const entityId = typeof value === 'string' ? value : value!.id
        const readKey = `${mutation.getter}:${entityId}`
        const before = reads.has(readKey) ? reads.get(readKey) : await target[mutation.getter](entityId)
        change = { entity: mutation.entity, entityId, before: structuredClone(before ?? null) as ChangeDraft['before'], after: mutation.remove ? null : structuredClone(value) as ChangeDraft['after'] }
      }
      if (String(key).startsWith('get') || String(key).startsWith('list')) return async (...args: unknown[]) => {
        const value = await (target[key] as (...args: unknown[]) => Promise<unknown>).apply(target, args)
        const readKey = `${key}:${args.join(':')}`
        if (!reads.has(readKey)) reads.set(readKey, structuredClone(value))
        return structuredClone(value)
      }
      return () => { throw new Error(`Storage operation not allowed while drafting: ${String(key)}`) }
    },
  })
  const result = await tool.handler(tool.schema.parse(input), { ...ctx, storage: previewStorage })
  if (!change) throw new Error('No change proposed')
  const draft: ChangeDraft = { ...change, id: newId(), tool: tool.name, createdAt: now(), validation: { ok: false, warnings: [] }, diff: [] }
  const before = draft.before as unknown as Record<string, unknown> | null
  const after = draft.after as unknown as Record<string, unknown> | null
  for (const field of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (['id', 'token', 'createdAt', 'updatedAt'].includes(field)) continue
    if (field === 'profile') {
      const oldConfig = before?.profile as Record<string, unknown> | undefined
      const newConfig = after?.profile as Record<string, unknown> | undefined
      for (const key of new Set([...Object.keys(oldConfig || {}), ...Object.keys(newConfig || {})])) {
        if (JSON.stringify(oldConfig?.[key]) !== JSON.stringify(newConfig?.[key])) draft.diff.push({ field: `profile.${key}`, before: oldConfig?.[key] ?? null, after: newConfig?.[key] ?? null })
      }
    } else if (JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field])) {
      draft.diff.push({ field, before: before?.[field] ?? null, after: after?.[field] ?? null })
    }
  }
  draft.validation = await validateDraft(ctx.storage, ctx.runner, draft)
  await ctx.storage.putDraft(draft)
  return { ...(result as object), ok: true, applied: false, draftId: draft.id, validation: draft.validation, diff: draft.diff, message: '已生成草稿；请在变更草稿中检查差异并应用。继续修改需先应用或弃用该草稿。' }
}

async function validateDraft(storage: Storage, runner: ScriptRunner, draft: ChangeDraft): Promise<ChangeDraft['validation']> {
  const warnings: string[] = []
  try {
    if (!draft.after) return { ok: true, warnings: ['删除不可通过配置版本回滚恢复；请确认对象和引用。'] }
    if (draft.entity === 'subscriptions') {
      const sub = draft.after as Subscription
      if (sub.url) { assertPublicHttpUrl(sub.url); warnings.push('未联网抓取；链接的可用性与节点内容待刷新验证。') }
      else if (!sub.content || !parseSubscription(sub.content, warnings).length) throw new Error('Manual source contains no valid nodes')
      return { ok: true, warnings }
    }
    if (draft.entity === 'templates') return { ok: true, warnings: ['模板未绑定订阅；套用后才能进行完整管线验证。'] }
    const p = draft.after as Profile
    const sources: Subscription[] = []
    for (const id of p.subscriptionIds) {
      const source = await storage.getSubscription(id)
      if (!source?.content) throw new Error(`Source ${id} has no cached content; refresh it before proposing this change`)
      sources.push(source)
    }
    draft.sources = sources
    const result = await runPipeline({ rawSubscriptions: sources.map((s) => s.content!), sourceIds: p.subscriptionIds, target: p.target, profile: p.profile, script: p.script, runner })
    warnings.push(...result.warnings, '验证使用当前缓存；未执行客户端连接、DNS 或测速。')
    if (draft.before) {
      const old = draft.before as Profile
      try {
        const oldSources = await Promise.all(old.subscriptionIds.map((id) => storage.getSubscription(id)))
        if (oldSources.some((s) => !s?.content)) throw new Error('Previous source cache missing')
        const previous = await runPipeline({ rawSubscriptions: oldSources.map((s) => s!.content!), sourceIds: old.subscriptionIds, target: old.target, profile: old.profile, script: old.script, runner })
        draft.diff.push({ field: 'nodes', before: null, after: diffNodes(previous.nodes, result.nodes) })
        draft.diff.push(...diffConfigSections(previous.config, result.config))
        if (previous.config !== result.config) draft.diff.push({ field: 'renderedConfig', before: previous.config, after: result.config })
      } catch { warnings.push('旧配置无法构建，无法生成完整产物差异；请检查配置字段差异。') }
    }
    return { ok: true, warnings, stages: result.stages }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), warnings }
  }
}

export async function applyDraft(storage: Storage, id: string): Promise<void> {
  const draft = await storage.getDraft(id)
  if (!draft) throw new Error('Draft not found')
  if (!draft.validation.ok) throw new Error('Draft validation failed; propose a corrected draft')
  let version: Version | undefined
  if (draft.entity === 'profiles' && draft.before) {
    const p = draft.before as Profile
    version = { id: newId(), entity: 'profile', entityId: p.id, snapshot: JSON.stringify({ script: p.script ?? null, profile: p.profile, target: p.target, name: p.name, subscriptionIds: p.subscriptionIds }), note: `应用草稿 ${draft.tool}`, createdAt: now() }
  }
  if (!await storage.applyDraftChange(draft, version)) throw new Error('Draft is stale or references changed; review a new draft')
}
