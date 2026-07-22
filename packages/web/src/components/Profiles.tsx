import { COMMON_GROUPS, RULE_PRESETS } from '@subforge/core'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Code,
  Collapse,
  Group,
  Modal,
  NativeSelect,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import {
  IBot, ICode, IFilter, IGlobe, IHistory, ILayers, ILink, IPlay, IPlus, ISave, ISliders, ITemplate, ITrash, IZap,
} from '../icons'
import { builtinTemplates, serverToUI, type UITemplate } from '../templates'
import type { ConversionProfile, NodeOp, Profile, ProxyGroupDef, Subscription } from '../types'
import { AgentChatPanel } from './AgentChatPanel'
import { DetailSkeleton, ListSkeleton, LoadError } from './AsyncState'
import { ScriptEditor } from './ScriptEditor'

const ok = (message: string) => notifications.show({ color: 'teal', message })
const fail = (e: unknown) => notifications.show({ color: 'red', message: String(e) })

function StepNum({ n }: { n: number }) {
  return (
    <Box
      style={{
        width: 21,
        height: 21,
        borderRadius: 6,
        background: 'var(--mantine-color-violet-light)',
        color: 'var(--mantine-color-violet-6)',
        fontSize: 11.5,
        fontWeight: 700,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {n}
    </Box>
  )
}

function CardHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <Group justify="space-between" mb="sm">
      <Group gap={9}>{children}</Group>
      {right}
    </Group>
  )
}

function DimIcon({ children }: { children: ReactNode }) {
  return (
    <Box c="dimmed" style={{ display: 'flex' }}>
      {children}
    </Box>
  )
}

export function Profiles({ dts, renderers, hasAgent }: { dts: string; renderers: string[]; hasAgent: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [sel, setSel] = useState<Profile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState('')
  const [subsLoading, setSubsLoading] = useState(true)
  const [subsError, setSubsError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [creating, setCreating] = useState(false)
  const detailRequest = useRef(0)

  const loadProfiles = async (initial = false) => {
    if (initial) setProfilesLoading(true)
    try {
      setProfiles(await api.listProfiles())
      setProfilesError('')
    } catch (e) {
      if (initial) setProfilesError(String(e))
      else fail(e)
    } finally {
      if (initial) setProfilesLoading(false)
    }
  }
  const loadSubs = async () => {
    setSubsLoading(true)
    try {
      setSubs(await api.listSubscriptions())
      setSubsError('')
    } catch (e) {
      setSubsError(String(e))
    } finally {
      setSubsLoading(false)
    }
  }
  useEffect(() => {
    void loadProfiles(true)
    void loadSubs()
  }, [])

  const create = async () => {
    if (creating) return
    setCreating(true)
    try {
      const p = await api.createProfile({ name: '新配置' })
      await loadProfiles()
      detailRequest.current += 1
      setSelectedId(p.id)
      setSel(p)
    } catch (e) {
      fail(e)
    } finally {
      setCreating(false)
    }
  }

  const selectProfile = async (profileId: string) => {
    const requestId = ++detailRequest.current
    setSelectedId(profileId)
    setDetailLoading(true)
    setDetailError('')
    try {
      const profile = await api.getProfile(profileId)
      if (requestId === detailRequest.current) setSel(profile)
    } catch (e) {
      if (requestId === detailRequest.current) setDetailError(String(e))
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false)
    }
  }

  return (
    <Box className="profiles-layout">
      <Box style={{ minWidth: 0 }}>
        <Card padding={8}>
          <Group justify="space-between" mb={6} px={6} pt={4}>
            <Group gap={8}>
              <ILayers size={15} />
              <Text fw={600} fz="sm">
                配置
              </Text>
            </Group>
            <ActionIcon size={32} loading={creating} onClick={() => void create()} aria-label="新建配置">
              <IPlus size={14} />
            </ActionIcon>
          </Group>
          {profilesLoading ? (
            <ListSkeleton rows={4} />
          ) : profilesError ? (
            <LoadError message={profilesError} onRetry={() => void loadProfiles(true)} />
          ) : profiles.length === 0 ? (
            <Text c="dimmed" fz="sm" px={6} py={4}>
              还没有配置，点右上「+」新建。
            </Text>
          ) : (
            <Stack gap={2}>
              {profiles.map((p) => {
                const on = selectedId === p.id
                return (
                  <UnstyledButton
                    key={p.id}
                    className="profile-row"
                    data-active={on || undefined}
                    aria-pressed={on}
                    onClick={() => void selectProfile(p.id)}
                  >
                    <Text fz={13.5} fw={on ? 600 : 400} c={on ? 'violet' : undefined} truncate>
                      {p.name}
                    </Text>
                    <Badge variant="light" color="gray" size="sm" tt="none" fw={500}>
                      {p.target}
                    </Badge>
                  </UnstyledButton>
                )
              })}
            </Stack>
          )}
        </Card>
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        {detailLoading ? (
          <DetailSkeleton />
        ) : detailError ? (
          <LoadError message={detailError} onRetry={() => selectedId && void selectProfile(selectedId)} />
        ) : !sel ? (
          <Card>
            <Stack align="center" gap={8} py={44} c="dimmed">
              <ILayers size={34} />
              <Text fw={600} c="var(--mantine-color-text)">
                选择或新建一个配置
              </Text>
              <Text fz="sm" ta="center">
                配置决定订阅怎么转：套模板、勾选分流、或写脚本。
              </Text>
            </Stack>
          </Card>
        ) : (
          <ProfileDetail
            key={sel.id}
            profile={sel}
            subs={subs}
            subsLoading={subsLoading}
            subsError={subsError}
            onRetrySubs={() => void loadSubs()}
            dts={dts}
            renderers={renderers}
            hasAgent={hasAgent}
            onSaved={(p) => {
              setSel(p)
              setSelectedId(p.id)
              void loadProfiles()
            }}
            onDeleted={() => {
              detailRequest.current += 1
              setSel(null)
              setSelectedId(null)
              void loadProfiles()
            }}
          />
        )}
      </Box>
    </Box>
  )
}

interface OpForm {
  dedupe: boolean
  tagRegions: boolean
  sortByName: boolean
  dropPattern: string
  keepPattern: string
  renameFrom: string
  renameTo: string
}
function parseOps(ops: NodeOp[] = []): OpForm {
  const f: OpForm = { dedupe: false, tagRegions: false, sortByName: false, dropPattern: '', keepPattern: '', renameFrom: '', renameTo: '' }
  for (const o of ops) {
    if (o.op === 'dedupe') f.dedupe = true
    else if (o.op === 'tagRegions') f.tagRegions = true
    else if (o.op === 'sortByName') f.sortByName = true
    else if (o.op === 'drop') f.dropPattern = o.pattern
    else if (o.op === 'keep') f.keepPattern = o.pattern
    else if (o.op === 'rename') {
      f.renameFrom = o.from
      f.renameTo = o.to
    }
  }
  return f
}
function buildOps(f: OpForm): NodeOp[] {
  const ops: NodeOp[] = []
  if (f.dropPattern) ops.push({ op: 'drop', pattern: f.dropPattern })
  if (f.keepPattern) ops.push({ op: 'keep', pattern: f.keepPattern })
  if (f.renameFrom) ops.push({ op: 'rename', from: f.renameFrom, to: f.renameTo })
  if (f.dedupe) ops.push({ op: 'dedupe' })
  if (f.tagRegions) ops.push({ op: 'tagRegions' })
  if (f.sortByName) ops.push({ op: 'sortByName' })
  return ops
}

function ProfileDetail({
  profile,
  subs,
  subsLoading,
  subsError,
  onRetrySubs,
  dts,
  renderers,
  hasAgent,
  onSaved,
  onDeleted,
}: {
  profile: Profile
  subs: Subscription[]
  subsLoading: boolean
  subsError: string
  onRetrySubs: () => void
  dts: string
  renderers: string[]
  hasAgent: boolean
  onSaved: (p: Profile) => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [target, setTarget] = useState(profile.target)
  const [subIds, setSubIds] = useState<string[]>(profile.subscriptionIds)
  const [opForm, setOpForm] = useState<OpForm>(parseOps(profile.profile.operations))
  const [groups, setGroups] = useState<ProxyGroupDef[]>(profile.profile.groups || [])
  const [rules, setRules] = useState<string[]>(profile.profile.rules || [])
  const [script, setScript] = useState(profile.script || '')
  const [showScript, setShowScript] = useState(!!profile.script)
  const [versions, setVersions] = useState<{ id: string; note?: string; createdAt: number }[]>([])
  const [health, setHealth] = useState<{ alive: number; total: number; results: { name: string; latency: number | null }[] } | null>(null)
  const [testing, setTesting] = useState(false)
  const [templates, setTemplates] = useState<UITemplate[]>(builtinTemplates())
  const [showAgent, setShowAgent] = useState(false)
  const [output, setOutput] = useState<string | null>(null)
  const [outputOpen, outputCtl] = useDisclosure(false)
  const [saving, setSaving] = useState(false)
  const [outputLoading, setOutputLoading] = useState(false)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [rollbackId, setRollbackId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [templateName, setTemplateName] = useState(`${profile.name} 模板`)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<UITemplate | null>(null)
  const [agentReloading, setAgentReloading] = useState(false)

  const isOverride = /\bfunction\s+main\s*\(/.test(script)
  const scriptActive = !!script.trim()
  const groupsRulesIgnored = scriptActive && isOverride
  const shareUrl = `${location.origin}/sub/${profile.token}`
  const autoRegion = groups.some((g) => g.autoRegion)
  const setOp = (patch: Partial<OpForm>) => setOpForm((f) => ({ ...f, ...patch }))

  const reloadTemplates = () =>
    api
      .listTemplates()
      .then((l) => setTemplates([...builtinTemplates(), ...serverToUI(l)]))
      .catch(() => {})
  useEffect(() => {
    reloadTemplates()
  }, [])

  const reloadFromServer = async () => {
    if (agentReloading) return
    setAgentReloading(true)
    try {
      const p = await api.getProfile(profile.id)
      setName(p.name)
      setTarget(p.target)
      setSubIds(p.subscriptionIds)
      setOpForm(parseOps(p.profile.operations))
      setGroups(p.profile.groups || [])
      setRules(p.profile.rules || [])
      setScript(p.script || '')
      setShowScript(!!p.script)
      onSaved(p)
      ok('已根据 Agent 的改动刷新')
    } catch (e) {
      fail(e)
    } finally {
      setAgentReloading(false)
    }
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    const profileObj: ConversionProfile = { operations: buildOps(opForm), groups, rules, ruleProviders: profile.profile.ruleProviders }
    try {
      const p = await api.updateProfile(profile.id, { name, target, subscriptionIds: subIds, script: script || undefined, profile: profileObj })
      ok('已保存')
      onSaved(p)
    } catch (e) {
      fail(e)
    } finally {
      setSaving(false)
    }
  }

  const saveAsTemplate = async () => {
    const label = templateName.trim()
    if (!label || templateSaving) return
    setTemplateSaving(true)
    try {
      await api.createTemplate({ name: label, description: '（我的模板）', profile: { operations: buildOps(opForm), groups, rules }, script: script || undefined })
      await reloadTemplates()
      setTemplateOpen(false)
      ok(`已存为模板「${label}」`)
    } catch (e) {
      fail(e)
    } finally {
      setTemplateSaving(false)
    }
  }

  const applyTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key)
    if (!t) return
    setPendingTemplate(t)
  }

  const confirmApplyTemplate = () => {
    const t = pendingTemplate
    if (!t) return
    setOpForm(parseOps(t.profile.operations))
    setGroups(structuredClone(t.profile.groups))
    setRules([...t.profile.rules])
    setScript(t.script || '')
    setShowScript(!!t.script)
    setPendingTemplate(null)
  }

  const viewOutput = async () => {
    if (outputLoading) return
    setOutputLoading(true)
    try {
      const o = await api.output(profile.id)
      setOutput(o.ok ? o.config || '' : `生成失败：${o.error}`)
      outputCtl.open()
    } catch (e) {
      fail(e)
    } finally {
      setOutputLoading(false)
    }
  }

  const loadVersions = async () => {
    if (versionsLoading) return
    setVersionsLoading(true)
    try {
      setVersions(await api.versions(profile.id))
    } catch (e) {
      fail(e)
    } finally {
      setVersionsLoading(false)
    }
  }

  const rollback = async (versionId: string) => {
    if (rollbackId) return
    setRollbackId(versionId)
    try {
      const p = await api.rollback(profile.id, versionId)
      setVersions([])
      onSaved(p)
      ok('已回滚')
    } catch (e) {
      fail(e)
    } finally {
      setRollbackId(null)
    }
  }

  const remove = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await api.deleteProfile(profile.id)
      setDeleteOpen(false)
      onDeleted()
      ok('已删除配置')
    } catch (e) {
      fail(e)
    } finally {
      setDeleting(false)
    }
  }

  const runHealth = () => {
    setHealth(null)
    setTesting(true)
    api
      .healthcheck(profile.id)
      .then(setHealth)
      .catch((e) => fail(String(e).includes('501') ? '当前部署不支持测活（边缘运行时）' : String(e)))
      .finally(() => setTesting(false))
  }

  const toggleAutoRegion = () =>
    autoRegion ? setGroups((gs) => gs.filter((g) => !g.autoRegion)) : setGroups((gs) => [...gs, { ...COMMON_GROUPS.regions }])
  const addCommon = (g: ProxyGroupDef) => {
    if (!groups.some((x) => x.name === g.name)) setGroups((gs) => [...gs, structuredClone(g)])
  }
  const updateGroup = (i: number, patch: Partial<ProxyGroupDef>) =>
    setGroups((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)))
  const delGroup = (i: number) => setGroups((gs) => gs.filter((_, idx) => idx !== i))

  const presetOn = (keys: string[]) => keys.every((r) => rules.includes(r))
  const togglePreset = (key: string) => {
    const p = RULE_PRESETS.find((x) => x.key === key)!
    if (presetOn(p.rules)) {
      setRules((rs) => rs.filter((r) => !p.rules.includes(r)))
      if (p.group) setGroups((gs) => gs.filter((g) => g.name !== p.group!.name))
    } else {
      setRules((rs) => {
        const at = rs.findIndex((r) => r.startsWith('MATCH'))
        const i = at < 0 ? rs.length : at
        return [...rs.slice(0, i), ...p.rules, ...rs.slice(i)]
      })
      if (p.group && !groups.some((g) => g.name === p.group!.name)) setGroups((gs) => [...gs, structuredClone(p.group!)])
    }
  }

  return (
    <Stack gap="md">
      {/* 基本信息 + 操作 */}
      <Card>
        <Box className="form-grid form-grid-2">
          <TextInput label="名称" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <NativeSelect label="输出格式" value={target} onChange={(e) => setTarget(e.currentTarget.value)} data={renderers} />
        </Box>
        <TextInput
          mt="sm"
          label={
            <Group gap={5} component="span">
              <ILink size={12} /> 分享链接（凭此订阅，无需口令）
            </Group>
          }
          readOnly
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12.5 } }}
        />
        <Box mt="sm">
          <Text fz="sm" fw={500} mb={6}>
            关联订阅
          </Text>
          {subsLoading ? (
            <Skeleton h={32} radius={6} />
          ) : subsError ? (
            <LoadError message={subsError} onRetry={onRetrySubs} />
          ) : subs.length === 0 ? (
            <Text c="dimmed" fz="sm">
              先去「订阅」页添加订阅
            </Text>
          ) : (
            <Chip.Group multiple value={subIds} onChange={setSubIds}>
              <Group gap={8}>
                {subs.map((s) => (
                  <Chip key={s.id} value={s.id} variant="light" size="sm">
                    {s.name}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          )}
        </Box>

        <Box className="profile-actions" mt="md">
          <Button leftSection={<ISave size={15} />} loading={saving} onClick={() => void save()}>
            保存
          </Button>
          <NativeSelect
            w="auto"
            value=""
            onChange={(e) => {
              if (e.currentTarget.value) applyTemplate(e.currentTarget.value)
            }}
            data={[{ value: '', label: '从模板开始…' }, ...templates.map((t) => ({ value: t.key, label: `${t.serverId ? '★ ' : ''}${t.label}` }))]}
          />
          <Button
            variant="default"
            leftSection={<ITemplate size={14} />}
            onClick={() => {
              setTemplateName(`${name} 模板`)
              setTemplateOpen(true)
            }}
          >
            存为模板
          </Button>
          <Button variant="default" leftSection={<IPlay size={14} />} loading={outputLoading} onClick={() => void viewOutput()}>
            查看输出
          </Button>
          <Button
            variant="default"
            leftSection={<IHistory size={14} />}
            loading={versionsLoading}
            onClick={() => void loadVersions()}
          >
            版本
          </Button>
          <Button variant="default" leftSection={<IZap size={14} />} loading={testing} onClick={runHealth}>
            {testing ? '测活中…' : '测活'}
          </Button>
          <Button
            variant={showAgent ? 'filled' : 'light'}
            leftSection={<IBot size={14} />}
            onClick={() => setShowAgent((v) => !v)}
          >
            Agent
          </Button>
          <ActionIcon size="lg" variant="subtle" color="red" onClick={() => setDeleteOpen(true)} aria-label={`删除配置 ${name}`}>
            <ITrash size={15} />
          </ActionIcon>
        </Box>

        {versions.length > 0 && (
          <Box mt="md">
            <Text fz="sm" fw={500} mb={6}>
              版本历史
            </Text>
            <Stack gap={4}>
              {versions.map((v) => (
                <Group key={v.id} justify="space-between" wrap="wrap">
                  <Text fz={12} c="dimmed">
                    {new Date(v.createdAt).toLocaleString()} — {v.note || '快照'}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    loading={rollbackId === v.id}
                    disabled={rollbackId !== null && rollbackId !== v.id}
                    onClick={() => void rollback(v.id)}
                  >
                    回滚
                  </Button>
                </Group>
              ))}
            </Stack>
          </Box>
        )}
        {health && (
          <Box mt="md">
            <Text fz="sm" fw={500} mb={6}>
              存活 {health.alive} / {health.total}（按延迟排序）
            </Text>
            <Group gap={6} style={{ maxHeight: 160, overflow: 'auto' }}>
              {health.results
                .slice()
                .sort((a, b) => (a.latency ?? 99999) - (b.latency ?? 99999))
                .map((r, i) => (
                  <Badge key={i} variant="light" color={r.latency === null ? 'red' : 'gray'} tt="none" fw={500}>
                    {r.name} · {r.latency === null ? '超时' : `${r.latency}ms`}
                  </Badge>
                ))}
            </Group>
          </Box>
        )}
      </Card>

      {/* Agent 面板 */}
      {showAgent && (
        <Card style={{ borderColor: 'var(--mantine-color-violet-3)' }}>
          <CardHead>
            <IBot size={15} />
            <Text fw={600}>Agent · 对话即改当前配置</Text>
          </CardHead>
          <Text c="dimmed" fz="sm" mb="sm">
            例：「香港节点单独分组、按延迟测速」「加一条 Netflix 分流」「把当前配置存成模板，叫 家用」「套用模板 家用」。改完自动刷新。
          </Text>
          <AgentChatPanel
            threadId={`profile:${profile.id}`}
            hasAgent={hasAgent}
            onChanged={reloadFromServer}
            height={300}
            context={`用户正在编辑配置：id=${profile.id}，name=「${name}」。除非明确指定其它档，所有 read/write/preview/validate/save_template/apply_template 操作都针对这个档（profileId=${profile.id}）。`}
          />
          {agentReloading && <Text c="dimmed" fz="xs" mt="xs">正在同步 Agent 的改动…</Text>}
        </Card>
      )}

      {groupsRulesIgnored && (
        <Card style={{ borderColor: 'var(--mantine-color-violet-3)' }}>
          <Badge variant="light" color="violet">
            override 模式
          </Badge>
          <Text c="dimmed" fz="sm" mt={6}>
            「代理组 / 规则」由脚本 <span className="mono">main(config)</span> 生成，此处忽略；但「节点处理」仍在脚本前生效，可共存。
          </Text>
        </Card>
      )}

      {/* ① 节点处理 */}
      <Card>
        <CardHead right={<DimIcon><ISliders size={15} /></DimIcon>}>
          <StepNum n={1} />
          <Text fw={600}>
            节点处理
            {groupsRulesIgnored && (
              <Text span c="dimmed" fw={400} fz="sm">
                {' '}
                · 脚本前生效
              </Text>
            )}
          </Text>
        </CardHead>
        <Group mb="sm" gap="lg">
          <Checkbox label="去重" checked={opForm.dedupe} onChange={(e) => setOp({ dedupe: e.currentTarget.checked })} />
          <Checkbox label="地区打标签" checked={opForm.tagRegions} onChange={(e) => setOp({ tagRegions: e.currentTarget.checked })} />
          <Checkbox label="按名称排序" checked={opForm.sortByName} onChange={(e) => setOp({ sortByName: e.currentTarget.checked })} />
        </Group>
        <Box className="form-grid form-grid-2">
          <TextInput label="剔除节点（正则）" placeholder="过期|剩余|官网|流量" value={opForm.dropPattern} onChange={(e) => setOp({ dropPattern: e.currentTarget.value })} />
          <TextInput label="只保留节点（正则）" placeholder="留空 = 不限" value={opForm.keepPattern} onChange={(e) => setOp({ keepPattern: e.currentTarget.value })} />
        </Box>
        <Box className="form-grid form-grid-2" mt="sm">
          <TextInput label="重命名 · 匹配（正则）" value={opForm.renameFrom} onChange={(e) => setOp({ renameFrom: e.currentTarget.value })} />
          <TextInput label="重命名 · 替换为" value={opForm.renameTo} onChange={(e) => setOp({ renameTo: e.currentTarget.value })} />
        </Box>
      </Card>

      {/* ② 代理组 */}
      <Card className={groupsRulesIgnored ? 'config-section-disabled' : undefined} aria-disabled={groupsRulesIgnored}>
        <CardHead right={<DimIcon><IGlobe size={15} /></DimIcon>}>
          <StepNum n={2} />
          <Text fw={600}>代理组</Text>
        </CardHead>
        <Group mb="sm" justify="space-between">
          <Checkbox
            label="地区自动分组（按节点生成 HK/US/JP… 测速组）"
            checked={autoRegion}
            disabled={groupsRulesIgnored}
            onChange={toggleAutoRegion}
          />
          <Group gap={6}>
            <Button size="compact-sm" variant="default" disabled={groupsRulesIgnored} leftSection={<IPlus size={13} />} onClick={() => addCommon(COMMON_GROUPS.select)}>
              节点选择
            </Button>
            <Button size="compact-sm" variant="default" disabled={groupsRulesIgnored} leftSection={<IPlus size={13} />} onClick={() => addCommon(COMMON_GROUPS.autoSelect)}>
              自动选择
            </Button>
            <Button size="compact-sm" variant="default" disabled={groupsRulesIgnored} leftSection={<IPlus size={13} />} onClick={() => setGroups((gs) => [...gs, { name: '新组', type: 'select', includeAll: true }])}>
              空白组
            </Button>
          </Group>
        </Group>
        <Stack gap={8}>
          {groups
            .filter((g) => !g.autoRegion)
            .map((g) => {
              const idx = groups.indexOf(g)
              return (
                <Box key={idx} className="proxy-group-editor">
                  <Box className="proxy-group-main">
                    <TextInput label="组名" disabled={groupsRulesIgnored} value={g.name} onChange={(e) => updateGroup(idx, { name: e.currentTarget.value })} />
                    <NativeSelect
                      label="类型"
                      disabled={groupsRulesIgnored}
                      value={g.type}
                      onChange={(e) => updateGroup(idx, { type: e.currentTarget.value as ProxyGroupDef['type'] })}
                      data={['select', 'url-test', 'fallback', 'load-balance']}
                    />
                    <Checkbox className="proxy-group-checkbox" label="全部节点" disabled={groupsRulesIgnored} checked={!!g.includeAll} onChange={(e) => updateGroup(idx, { includeAll: e.currentTarget.checked })} />
                    <ActionIcon className="proxy-group-delete" variant="subtle" color="red" disabled={groupsRulesIgnored} onClick={() => delGroup(idx)} aria-label={`删除代理组 ${g.name}`}>
                      <ITrash size={14} />
                    </ActionIcon>
                  </Box>
                  <Box className="form-grid form-grid-2" mt="sm">
                    <TextInput label="包含过滤（正则，可选）" disabled={groupsRulesIgnored} value={g.filter || ''} onChange={(e) => updateGroup(idx, { filter: e.currentTarget.value })} />
                    <TextInput label="排除过滤（正则，可选）" disabled={groupsRulesIgnored} value={g.excludeFilter || ''} onChange={(e) => updateGroup(idx, { excludeFilter: e.currentTarget.value })} />
                  </Box>
                </Box>
              )
            })}
        </Stack>
        {autoRegion && (
          <Text c="dimmed" fz="sm" mt={8}>
            ✓ 地区组会在生成时按节点自动展开。
          </Text>
        )}
      </Card>

      {/* ③ 分流规则 */}
      <Card className={groupsRulesIgnored ? 'config-section-disabled' : undefined} aria-disabled={groupsRulesIgnored}>
        <CardHead right={<DimIcon><IFilter size={15} /></DimIcon>}>
          <StepNum n={3} />
          <Text fw={600}>分流规则</Text>
        </CardHead>
        <Text fz="sm" fw={500} mb={6}>
          分流预设（勾选自动加分组 + 规则）
        </Text>
        <Group gap={8} mb="sm">
          {RULE_PRESETS.map((p) => (
            <Chip key={p.key} checked={presetOn(p.rules)} disabled={groupsRulesIgnored} onChange={() => togglePreset(p.key)} variant="light" size="sm">
              {p.label}
            </Chip>
          ))}
        </Group>
        <Text fz="sm" fw={500} mb={6}>
          规则列表（每行一条，末行一般 MATCH 兜底）
        </Text>
        <Textarea
          rows={8}
          disabled={groupsRulesIgnored}
          value={rules.join('\n')}
          onChange={(e) => setRules(e.currentTarget.value.split('\n').map((s) => s.trim()).filter(Boolean))}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12.5 } }}
        />
      </Card>

      {/* ④ 脚本 */}
      <Card>
        <CardHead
          right={
            <Button size="compact-sm" variant="subtle" leftSection={<ICode size={14} />} onClick={() => setShowScript((v) => !v)}>
              {showScript ? '收起' : '展开'}
            </Button>
          }
        >
          <StepNum n={4} />
          <Text fw={600}>自定义脚本</Text>
          {scriptActive && (
            <Badge variant="light" color="violet">
              {isOverride ? 'override' : 'transform'}
            </Badge>
          )}
        </CardHead>
        <Text c="dimmed" fz="sm">
          留空则用上面的表单；写代码可完全自定义（<span className="mono">return nodes</span> 变换，或{' '}
          <span className="mono">function main(config)</span> 覆写）。
        </Text>
        <Collapse in={showScript}>
          <Box mt="sm">
            <ScriptEditor profileId={profile.id} value={script} onChange={setScript} dts={dts} />
          </Box>
        </Collapse>
      </Card>

      <Modal opened={templateOpen} onClose={() => !templateSaving && setTemplateOpen(false)} title="存为模板" centered>
        <TextInput
          label="模板名称"
          value={templateName}
          onChange={(e) => setTemplateName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveAsTemplate()
          }}
        />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" autoFocus disabled={templateSaving} onClick={() => setTemplateOpen(false)}>
            取消
          </Button>
          <Button loading={templateSaving} disabled={!templateName.trim()} onClick={() => void saveAsTemplate()}>
            保存模板
          </Button>
        </Group>
      </Modal>

      <Modal opened={!!pendingTemplate} onClose={() => setPendingTemplate(null)} title="套用模板" centered>
        <Text fz="sm">
          套用模板“{pendingTemplate?.label}”会替换当前尚未保存的节点处理、代理组、规则和脚本。
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" autoFocus onClick={() => setPendingTemplate(null)}>
            取消
          </Button>
          <Button onClick={confirmApplyTemplate}>套用</Button>
        </Group>
      </Modal>

      <Modal
        opened={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        title="删除配置"
        centered
        closeOnClickOutside={!deleting}
        closeOnEscape={!deleting}
      >
        <Text fz="sm">确认删除配置“{name}”？对应的公开订阅链接将立即失效，历史版本也会一并删除。</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" autoFocus disabled={deleting} onClick={() => setDeleteOpen(false)}>
            取消
          </Button>
          <Button color="red" loading={deleting} onClick={() => void remove()}>
            删除
          </Button>
        </Group>
      </Modal>

      <Modal opened={outputOpen} onClose={outputCtl.close} title="输出预览" size="xl" scrollAreaComponent={ScrollArea.Autosize}>
        <Code block style={{ maxHeight: '70vh', overflow: 'auto', fontSize: 12 }}>
          {output}
        </Code>
      </Modal>
    </Stack>
  )
}
