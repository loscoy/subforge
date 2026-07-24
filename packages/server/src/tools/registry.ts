import { z, type ZodTypeAny } from 'zod'
import type { ScriptRunner } from '@subforge/core'
import type { Profile, Storage, Subscription } from '../storage/index.js'
import {
  buildProfileOutput,
  collectRawSubscriptions,
  ensureSubscriptionContent,
  newDefaultProfile,
  previewScript,
  rollbackProfile,
  saveProfileWithVersion,
} from '../service.js'
import { getRenderer, listRenderers, parseSubscription } from '@subforge/core'
import type { NodeChecker } from '../health.js'
import { newId, newToken, now } from '../util.js'

/** 框架无关的工具定义。MCP server 与内嵌 agent 都是它的薄适配层。 */
export interface Tool<I extends ZodTypeAny = ZodTypeAny> {
  name: string
  description: string
  schema: I
  handler: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>
}

export interface ToolContext {
  storage: Storage
  runner: ScriptRunner
  /** 测活能力（Node 注入；边缘运行时可缺省 → test_nodes 不可用） */
  checkNodes?: NodeChecker
}

/** 工具集合（唯一真相来源）。caps 可按部署能力裁剪工具（如边缘无测活则去掉 test_nodes）。 */
export function buildTools(caps?: { checkNodes?: boolean }): Tool[] {
  const tools: Tool[] = [
    {
      name: 'list_subscriptions',
      description: '列出所有订阅源（id、名称、url、节点数缓存状态）。',
      schema: z.object({}),
      async handler(_i, { storage }) {
        return (await storage.listSubscriptions()).map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          hasContent: !!s.content,
          fetchedAt: s.fetchedAt,
        }))
      },
    },
    {
      name: 'create_subscription',
      description:
        '新建一个订阅源。传 url（远程订阅，内容稍后由 refresh_subscription 或构建时抓取）或 content（手工粘贴的节点原文），两者至少其一。返回新订阅 id。',
      schema: z.object({
        name: z.string(),
        url: z.string().optional(),
        content: z.string().optional(),
      }),
      async handler({ name, url, content }, { storage }) {
        if (!url && !content) throw new Error('url 与 content 至少提供其一')
        const sub: Subscription = {
          id: newId(),
          name: name || '未命名订阅',
          url,
          content,
          createdAt: now(),
          updatedAt: now(),
        }
        await storage.upsertSubscription(sub)
        return { ok: true, id: sub.id, name: sub.name }
      },
    },
    {
      name: 'update_subscription',
      description:
        '更新订阅源的元信息（名称 / url / 手工 content）。仅更新所提供的字段；改 url 不会自动抓取，需要时再调 refresh_subscription。',
      schema: z.object({
        subscriptionId: z.string(),
        name: z.string().optional(),
        url: z.string().optional(),
        content: z.string().optional(),
      }),
      async handler({ subscriptionId, name, url, content }, { storage }) {
        const cur = await storage.getSubscription(subscriptionId)
        if (!cur) throw new Error('订阅不存在')
        const next: Subscription = {
          ...cur,
          ...(name !== undefined ? { name } : {}),
          ...(url !== undefined ? { url } : {}),
          ...(content !== undefined ? { content } : {}),
          updatedAt: now(),
        }
        await storage.upsertSubscription(next)
        return { ok: true }
      },
    },
    {
      name: 'refresh_subscription',
      description:
        '强制重新抓取订阅内容（远程 url 会经 SSRF 校验），返回解析出的节点数与前若干节点名，用于确认订阅是否有效、看有哪些节点。',
      schema: z.object({ subscriptionId: z.string() }),
      async handler({ subscriptionId }, { storage }) {
        const sub = await storage.getSubscription(subscriptionId)
        if (!sub) throw new Error('订阅不存在')
        try {
          const content = await ensureSubscriptionContent(storage, sub, 0, true)
          const nodes = parseSubscription(content)
          const updated = await storage.getSubscription(subscriptionId)
          return {
            ok: true,
            nodeCount: nodes.length,
            sample: nodes.slice(0, 10).map((n) => n.name),
            fetchedAt: updated?.fetchedAt,
            userInfo: updated?.userInfo,
          }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      },
    },
    {
      name: 'delete_subscription',
      description:
        '删除一个订阅源。若仍被某些配置关联则拒绝并列出这些档——需先用 update_profile 从这些档解除关联后再删。',
      schema: z.object({ subscriptionId: z.string() }),
      async handler({ subscriptionId }, { storage }) {
        const cur = await storage.getSubscription(subscriptionId)
        if (!cur) throw new Error('订阅不存在')
        const used = (await storage.listProfiles()).filter((p) => p.subscriptionIds.includes(subscriptionId))
        if (used.length) {
          throw new Error(
            `订阅仍被 ${used.length} 个配置引用：${used.map((p) => p.name).join('、')}。请先解除关联再删除。`,
          )
        }
        await storage.deleteSubscription(subscriptionId)
        return { ok: true }
      },
    },
    {
      name: 'list_profiles',
      description: '列出所有配置（id、名称、目标格式、关联订阅、分享 token、是否含脚本）。',
      schema: z.object({}),
      async handler(_i, { storage }) {
        return (await storage.listProfiles()).map((p) => ({
          id: p.id,
          name: p.name,
          target: p.target,
          subscriptionIds: p.subscriptionIds,
          token: p.token,
          hasScript: !!p.script,
          groups: p.profile.groups.map((g) => g.name),
        }))
      },
    },
    {
      name: 'get_profile',
      description: '读取一个配置的完整内容：转换脚本、代理组、规则、规则集。',
      schema: z.object({ profileId: z.string() }),
      async handler({ profileId }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        return { id: p.id, name: p.name, target: p.target, script: p.script ?? '', profile: p.profile }
      },
    },
    {
      name: 'create_profile',
      description:
        '新建一个配置：自动生成一份默认骨架（一个可用的节点选择组 + 兜底规则）与分享 token。可选 subscriptionIds 关联订阅、target 目标格式（默认 mihomo）、script 初始脚本。返回新配置 id 与 token。创建后用 write_config / write_script 继续完善。',
      schema: z.object({
        name: z.string(),
        target: z.string().optional(),
        subscriptionIds: z.array(z.string()).optional(),
        script: z.string().optional(),
      }),
      async handler({ name, target, subscriptionIds, script }, { storage }) {
        const tgt = target || 'mihomo'
        if (!getRenderer(tgt)) throw new Error(`不支持的目标格式：${tgt}（可用：${listRenderers().join(', ')}）`)
        const ids = subscriptionIds ?? []
        for (const id of ids) {
          if (!(await storage.getSubscription(id))) throw new Error(`关联的订阅不存在：${id}`)
        }
        const p: Profile = {
          id: newId(),
          name: name || '未命名配置',
          subscriptionIds: ids,
          target: tgt,
          script,
          profile: newDefaultProfile(),
          token: newToken(),
          createdAt: now(),
          updatedAt: now(),
        }
        await storage.upsertProfile(p)
        return { ok: true, id: p.id, name: p.name, token: p.token, target: p.target }
      },
    },
    {
      name: 'update_profile',
      description:
        '更新配置的元信息：名称 / 目标格式(target) / 关联订阅(subscriptionIds)。会自动版本快照，可回滚。组、规则、脚本请分别用 write_config / write_script。',
      schema: z.object({
        profileId: z.string(),
        name: z.string().optional(),
        target: z.string().optional(),
        subscriptionIds: z.array(z.string()).optional(),
        note: z.string().optional(),
      }),
      async handler({ profileId, name, target, subscriptionIds, note }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        if (target !== undefined && !getRenderer(target)) {
          throw new Error(`不支持的目标格式：${target}（可用：${listRenderers().join(', ')}）`)
        }
        if (subscriptionIds) {
          for (const id of subscriptionIds) {
            if (!(await storage.getSubscription(id))) throw new Error(`关联的订阅不存在：${id}`)
          }
        }
        const next: Profile = {
          ...p,
          ...(name !== undefined ? { name } : {}),
          ...(target !== undefined ? { target } : {}),
          ...(subscriptionIds !== undefined ? { subscriptionIds } : {}),
        }
        await saveProfileWithVersion(storage, next, note ?? 'agent 修改配置元信息')
        return { ok: true, name: next.name, target: next.target, subscriptionIds: next.subscriptionIds }
      },
    },
    {
      name: 'delete_profile',
      description:
        '删除一个配置。注意：其分享出口 /sub/:token 会立即永久失效，请确认用户确实要删。',
      schema: z.object({ profileId: z.string() }),
      async handler({ profileId }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        await storage.deleteProfile(profileId)
        return { ok: true, name: p.name }
      },
    },
    {
      name: 'get_output',
      description:
        '构建并返回某个配置最终生成的完整文本（可传 target 覆盖目标格式）。用于排查生成结果；输出可能很大，非必要时优先用 validate_profile 看统计。',
      schema: z.object({ profileId: z.string(), target: z.string().optional() }),
      async handler({ profileId, target }, { storage, runner }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        if (target !== undefined && !getRenderer(target)) {
          throw new Error(`不支持的目标格式：${target}（可用：${listRenderers().join(', ')}）`)
        }
        try {
          const out = await buildProfileOutput(storage, runner, target ? { ...p, target } : p)
          return { ok: true, target: target ?? p.target, bytes: out.config.length, config: out.config }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      },
    },
    {
      name: 'get_nodes',
      description: '获取某配置解析出的节点样本（默认前 30 个），用于了解有哪些节点、如何分组。',
      schema: z.object({ profileId: z.string(), limit: z.number().int().positive().max(200).default(30) }),
      async handler({ profileId, limit }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        const raws = await collectRawSubscriptions(storage, p)
        const nodes = raws.flatMap((r) => parseSubscription(r))
        return {
          total: nodes.length,
          sample: nodes.slice(0, limit).map((n) => ({ name: n.name, type: n.type, server: n.server, region: n.meta.region })),
        }
      },
    },
    {
      name: 'run_preview',
      description:
        '对某配置的真实节点执行一段转换脚本（不保存），返回处理前后的节点数量、样本与 console 日志。用于迭代验证脚本是否正确。',
      schema: z.object({ profileId: z.string(), script: z.string() }),
      async handler({ profileId, script }, { storage, runner }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        const r = await previewScript(storage, runner, p, script)
        return {
          ok: r.ok,
          error: r.error,
          beforeCount: r.before.length,
          afterCount: r.after.length,
          afterSample: r.after.slice(0, 20).map((n) => n.name),
          logs: r.logs,
        }
      },
    },
    {
      name: 'write_script',
      description: '保存某配置的转换脚本（自动创建版本快照，可回滚）。建议先用 run_preview 验证。',
      schema: z.object({ profileId: z.string(), script: z.string(), note: z.string().optional() }),
      async handler({ profileId, script, note }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        await saveProfileWithVersion(storage, { ...p, script }, note ?? 'agent 修改脚本')
        return { ok: true }
      },
    },
    {
      name: 'write_config',
      description:
        '更新某配置的代理组 / 规则 / 规则集（整体替换所提供的字段，自动版本快照）。用于让 agent 增删组或规则。',
      schema: z.object({
        profileId: z.string(),
        groups: z.array(z.any()).optional(),
        rules: z.array(z.string()).optional(),
        ruleProviders: z.array(z.any()).optional(),
        note: z.string().optional(),
      }),
      async handler({ profileId, groups, rules, ruleProviders, note }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        const nextProfile = {
          ...p.profile,
          ...(groups ? { groups } : {}),
          ...(rules ? { rules } : {}),
          ...(ruleProviders ? { ruleProviders } : {}),
        }
        await saveProfileWithVersion(storage, { ...p, profile: nextProfile }, note ?? 'agent 修改配置')
        return { ok: true, groups: nextProfile.groups.map((g: any) => g.name), ruleCount: nextProfile.rules.length }
      },
    },
    {
      name: 'validate_profile',
      description: '构建某个配置的最终产物并校验是否成功（不返回全文，只返回是否成功与统计）。',
      schema: z.object({ profileId: z.string() }),
      async handler({ profileId }, { storage, runner }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        try {
          const out = await buildProfileOutput(storage, runner, p)
          return { ok: true, nodeCount: out.nodes.length, bytes: out.config.length, logs: out.logs }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      },
    },
    {
      name: 'list_versions',
      description: '列出某配置的历史版本（用于回滚）。',
      schema: z.object({ profileId: z.string() }),
      async handler({ profileId }, { storage }) {
        return (await storage.listVersions(profileId)).map((v) => ({ id: v.id, note: v.note, createdAt: v.createdAt }))
      },
    },
    {
      name: 'rollback_profile',
      description: '把某配置回滚到指定历史版本。',
      schema: z.object({ profileId: z.string(), versionId: z.string() }),
      async handler({ profileId, versionId }, { storage }) {
        const restored = await rollbackProfile(storage, profileId, versionId)
        return { ok: true, name: restored.name }
      },
    },
    {
      name: 'test_nodes',
      description: '对某配置的节点做 TCP 测活/延迟测试，返回每个节点的握手延迟（ms）与存活数。可据此建议按延迟分组或剔除失效节点。',
      schema: z.object({ profileId: z.string(), limit: z.number().int().positive().max(200).default(50) }),
      async handler({ profileId, limit }, { storage, checkNodes }) {
        if (!checkNodes) throw new Error('当前部署不支持测活（边缘运行时）')
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        const raws = await collectRawSubscriptions(storage, p)
        const nodes = raws.flatMap((r) => parseSubscription(r)).slice(0, limit)
        const results = await checkNodes(nodes)
        return {
          total: results.length,
          alive: results.filter((r) => r.latency !== null).length,
          results: results.map((r) => ({ name: r.name, latency: r.latency })),
        }
      },
    },
    {
      name: 'list_templates',
      description: '列出服务端保存的模板（可套用到配置、或作为参考）。',
      schema: z.object({}),
      async handler(_i, { storage }) {
        return (await storage.listTemplates()).map((t) => ({
          id: t.id, name: t.name, description: t.description, hasScript: !!t.script,
          groups: t.profile.groups?.map((g) => g.name) ?? [],
        }))
      },
    },
    {
      name: 'save_template',
      description:
        '把某个配置的当前内容（节点处理/组/规则/脚本）保存为一个可复用模板。传 id 可覆盖同名模板。',
      schema: z.object({ profileId: z.string(), name: z.string(), description: z.string().optional(), id: z.string().optional() }),
      async handler({ profileId, name, description, id }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        const tid = id ?? newId()
        const existing = id ? await storage.getTemplate(id) : undefined
        await storage.upsertTemplate({
          id: tid, name, description, profile: p.profile, script: p.script,
          createdAt: existing?.createdAt ?? now(), updatedAt: now(),
        })
        return { ok: true, id: tid }
      },
    },
    {
      name: 'apply_template',
      description: '把一个模板套用到某配置（覆盖其组/规则/脚本，自动版本快照，可回滚）。',
      schema: z.object({ templateId: z.string(), profileId: z.string() }),
      async handler({ templateId, profileId }, { storage }) {
        const t = await storage.getTemplate(templateId)
        if (!t) throw new Error('模板不存在')
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        await saveProfileWithVersion(storage, { ...p, profile: t.profile, script: t.script }, `套用模板「${t.name}」`)
        return { ok: true }
      },
    },
    {
      name: 'delete_template',
      description: '删除一个服务端模板。',
      schema: z.object({ templateId: z.string() }),
      async handler({ templateId }, { storage }) {
        await storage.deleteTemplate(templateId)
        return { ok: true }
      },
    },
    {
      name: 'update_working_memory',
      description:
        '更新跨会话「长期记忆」：记录用户长期偏好与项目事实（如命名习惯、常用分组方式、偏好的规则）。会在后续对话中作为上下文提供。',
      schema: z.object({ text: z.string() }),
      async handler({ text }, { storage }) {
        await storage.setWorkingMemory(text)
        return { ok: true }
      },
    },
  ]
  // 边缘运行时无测活能力（node:net 不可用）→ 不暴露 test_nodes，避免模型调用必然失败的工具。
  return caps?.checkNodes === false ? tools.filter((t) => t.name !== 'test_nodes') : tools
}
