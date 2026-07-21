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
})
