import { describe, expect, it, beforeEach } from 'vitest'
import { NodeVmRunner } from '../sandbox/nodeVm.js'
import { InMemoryStorage } from '../storage/index.js'
import { newId, newToken, now } from '../util.js'
import type { Profile, Subscription } from '../storage/index.js'
import { buildTools, type Tool, type ToolContext } from './registry.js'

function tool(name: string): Tool {
  const t = buildTools().find((x) => x.name === name)
  if (!t) throw new Error(`no tool ${name}`)
  return t
}

const SUB_CONTENT = [
  'trojan://p1@hk.com:443#🇭🇰 HK 01',
  'trojan://p2@hk.com:443#🇭🇰 HK 02',
  'trojan://p3@us.com:443#🇺🇸 US 01',
].join('\n')

describe('tool registry 集成', () => {
  let ctx: ToolContext
  let profile: Profile

  beforeEach(() => {
    const storage = new InMemoryStorage()
    ctx = { storage, runner: new NodeVmRunner() }
    const sub: Subscription = {
      id: newId(), name: '测试订阅', content: SUB_CONTENT, createdAt: now(), updatedAt: now(),
    }
    storage.upsertSubscription(sub)
    profile = {
      id: newId(), name: '测试档', subscriptionIds: [sub.id], target: 'mihomo',
      profile: { groups: [{ name: '🚀', type: 'select', includeAll: true }], rules: ['MATCH,🚀'] },
      token: newToken(), createdAt: now(), updatedAt: now(),
    }
    storage.upsertProfile(profile)
  })

  it('边缘（无测活能力）时不注册 test_nodes', () => {
    expect(buildTools().some((t) => t.name === 'test_nodes')).toBe(true)
    expect(buildTools({ checkNodes: true }).some((t) => t.name === 'test_nodes')).toBe(true)
    expect(buildTools({ checkNodes: false }).some((t) => t.name === 'test_nodes')).toBe(false)
  })

  it('get_nodes 返回节点样本', async () => {
    const r: any = await tool('get_nodes').handler({ profileId: profile.id, limit: 30 }, ctx)
    expect(r.total).toBe(3)
    expect(r.sample[0].name).toBe('🇭🇰 HK 01')
  })

  it('run_preview 执行脚本但不保存', async () => {
    const r: any = await tool('run_preview').handler(
      { profileId: profile.id, script: `return utils.keep(nodes, 'HK')` },
      ctx,
    )
    expect(r.ok).toBe(true)
    expect(r.beforeCount).toBe(3)
    expect(r.afterCount).toBe(2)
    // 未保存
    expect((await ctx.storage.getProfile(profile.id))!.script).toBeUndefined()
  })

  /** 读一遍配置，拿指纹（等同「覆盖前先读」这一步） */
  const revs = async (id = profile.id) => {
    const r: any = await tool('get_profile').handler({ profileId: id }, ctx)
    return { scriptRev: r.scriptRev as string, configRev: r.configRev as string }
  }

  it('write_script 保存并创建版本，rollback 可回滚', async () => {
    // 第一次保存：当前无脚本 = 没有东西可丢，不要求 baseRev。快照的是「初始态（无脚本）」
    await tool('write_script').handler({ profileId: profile.id, script: `return utils.keep(nodes, 'HK')` }, ctx)
    expect((await ctx.storage.getProfile(profile.id))!.script).toContain('HK')
    const afterFirst: any = await tool('list_versions').handler({ profileId: profile.id }, ctx)
    expect(afterFirst).toHaveLength(1)
    const initialVersionId = afterFirst[0].id // 无脚本态的快照

    // 再改一次：这次是覆盖已有脚本，得先读
    await tool('write_script').handler(
      { profileId: profile.id, script: `return nodes`, baseRev: (await revs()).scriptRev },
      ctx,
    )
    const versions: any = await tool('list_versions').handler({ profileId: profile.id }, ctx)
    expect(versions.length).toBeGreaterThanOrEqual(2)

    // 回滚到初始态版本 → 脚本应被清空
    await tool('rollback_profile').handler({ profileId: profile.id, versionId: initialVersionId }, ctx)
    expect((await ctx.storage.getProfile(profile.id))!.script).toBeUndefined()
  })

  // 覆写脚本里往往同时装着 DNS、规则、分组：整份重写漏抄一段，用户的配置就被静默改坏。
  // patch_script 只动指定片段，其余逐字保留。
  const OVERRIDE_SCRIPT = [
    'function buildDnsConfig() {',
    "  return { 'prefer-h3': true, nameserver: ['system'] }",
    '}',
    'function main(config) {',
    '  config.dns = buildDnsConfig()',
    "  config.rules = ['DOMAIN-SUFFIX,netflix.com,🚀', 'GEOIP,CN,DIRECT', 'MATCH,🚀']",
    '  return config',
    '}',
  ].join('\n')

  it('patch_script 只替换指定片段，其余原样保留', async () => {
    await tool('write_script').handler({ profileId: profile.id, script: OVERRIDE_SCRIPT }, ctx)

    const r: any = await tool('patch_script').handler(
      {
        profileId: profile.id,
        edits: [{ oldText: "nameserver: ['system']", newText: "nameserver: ['https://dns.alidns.com/dns-query']" }],
      },
      ctx,
    )
    expect(r.ok).toBe(true)
    const saved = (await ctx.storage.getProfile(profile.id))!.script!
    expect(saved).toContain('dns.alidns.com')
    // 与本次改动无关的规则必须一字不动
    expect(saved).toContain("'DOMAIN-SUFFIX,netflix.com,🚀', 'GEOIP,CN,DIRECT', 'MATCH,🚀'")
    expect(saved).toContain("'prefer-h3': true")
  })

  it('patch_script 匹配不到 / 匹配到多处时整批不写入', async () => {
    await tool('write_script').handler({ profileId: profile.id, script: OVERRIDE_SCRIPT }, ctx)

    // 第二条匹配不上 → 第一条也不能落库
    await expect(
      tool('patch_script').handler(
        {
          profileId: profile.id,
          edits: [
            { oldText: "'prefer-h3': true", newText: "'prefer-h3': false" },
            { oldText: '不存在的片段', newText: 'x' },
          ],
        },
        ctx,
      ),
    ).rejects.toThrow(/找不到/)
    expect((await ctx.storage.getProfile(profile.id))!.script).toBe(OVERRIDE_SCRIPT)

    // 出现多次 → 拒绝，提示补上下文
    await expect(
      tool('patch_script').handler({ profileId: profile.id, edits: [{ oldText: 'config', newText: 'cfg' }] }, ctx),
    ).rejects.toThrow(/出现了 \d+ 次/)
    expect((await ctx.storage.getProfile(profile.id))!.script).toBe(OVERRIDE_SCRIPT)
  })

  it('write_script 覆盖已有脚本必须先读：无 baseRev 拒绝，过期 baseRev 也拒绝', async () => {
    await tool('write_script').handler({ profileId: profile.id, script: OVERRIDE_SCRIPT }, ctx)

    // 没读过就想覆盖
    await expect(
      tool('write_script').handler({ profileId: profile.id, script: 'function main(config) { return config }' }, ctx),
    ).rejects.toThrow(/必须先读过它/)
    expect((await ctx.storage.getProfile(profile.id))!.script).toBe(OVERRIDE_SCRIPT)

    // 读过了，但读完之后内容又变了（用户在界面上改了 / 自己刚写过一次）
    const stale = (await revs()).scriptRev
    await tool('patch_script').handler(
      { profileId: profile.id, edits: [{ oldText: "'prefer-h3': true", newText: "'prefer-h3': false" }] },
      ctx,
    )
    await expect(
      tool('write_script').handler(
        { profileId: profile.id, script: 'function main(config) { return config }', baseRev: stale },
        ctx,
      ),
    ).rejects.toThrow(/baseRev 不匹配/)
    expect((await ctx.storage.getProfile(profile.id))!.script).toContain("'prefer-h3': false")

    // 重新读最新内容再写 → 放行
    await tool('write_script').handler(
      { profileId: profile.id, script: 'function main(config) { return config }', baseRev: (await revs()).scriptRev },
      ctx,
    )
    expect((await ctx.storage.getProfile(profile.id))!.script).toBe('function main(config) { return config }')
  })

  it('write_config 更新组与规则', async () => {
    const r: any = await tool('write_config').handler(
      {
        profileId: profile.id,
        groups: [
          { name: '🚀 节点选择', type: 'select', includeAll: true },
          { name: '🇭🇰 香港', type: 'url-test', filter: 'HK' },
        ],
        rules: ['DOMAIN-SUFFIX,google.com,🚀 节点选择', 'MATCH,🚀 节点选择'],
        baseRev: (await revs()).configRev,
      },
      ctx,
    )
    expect(r.ok).toBe(true)
    expect(r.groups).toContain('🇭🇰 香港')
    expect((await ctx.storage.getProfile(profile.id))!.profile.rules).toHaveLength(2)
  })

  // write_config 的数组也是整份替换：「加一条规则」时漏抄其余规则，与整份重写脚本是同一类事故
  it('write_config 必须先读：无 baseRev 拒绝，读完又变了也拒绝', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `DOMAIN-SUFFIX,d${i}.com,🚀`).concat('MATCH,🚀')
    await tool('write_config').handler({ profileId: profile.id, rules: many, baseRev: (await revs()).configRev }, ctx)

    // 没读过就只传「新增的那一条」——最典型的漏抄，此时其余 21 条会被静默删光
    await expect(
      tool('write_config').handler({ profileId: profile.id, rules: ['DOMAIN-SUFFIX,new.com,🚀'] }, ctx),
    ).rejects.toThrow(/必须先读过它/)
    expect((await ctx.storage.getProfile(profile.id))!.profile.rules).toHaveLength(21)

    // 读过了，但中途配置又变了（例如刚回滚过）→ 拒绝，避免把中间那次改动吃掉
    const stale = (await revs()).configRev
    await tool('write_config').handler(
      { profileId: profile.id, rules: [...many, 'DOMAIN-SUFFIX,mid.com,🚀'], baseRev: stale },
      ctx,
    )
    await expect(
      tool('write_config').handler({ profileId: profile.id, rules: ['MATCH,🚀'], baseRev: stale }, ctx),
    ).rejects.toThrow(/baseRev 不匹配/)
    expect((await ctx.storage.getProfile(profile.id))!.profile.rules).toHaveLength(22)

    // 重新读最新的再写 → 放行（哪怕这次确实是大幅精简，也不再需要额外的确认参数）
    await tool('write_config').handler(
      { profileId: profile.id, rules: ['MATCH,🚀'], baseRev: (await revs()).configRev },
      ctx,
    )
    expect((await ctx.storage.getProfile(profile.id))!.profile.rules).toHaveLength(1)
  })

  // 订阅内容没有版本快照，覆盖即永久丢失：必须先把原文读回来才准覆盖
  it('update_subscription 覆盖 content 必须先 get_subscription 取回原文', async () => {
    const subId = (await ctx.storage.listSubscriptions())[0]!.id

    await expect(
      tool('update_subscription').handler({ subscriptionId: subId, content: 'trojan://p1@hk.com:443#🇭🇰 HK 01' }, ctx),
    ).rejects.toThrow(/必须先读过它/)
    expect((await ctx.storage.getSubscription(subId))!.content).toBe(SUB_CONTENT)

    // 不取原文就拿不到 contentRev——「没读过」在接口上是自动成立的
    const meta: any = await tool('get_subscription').handler({ subscriptionId: subId }, ctx)
    expect(meta.nodeCount).toBe(3)
    expect(meta.contentRev).toBeUndefined()

    // 改名字这类元信息不碰 content，不受影响
    await tool('update_subscription').handler({ subscriptionId: subId, name: '改个名' }, ctx)
    expect((await ctx.storage.getSubscription(subId))!.name).toBe('改个名')

    // 正规流程：读回原文 → 在它后面追加节点 → 带 contentRev 写回
    const full: any = await tool('get_subscription').handler({ subscriptionId: subId, includeContent: true }, ctx)
    await tool('update_subscription').handler(
      { subscriptionId: subId, content: `${full.content}\ntrojan://p4@jp.com:443#🇯🇵 JP 01`, baseRev: full.contentRev },
      ctx,
    )
    const after: any = await tool('get_subscription').handler({ subscriptionId: subId }, ctx)
    expect(after.nodeCount).toBe(4)

    // 同一个 contentRev 不能再用第二次（内容已经变了）
    await expect(
      tool('update_subscription').handler({ subscriptionId: subId, content: 'x', baseRev: full.contentRev }, ctx),
    ).rejects.toThrow(/baseRev 不匹配/)
  })

  it('validate_profile 构建成功', async () => {
    await tool('write_config').handler(
      {
        profileId: profile.id,
        groups: [{ name: '🇭🇰 香港', type: 'url-test', filter: 'HK' }],
        rules: ['MATCH,🇭🇰 香港'],
        baseRev: (await revs()).configRev,
      },
      ctx,
    )
    const r: any = await tool('validate_profile').handler({ profileId: profile.id }, ctx)
    expect(r.ok).toBe(true)
    expect(r.nodeCount).toBe(3)
  })

  it('update_working_memory 默认追加，不覆盖已记下的偏好', async () => {
    await tool('update_working_memory').handler({ text: '用户偏好把香港节点单独分组' }, ctx)
    expect(await ctx.storage.getWorkingMemory()).toContain('香港')

    // 再记一条：旧的必须还在（MCP 侧的外部 agent 读不到现有记忆，只能靠 append 保证不丢）
    const r: any = await tool('update_working_memory').handler({ text: '用户常用 mihomo' }, ctx)
    const mem = await ctx.storage.getWorkingMemory()
    expect(mem).toContain('香港')
    expect(mem).toContain('mihomo')
    expect(r.mode).toBe('append')

    // 同一条重复记不会堆成一大串
    await tool('update_working_memory').handler({ text: '用户常用 mihomo' }, ctx)
    expect((await ctx.storage.getWorkingMemory()).match(/mihomo/g)).toHaveLength(1)
  })

  it('update_working_memory 的 replace 模式必须先 get_working_memory', async () => {
    await tool('update_working_memory').handler({ text: '用户偏好把香港节点单独分组' }, ctx)
    const before = await ctx.storage.getWorkingMemory()

    await expect(
      tool('update_working_memory').handler({ text: '只剩一句', mode: 'replace' }, ctx),
    ).rejects.toThrow(/必须先读过它/)
    expect(await ctx.storage.getWorkingMemory()).toBe(before)

    const cur: any = await tool('get_working_memory').handler({}, ctx)
    expect(cur.text).toBe(before)
    await tool('update_working_memory').handler({ text: '只剩一句', mode: 'replace', baseRev: cur.rev }, ctx)
    expect(await ctx.storage.getWorkingMemory()).toBe('只剩一句')
  })

  // ---- 新增：订阅 / 配置 CRUD + get_output ----

  it('create_subscription + create_profile 全链路可校验', async () => {
    const s: any = await tool('create_subscription').handler({ name: '新订阅', content: SUB_CONTENT }, ctx)
    expect(s.id).toBeTruthy()
    expect(await ctx.storage.getSubscription(s.id)).toBeTruthy()

    const p: any = await tool('create_profile').handler({ name: '新档', subscriptionIds: [s.id] }, ctx)
    expect(p.id).toBeTruthy()
    expect(p.token).toBeTruthy()
    // 默认建了一个可用的空配置（组 + MATCH 规则），能直接构建
    const v: any = await tool('validate_profile').handler({ profileId: p.id }, ctx)
    expect(v.ok).toBe(true)
    expect(v.nodeCount).toBe(3)
  })

  it('create_subscription 缺 url 和 content 时报错', async () => {
    await expect(tool('create_subscription').handler({ name: '空订阅' }, ctx)).rejects.toThrow()
  })

  it('create_profile 关联不存在的订阅时报错', async () => {
    await expect(
      tool('create_profile').handler({ name: 'x', subscriptionIds: ['not-exist'] }, ctx),
    ).rejects.toThrow()
  })

  it('create_profile 非法 target 时报错', async () => {
    await expect(tool('create_profile').handler({ name: 'x', target: 'bogus' }, ctx)).rejects.toThrow()
  })

  it('update_subscription 改名', async () => {
    const subId = profile.subscriptionIds[0]!
    const r: any = await tool('update_subscription').handler({ subscriptionId: subId, name: '改名订阅' }, ctx)
    expect(r.ok).toBe(true)
    expect((await ctx.storage.getSubscription(subId))!.name).toBe('改名订阅')
  })

  it('refresh_subscription 返回节点数与样本（手工 content）', async () => {
    const subId = profile.subscriptionIds[0]!
    const r: any = await tool('refresh_subscription').handler({ subscriptionId: subId }, ctx)
    expect(r.ok).toBe(true)
    expect(r.nodeCount).toBe(3)
    expect(r.sample[0]).toBe('🇭🇰 HK 01')
  })

  it('refresh_subscription 拒绝私网 URL（SSRF）', async () => {
    const s: any = await tool('create_subscription').handler({ name: 'evil', url: 'http://127.0.0.1/sub' }, ctx)
    const r: any = await tool('refresh_subscription').handler({ subscriptionId: s.id }, ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('update_profile 改元信息并产生版本快照', async () => {
    const before: any = await tool('list_versions').handler({ profileId: profile.id }, ctx)
    await tool('update_profile').handler({ profileId: profile.id, name: '改名了', target: 'sing-box' }, ctx)
    const p = await ctx.storage.getProfile(profile.id)
    expect(p!.name).toBe('改名了')
    expect(p!.target).toBe('sing-box')
    const after: any = await tool('list_versions').handler({ profileId: profile.id }, ctx)
    expect(after.length).toBe(before.length + 1)
  })

  it('update_profile 非法 target 时报错', async () => {
    await expect(
      tool('update_profile').handler({ profileId: profile.id, target: 'bogus' }, ctx),
    ).rejects.toThrow()
  })

  it('delete_subscription 被引用时拒绝，解除关联后可删', async () => {
    const subId = profile.subscriptionIds[0]!
    // 仍被 profile 引用 → 拒绝
    await expect(tool('delete_subscription').handler({ subscriptionId: subId }, ctx)).rejects.toThrow()
    expect(await ctx.storage.getSubscription(subId)).toBeTruthy()
    // 解除关联后可删
    await tool('update_profile').handler({ profileId: profile.id, subscriptionIds: [] }, ctx)
    const r: any = await tool('delete_subscription').handler({ subscriptionId: subId }, ctx)
    expect(r.ok).toBe(true)
    expect(await ctx.storage.getSubscription(subId)).toBeUndefined()
  })

  it('delete_profile 后按 id 与 token 均查不到', async () => {
    const token = profile.token
    const r: any = await tool('delete_profile').handler({ profileId: profile.id }, ctx)
    expect(r.ok).toBe(true)
    expect(await ctx.storage.getProfile(profile.id)).toBeUndefined()
    expect(await ctx.storage.getProfileByToken(token)).toBeUndefined()
  })

  it('get_output 返回完整配置全文', async () => {
    const r: any = await tool('get_output').handler({ profileId: profile.id }, ctx)
    expect(r.ok).toBe(true)
    expect(typeof r.config).toBe('string')
    expect(r.config.length).toBeGreaterThan(0)
  })
})
