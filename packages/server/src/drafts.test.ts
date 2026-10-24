import { expect, it } from 'vitest'
import { buildTools } from './tools/registry.js'
import { InMemoryStorage } from './storage/memory.js'
import { QuickJsRunner } from './sandbox/quickjs.js'
import { applyDraft } from './drafts.js'

it('领域修改先产草稿、局部改动保留其余字段，审批后才生效并留版本', async () => {
  const storage = new InMemoryStorage()
  await storage.upsertSubscription({ id: 's', name: 'S', content: 'trojan://p@example.com:443#A', createdAt: 1, updatedAt: 1 })
  const p = { id: 'p', name: 'P', target: 'mihomo', subscriptionIds: ['s'], profile: { groups: [], rules: ['MATCH,DIRECT'], extraConfig: { dns: { enable: true, ipv6: false }, tun: { enable: false } } }, token: 'token', createdAt: 1, updatedAt: 1 }
  await storage.upsertProfile(p)
  const tools = buildTools()
  const patch = tools.find((t) => t.name === 'patch_config')!
  const result: any = await patch.handler({ profileId: 'p', section: 'dns', action: 'replace', key: 'enable', expected: true, value: false }, { storage, runner: new QuickJsRunner() })
  expect(result.applied).toBe(false)
  expect(result.validation.ok).toBe(true)
  expect(result.diff.find((d: any) => d.field === 'output.dns')).toEqual({ field: 'output.dns', before: { enable: true, ipv6: false }, after: { enable: false, ipv6: false } })
  expect(await storage.getProfile('p')).toEqual(p)
  expect(await storage.listVersions('p')).toEqual([])
  expect(tools.some((t) => t.name === 'apply_draft')).toBe(false)
  await applyDraft(storage, result.draftId)
  expect((await storage.getProfile('p'))!.profile.extraConfig).toEqual({ dns: { enable: false, ipv6: false }, tun: { enable: false } })
  expect(await storage.listVersions('p')).toHaveLength(1)
  await expect(applyDraft(storage, result.draftId)).rejects.toThrow('not found')

  const invalid: any = await tools.find((t) => t.name === 'write_script')!.handler({ profileId: 'p', script: 'throw new Error("invalid")' }, { storage, runner: new QuickJsRunner() })
  expect(invalid.validation.ok).toBe(false)
  await expect(applyDraft(storage, invalid.draftId)).rejects.toThrow('validation failed')
  expect((await storage.getProfile('p'))!.script).toBeUndefined()
})
