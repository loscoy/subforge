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
import { contentRev, newId, newToken, now } from '../util.js'

/**
 * 「整份替换」类写操作的统一前置条件：**没读过当前内容就不准覆盖**。
 *
 * 这类工具要求调用方把它没有创作过的既有内容原样交回来（整个脚本、整个规则数组、整份订阅原文）。
 * 模型凭记忆重建时最常见的事故不是写错，而是漏抄——用户与本次需求无关的规则 / 分组 / 节点静默消失。
 *
 * 靠「缩水多少算异常」的阈值去猜是猜不准的（既误伤有意的精简，也放过只漏抄三成的情况）。
 * 改成读工具发指纹、写工具验指纹：拿不出指纹 = 没读过，指纹对不上 = 读完之后内容又变了。
 * 两种情况都拒绝，让调用方先去读最新内容、在最新版本上重做本次修改。
 *
 * @param what 人话描述这次写的是什么（用于错误信息）
 * @param readHint 该去调哪个读工具、取哪个字段
 */
function assertFresh(what: string, rev: string, baseRev: string | undefined, readHint: string): void {
  if (baseRev === rev) return
  if (!baseRev) {
    throw new Error(
      `${what}已有内容，整份覆盖前必须先读过它：${readHint}，把拿到的指纹作为 baseRev 传回来。` +
        `没有这一步就覆盖，等于拿一份凭记忆重建的副本盖掉用户的现有内容。`,
    )
  }
  throw new Error(
    `baseRev 不匹配：${what}在你读取之后已经变了（可能是用户在界面上改的，也可能是你自己上一步刚写过、或刚回滚过）。` +
      `当前指纹是 ${rev}，你带来的是 ${baseRev}。请${readHint}重新读取最新内容，在最新版本上重做本次修改——` +
      `直接覆盖会把中间那次改动吃掉。`,
  )
}

/** 配置里「会被 write_config 整份替换」的部分，指纹按它算 */
function configFingerprint(p: Profile): string {
  return contentRev(
    JSON.stringify({ groups: p.profile.groups, rules: p.profile.rules, ruleProviders: p.profile.ruleProviders ?? [] }),
  )
}

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
      name: 'get_subscription',
      description:
        '读取一个订阅源。默认只回元信息与节点样本；要改写 content 时才传 includeContent=true 取回原文。\n' +
        '只有取回了原文才会一并给出 contentRev——update_subscription 覆盖 content 时要把它当 baseRev 传回来，' +
        '这样「没读过就不准覆盖」是自动成立的。注意订阅原文可能很大，非必要不要取。',
      schema: z.object({ subscriptionId: z.string(), includeContent: z.boolean().optional() }),
      async handler({ subscriptionId, includeContent }, { storage }) {
        const s = await storage.getSubscription(subscriptionId)
        if (!s) throw new Error('订阅不存在')
        const nodes = s.content ? parseSubscription(s.content) : []
        return {
          id: s.id,
          name: s.name,
          url: s.url,
          fetchedAt: s.fetchedAt,
          userInfo: s.userInfo,
          nodeCount: nodes.length,
          sample: nodes.slice(0, 10).map((n) => n.name),
          ...(includeContent ? { content: s.content ?? '', contentRev: contentRev(s.content ?? '') } : {}),
        }
      },
    },
    {
      name: 'update_subscription',
      description:
        '更新订阅源的元信息（名称 / url / 手工 content）。仅更新所提供的字段；改 url 不会自动抓取，需要时再调 refresh_subscription。\n' +
        '⚠️ content 是用户粘贴的节点原文，整份替换，而且**订阅没有版本历史、覆盖后无法回滚**。' +
        '所以覆盖已有 content 必须带 baseRev（get_subscription 传 includeContent=true 返回的 contentRev）：' +
        '没把原文读回来过就不允许覆盖。要加节点就在读回来的原文后面追加，不要凭记忆重写整份。',
      schema: z.object({
        subscriptionId: z.string(),
        name: z.string().optional(),
        url: z.string().optional(),
        content: z.string().optional(),
        baseRev: z.string().optional().describe('get_subscription(includeContent=true) 返回的 contentRev；覆盖已有 content 时必填'),
      }),
      async handler({ subscriptionId, name, url, content, baseRev }, { storage }) {
        const cur = await storage.getSubscription(subscriptionId)
        if (!cur) throw new Error('订阅不存在')
        // 订阅内容没有快照可回滚，是全仓最不能覆盖错的东西
        if (content !== undefined && cur.content) {
          assertFresh(
            '该订阅的节点原文',
            contentRev(cur.content),
            baseRev,
            '调 get_subscription 并传 includeContent=true 取 contentRev',
          )
        }
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
      description:
        '读取一个配置的完整内容：转换脚本、代理组、规则、规则集。\n' +
        '同时返回 scriptRev / configRev 两个内容指纹——write_script / write_config 要把它当 baseRev 传回来，' +
        '这是「读过才准整份覆盖」的凭据。改动前先调本工具。',
      schema: z.object({ profileId: z.string() }),
      async handler({ profileId }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        return {
          id: p.id,
          name: p.name,
          target: p.target,
          script: p.script ?? '',
          profile: p.profile,
          scriptRev: contentRev(p.script ?? ''),
          configRev: configFingerprint(p),
        }
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
        // 一并返回指纹，紧接着 write_config / write_script 就不必再多跑一趟 get_profile
        return {
          ok: true,
          id: p.id,
          name: p.name,
          token: p.token,
          target: p.target,
          scriptRev: contentRev(p.script ?? ''),
          configRev: configFingerprint(p),
        }
      },
    },
    {
      name: 'update_profile',
      description:
        '更新配置的元信息：名称 / 目标格式(target) / 关联订阅(subscriptionIds)。会自动版本快照，可回滚。组与规则用 write_config，脚本用 patch_script（改动）或 write_script（首次写入）。',
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
          return { ok: true, target: target ?? p.target, bytes: out.config.length, warnings: out.warnings, config: out.config }
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
      name: 'patch_script',
      description:
        '对某配置的转换脚本做局部替换：只改指定片段，脚本其余部分逐字保留。\n' +
        '【改动已有脚本一律用本工具】——用 write_script 整份重写等于凭记忆默写一遍上百行脚本，' +
        '极易漏掉与本次需求无关的规则 / 分组，用户的配置会被静默改坏。\n' +
        '每个 edit 的 oldText 必须在当前脚本中【恰好出现一次】，所以要带足上下文（多带几行）保证唯一。' +
        '任何一条匹配不上或匹配到多处，整批都不写入、脚本保持原样。先用 get_profile 拿到脚本原文再照抄片段。\n' +
        '不需要 baseRev：oldText 本身就是凭据——匹配得上说明你手里的片段确实是脚本的现状，' +
        '而且别处的改动不会被本次覆盖掉。',
      schema: z.object({
        profileId: z.string(),
        edits: z
          .array(
            z.object({
              oldText: z.string().min(1).describe('要被替换的原文片段，必须与脚本逐字一致且全局唯一'),
              newText: z.string().describe('替换成的新内容；留空字符串表示删除这段'),
            }),
          )
          .min(1),
        note: z.string().optional(),
      }),
      async handler({ profileId, edits, note }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        if (!p.script) throw new Error('该配置还没有脚本，首次写入请用 write_script')

        // 先在内存里把整批 edit 跑完，全部成功才落库：半套改动比不改更糟
        let next = p.script
        ;(edits as Array<{ oldText: string; newText: string }>).forEach(({ oldText, newText }, i) => {
          const at = `第 ${i + 1} 条 edit`
          if (oldText === newText) throw new Error(`${at} 的 oldText 与 newText 相同，没有实际改动`)
          const hits = next.split(oldText).length - 1
          if (hits === 0) {
            throw new Error(
              `${at} 的 oldText 在脚本中找不到（注意缩进、空行与全角/半角要逐字一致）。` +
                `若是照着旧版本改的，请先用 get_profile 重新读取脚本原文。`,
            )
          }
          if (hits > 1) {
            throw new Error(`${at} 的 oldText 在脚本中出现了 ${hits} 次，无法确定改哪一处。请多带几行上下文让它唯一。`)
          }
          next = next.replace(oldText, () => newText)
        })

        await saveProfileWithVersion(storage, { ...p, script: next }, note ?? 'agent 局部修改脚本')
        return {
          ok: true,
          edits: edits.length,
          bytesBefore: p.script.length,
          bytesAfter: next.length,
          scriptRev: contentRev(next),
        }
      },
    },
    {
      name: 'write_script',
      description:
        '整份替换某配置的转换脚本（自动创建版本快照，可回滚）。建议先用 run_preview 验证。\n' +
        '仅用于「首次写入」或「用户明确要求整份重写」；在已有脚本上改动请用 patch_script。\n' +
        '脚本已存在时必须带 baseRev（get_profile 返回的 scriptRev）：没读过当前脚本就不允许覆盖它。' +
        '首次写入（当前无脚本）不需要 baseRev。',
      schema: z.object({
        profileId: z.string(),
        script: z.string(),
        baseRev: z.string().optional().describe('get_profile 返回的 scriptRev；覆盖已有脚本时必填'),
        note: z.string().optional(),
      }),
      async handler({ profileId, script, baseRev, note }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        const prev = p.script ?? ''
        // 空脚本 = 还没有东西可丢，等同「新建文件」，不要求先读
        if (prev) assertFresh('该配置的转换脚本', contentRev(prev), baseRev, '调 get_profile 取 scriptRev')
        await saveProfileWithVersion(storage, { ...p, script }, note ?? 'agent 修改脚本')
        return { ok: true, bytesBefore: prev.length, bytesAfter: script.length, scriptRev: contentRev(script) }
      },
    },
    {
      name: 'write_config',
      description:
        '更新某配置的代理组 / 规则 / 规则集。未提供的字段保持不变，但**提供的字段是整个数组替换**：\n' +
        '要加一条规则，必须把现有规则连同新规则一起完整传回来，只传新增的那条会把其余规则全删掉。\n' +
        '必须带 baseRev（get_profile 返回的 configRev）：没读过当前的组 / 规则就不允许覆盖它们。' +
        '所以流程固定是 get_profile → 在拿到的数组上增删 → 带着 configRev 调本工具。',
      schema: z.object({
        profileId: z.string(),
        groups: z.array(z.any()).optional(),
        rules: z.array(z.string()).optional(),
        ruleProviders: z.array(z.any()).optional(),
        baseRev: z.string().optional().describe('get_profile 返回的 configRev；必填'),
        note: z.string().optional(),
      }),
      async handler({ profileId, groups, rules, ruleProviders, baseRev, note }, { storage }) {
        const p = await storage.getProfile(profileId)
        if (!p) throw new Error('配置不存在')
        assertFresh('该配置的组 / 规则', configFingerprint(p), baseRev, '调 get_profile 取 configRev')
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
          return { ok: true, nodeCount: out.nodes.length, bytes: out.config.length, logs: out.logs, warnings: out.warnings }
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
        '把某个配置的当前内容（节点处理/组/规则/脚本）保存为一个可复用模板。不传 id 即新建。\n' +
        '⚠️ 传 id 是**整份覆盖该 id 的模板**（不是按名字匹配），而模板没有版本历史、覆盖后无法恢复——' +
        '要存成一份新模板就别传 id；确实要更新某个模板时，先 list_templates 核对 id 再传。',
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
      name: 'get_working_memory',
      description:
        '读取跨会话「长期记忆」的当前全文与指纹 rev。整理 / 改写记忆（update_working_memory 的 replace 模式）前必须先调它；' +
        '只是新增一条偏好的话不用——直接用默认的 append 模式即可。',
      schema: z.object({}),
      async handler(_i, { storage }) {
        const text = (await storage.getWorkingMemory()).trim()
        return { text, rev: contentRev(text) }
      },
    },
    {
      name: 'update_working_memory',
      description:
        '更新跨会话「长期记忆」：记录用户长期偏好与项目事实（如命名习惯、常用分组方式、偏好的规则）。会在后续对话中作为上下文提供。\n' +
        '新增一条偏好请用 mode="append"（默认）：接在现有内容后面，不需要知道原有内容，也就不可能覆盖掉它。\n' +
        'mode="replace" 是整份覆盖，必须带 baseRev（get_working_memory 返回的 rev）——没读过就不准覆盖，' +
        '否则凭记忆重写会把以前记下的偏好一并抹掉。\n' +
        '返回值里带上了合并后的全文与新 rev。',
      schema: z.object({
        text: z.string().min(1),
        mode: z.enum(['append', 'replace']).optional().describe('默认 append：追加一条；replace 才是整份覆盖'),
        baseRev: z.string().optional().describe('get_working_memory 返回的 rev；mode="replace" 时必填'),
      }),
      async handler({ text, mode, baseRev }, { storage }) {
        const prev = (await storage.getWorkingMemory()).trim()
        const addition = text.trim()
        let next: string
        if (mode === 'replace') {
          // 记忆本来就是空的时候没有东西可丢，不必先读
          if (prev) assertFresh('长期记忆', contentRev(prev), baseRev, '调 get_working_memory 取 rev')
          next = addition
        } else {
          // 已经记过的原样跳过，避免同一条偏好被反复追加成一大串重复
          next = !prev ? addition : prev.includes(addition) ? prev : `${prev}\n${addition}`
        }
        await storage.setWorkingMemory(next)
        return {
          ok: true,
          mode: mode ?? 'append',
          bytesBefore: prev.length,
          bytesAfter: next.length,
          text: next,
          rev: contentRev(next),
        }
      },
    },
  ]
  // 边缘运行时无测活能力（node:net 不可用）→ 不暴露 test_nodes，避免模型调用必然失败的工具。
  return caps?.checkNodes === false ? tools.filter((t) => t.name !== 'test_nodes') : tools
}
