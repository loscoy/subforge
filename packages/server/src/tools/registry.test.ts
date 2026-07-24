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

  it('write_script 保存并创建版本，rollback 可回滚', async () => {
    // 第一次保存：快照的是「初始态（无脚本）」
    await tool('write_script').handler({ profileId: profile.id, script: `return utils.keep(nodes, 'HK')` }, ctx)
    expect((await ctx.storage.getProfile(profile.id))!.script).toContain('HK')
    const afterFirst: any = await tool('list_versions').handler({ profileId: profile.id }, ctx)
    expect(afterFirst).toHaveLength(1)
    const initialVersionId = afterFirst[0].id // 无脚本态的快照

    // 再改一次，产生第二个版本
    await tool('write_script').handler({ profileId: profile.id, script: `return nodes` }, ctx)
    const versions: any = await tool('list_versions').handler({ profileId: profile.id }, ctx)
    expect(versions.length).toBeGreaterThanOrEqual(2)

    // 回滚到初始态版本 → 脚本应被清空
    await tool('rollback_profile').handler({ profileId: profile.id, versionId: initialVersionId }, ctx)
    expect((await ctx.storage.getProfile(profile.id))!.script).toBeUndefined()
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
      },
      ctx,
    )
    expect(r.ok).toBe(true)
    expect(r.groups).toContain('🇭🇰 香港')
    expect((await ctx.storage.getProfile(profile.id))!.profile.rules).toHaveLength(2)
  })

  it('validate_profile 构建成功', async () => {
    await tool('write_config').handler(
      { profileId: profile.id, groups: [{ name: '🇭🇰 香港', type: 'url-test', filter: 'HK' }], rules: ['MATCH,🇭🇰 香港'] },
      ctx,
    )
    const r: any = await tool('validate_profile').handler({ profileId: profile.id }, ctx)
    expect(r.ok).toBe(true)
    expect(r.nodeCount).toBe(3)
  })

  it('update_working_memory 写入记忆', async () => {
    await tool('update_working_memory').handler({ text: '用户偏好把香港节点单独分组' }, ctx)
    expect(await ctx.storage.getWorkingMemory()).toContain('香港')
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
