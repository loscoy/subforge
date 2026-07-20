import { z, type ZodTypeAny } from 'zod'
import type { ScriptRunner } from '@subforge/core'
import type { Storage } from '../storage/index.js'
import {
  buildProfileOutput,
  collectRawSubscriptions,
  previewScript,
  rollbackProfile,
  saveProfileWithVersion,
} from '../service.js'
import { parseSubscription } from '@subforge/core'
import { checkNodes } from '../health.js'

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
}

/** 工具集合（唯一真相来源）。 */
export function buildTools(): Tool[] {
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
      name: 'list_profiles',
      description: '列出所有转换档（id、名称、目标格式、关联订阅、分享 token、是否含脚本）。',
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
      description: '读取一个转换档的完整内容：转换脚本、代理组、规则、规则集。',
      schema: z.object({ profileId: z.string() }),
      async handler({ profileId }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('转换档不存在')
        return { id: p.id, name: p.name, target: p.target, script: p.script ?? '', profile: p.profile }
      },
    },
    {
      name: 'get_nodes',
      description: '获取某转换档解析出的节点样本（默认前 30 个），用于了解有哪些节点、如何分组。',
      schema: z.object({ profileId: z.string(), limit: z.number().int().positive().max(200).default(30) }),
      async handler({ profileId, limit }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('转换档不存在')
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
        '对某转换档的真实节点执行一段转换脚本（不保存），返回处理前后的节点数量、样本与 console 日志。用于迭代验证脚本是否正确。',
      schema: z.object({ profileId: z.string(), script: z.string() }),
      async handler({ profileId, script }, { storage, runner }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('转换档不存在')
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
      description: '保存某转换档的转换脚本（自动创建版本快照，可回滚）。建议先用 run_preview 验证。',
      schema: z.object({ profileId: z.string(), script: z.string(), note: z.string().optional() }),
      async handler({ profileId, script, note }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('转换档不存在')
        await saveProfileWithVersion(storage, { ...p, script }, note ?? 'agent 修改脚本')
        return { ok: true }
      },
    },
    {
      name: 'write_config',
      description:
        '更新某转换档的代理组 / 规则 / 规则集（整体替换所提供的字段，自动版本快照）。用于让 agent 增删组或规则。',
      schema: z.object({
        profileId: z.string(),
        groups: z.array(z.any()).optional(),
        rules: z.array(z.string()).optional(),
        ruleProviders: z.array(z.any()).optional(),
        note: z.string().optional(),
      }),
      async handler({ profileId, groups, rules, ruleProviders, note }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('转换档不存在')
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
      description: '构建某转换档的最终配置并校验是否成功（不返回全文，只返回是否成功与统计）。',
      schema: z.object({ profileId: z.string() }),
      async handler({ profileId }, { storage, runner }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('转换档不存在')
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
      description: '列出某转换档的历史版本（用于回滚）。',
      schema: z.object({ profileId: z.string() }),
      async handler({ profileId }, { storage }) {
        return (await storage.listVersions(profileId)).map((v) => ({ id: v.id, note: v.note, createdAt: v.createdAt }))
      },
    },
    {
      name: 'rollback_profile',
      description: '把某转换档回滚到指定历史版本。',
      schema: z.object({ profileId: z.string(), versionId: z.string() }),
      async handler({ profileId, versionId }, { storage }) {
        const restored = await rollbackProfile(storage, profileId, versionId)
        return { ok: true, name: restored.name }
      },
    },
    {
      name: 'test_nodes',
      description: '对某转换档的节点做 TCP 测活/延迟测试，返回每个节点的握手延迟（ms）与存活数。可据此建议按延迟分组或剔除失效节点。',
      schema: z.object({ profileId: z.string(), limit: z.number().int().positive().max(200).default(50) }),
      async handler({ profileId, limit }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('转换档不存在')
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
      name: 'update_working_memory',
      description:
        '更新跨会话「工作记忆」：记录用户长期偏好与项目事实（如命名习惯、常用分组方式、偏好的规则）。会在后续对话中作为上下文提供。',
      schema: z.object({ text: z.string() }),
      async handler({ text }, { storage }) {
        await storage.setWorkingMemory(text)
        return { ok: true }
      },
    },
  ]
  return tools
}
