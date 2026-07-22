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
  CopyButton,
  Group,
  Menu,
  Modal,
  NativeSelect,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { AGENT_CHANGED_EVENT } from '../App'
import { IAlert, ICheck, ICopy, IDots, IHistory, ILayers, IPlus, ISave, ISearch, ITrash } from '../icons'
import { builtinTemplates, serverToUI, type UITemplate } from '../templates'
import type { ConversionProfile, NodeOp, Profile, ProxyGroupDef, Subscription } from '../types'
import { DetailSkeleton, ListSkeleton, LoadError } from './AsyncState'

const ScriptEditor = lazy(() => import('./ScriptEditor').then((module) => ({ default: module.ScriptEditor })))

const ok = (message: string) => notifications.show({ color: 'teal', message })
const fail = (e: unknown) => notifications.show({ color: 'red', message: String(e) })

export function Profiles({
  dts,
  renderers,
  onSelectionChange,
}: {
  dts: string
  renderers: string[]
  onSelectionChange?: (sel: { id: string; name: string } | null) => void
}) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [sel, setSel] = useState<Profile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState('')
  const [subsLoading, setSubsLoading] = useState(true)
  const [subsError, setSubsError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [creating, setCreating] = useState(false)
  const detailRequest = useRef(0)

  useEffect(() => {
    onSelectionChange?.(sel ? { id: sel.id, name: sel.name } : null)
    // 组件卸载（切走页面）时清空 Agent 抽屉的配置上下文
    return () => onSelectionChange?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, sel?.name])

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

  const shown = filter.trim()
    ? profiles.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : profiles

  return (
    <Card padding={0} className="profiles-card">
      {/* 左：配置列表 */}
      <Box className="profiles-list">
        <Group gap={6} p={12} wrap="nowrap" className="profiles-list-head">
          <TextInput
            size="xs"
            radius={7}
            placeholder="搜索配置…"
            leftSection={<ISearch size={13} />}
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 0 }}
            styles={{ input: { height: 32, fontSize: 13 } }}
          />
          <ActionIcon size={32} radius={7} loading={creating} onClick={() => void create()} aria-label="新建配置">
            <IPlus size={14} />
          </ActionIcon>
        </Group>
        {profilesLoading ? (
          <Box px={12}>
            <ListSkeleton rows={4} />
          </Box>
        ) : profilesError ? (
          <Box p={12}>
            <LoadError message={profilesError} onRetry={() => void loadProfiles(true)} />
          </Box>
        ) : shown.length === 0 ? (
          <Text c="dimmed" fz="sm" px={14} py={12}>
            {profiles.length === 0 ? '还没有配置，点上方「+」新建。' : '没有匹配的配置。'}
          </Text>
        ) : (
          <Box>
            {shown.map((p) => {
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
          </Box>
        )}
      </Box>

      {/* 右：详情 */}
      <Box className="profiles-detail">
        {detailLoading ? (
          <Box p={20}>
            <DetailSkeleton />
          </Box>
        ) : detailError ? (
          <Box p={20}>
            <LoadError message={detailError} onRetry={() => selectedId && void selectProfile(selectedId)} />
          </Box>
        ) : !sel ? (
          <Stack align="center" gap={8} py={64} c="dimmed">
            <ILayers size={34} />
            <Text fw={600} c="var(--mantine-color-text)">
              选择或新建一个配置
            </Text>
            <Text fz="sm" ta="center">
              配置决定订阅怎么转：套模板、勾选分流、或写脚本。
            </Text>
          </Stack>
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
    </Card>
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

type Section = 'nodes' | 'groups' | 'rules' | 'script'

function fmtClock(ts: number) {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function ProfileDetail({
  profile,
  subs,
  subsLoading,
  subsError,
  onRetrySubs,
  dts,
  renderers,
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
  const [section, setSection] = useState<Section>('nodes')
  const [versions, setVersions] = useState<{ id: string; note?: string; createdAt: number }[]>([])
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [health, setHealth] = useState<{ alive: number; total: number; results: { name: string; latency: number | null }[] } | null>(null)
  const [healthOpen, setHealthOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [templates, setTemplates] = useState<UITemplate[]>(builtinTemplates())
  const [output, setOutput] = useState<string | null>(null)
  const [outputOpen, outputCtl] = useDisclosure(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(profile.updatedAt)
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
  const [saveSlot, setSaveSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setSaveSlot(document.getElementById('sf-save-slot'))
  }, [])

  const isOverride = /\bfunction\s+main\s*\(/.test(script)
  const scriptActive = !!script.trim()
  const groupsRulesIgnored = scriptActive && isOverride
  const shareUrl = `${location.origin}/sub/${profile.token}`
  const autoRegion = groups.some((g) => g.autoRegion)
  const setOp = (patch: Partial<OpForm>) => setOpForm((f) => ({ ...f, ...patch }))

  const snapshot = (v: { name: string; target: string; subIds: string[]; opForm: OpForm; groups: ProxyGroupDef[]; rules: string[]; script: string }) =>
    JSON.stringify(v)
  const [baseline, setBaseline] = useState(() =>
    snapshot({ name: profile.name, target: profile.target, subIds: profile.subscriptionIds, opForm: parseOps(profile.profile.operations), groups: profile.profile.groups || [], rules: profile.profile.rules || [], script: profile.script || '' }),
  )
  const dirty = useMemo(
    () => snapshot({ name, target, subIds, opForm, groups, rules, script }) !== baseline,
    [name, target, subIds, opForm, groups, rules, script, baseline],
  )

  const applyServerProfile = (p: Profile) => {
    setName(p.name)
    setTarget(p.target)
    setSubIds(p.subscriptionIds)
    setOpForm(parseOps(p.profile.operations))
    setGroups(p.profile.groups || [])
    setRules(p.profile.rules || [])
    setScript(p.script || '')
    setSavedAt(p.updatedAt)
    setBaseline(
      snapshot({ name: p.name, target: p.target, subIds: p.subscriptionIds, opForm: parseOps(p.profile.operations), groups: p.profile.groups || [], rules: p.profile.rules || [], script: p.script || '' }),
    )
  }

  const reloadTemplates = () =>
    api
      .listTemplates()
      .then((l) => setTemplates([...builtinTemplates(), ...serverToUI(l)]))
      .catch(() => {})
  useEffect(() => {
    reloadTemplates()
  }, [])

  // Agent（右侧抽屉）改动当前配置后，从服务端拉最新状态
  useEffect(() => {
    const onAgentChanged = () => {
      setAgentReloading(true)
      api
        .getProfile(profile.id)
        .then((p) => {
          applyServerProfile(p)
          onSaved(p)
          ok('已根据 Agent 的改动刷新')
        })
        .catch(fail)
        .finally(() => setAgentReloading(false))
    }
    window.addEventListener(AGENT_CHANGED_EVENT, onAgentChanged)
    return () => window.removeEventListener(AGENT_CHANGED_EVENT, onAgentChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  const save = async () => {
    if (saving) return
    setSaving(true)
    const profileObj: ConversionProfile = { operations: buildOps(opForm), groups, rules, ruleProviders: profile.profile.ruleProviders }
    try {
      const p = await api.updateProfile(profile.id, { name, target, subscriptionIds: subIds, script: script || undefined, profile: profileObj })
      ok('已保存')
      setSavedAt(p.updatedAt)
      setBaseline(snapshot({ name, target, subIds, opForm, groups, rules, script }))
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
      setVersionsOpen(true)
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
      setVersionsOpen(false)
      applyServerProfile(p)
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
      .then((h) => {
        setHealth(h)
        setHealthOpen(true)
      })
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

  const visibleGroupCount = groups.filter((g) => !g.autoRegion).length
  const SECTIONS: { key: Section; label: string; badge: string }[] = [
    { key: 'nodes', label: '节点处理', badge: '' },
    { key: 'groups', label: '代理组', badge: visibleGroupCount ? String(visibleGroupCount) : '' },
    { key: 'rules', label: '分流规则', badge: rules.length ? String(rules.length) : '' },
    { key: 'script', label: '脚本', badge: scriptActive ? 'on' : '' },
  ]

  const saveBar = (
    <Box className="save-bar">
      {dirty ? (
        <Text fz={13} fw={500} c="var(--sf-amber)" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Box component="span" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sf-amber)' }} />
          未保存更改
        </Text>
      ) : (
        <Text fz={13} fw={500} c="teal" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <ICheck size={13} />
          已保存
        </Text>
      )}
      <Text fz={12.5} c="dimmed">
        上次保存 {fmtClock(savedAt)} · 保存自动建快照
      </Text>
      {agentReloading && (
        <Text fz={12.5} c="dimmed">
          正在同步 Agent 的改动…
        </Text>
      )}
      <Group gap={8} ml="auto" wrap="wrap" justify="flex-end">
        <NativeSelect
          size="xs"
          radius={7}
          value=""
          aria-label="套用模板"
          onChange={(e) => {
            if (e.currentTarget.value) applyTemplate(e.currentTarget.value)
          }}
          data={[{ value: '', label: '从模板开始…' }, ...templates.map((t) => ({ value: t.key, label: `${t.serverId ? '★ ' : ''}${t.label}` }))]}
          styles={{ input: { height: 34 } }}
        />
        <Button variant="subtle" color="gray" h={34} radius={7} px={14} fz={13} loading={versionsLoading} onClick={() => void loadVersions()}>
          版本历史
        </Button>
        <Button variant="default" h={34} radius={7} px={14} fz={13} loading={testing} onClick={runHealth}>
          {testing ? '测活中…' : '测活'}
        </Button>
        <Button variant="default" h={34} radius={7} px={14} fz={13} loading={outputLoading} onClick={() => void viewOutput()}>
          查看输出
        </Button>
        <Button
          variant="default"
          h={34}
          radius={7}
          px={14}
          fz={13}
          onClick={() => {
            setTemplateName(`${name} 模板`)
            setTemplateOpen(true)
          }}
        >
          存为模板
        </Button>
        <Button h={36} radius={7} px={22} leftSection={<ISave size={15} />} loading={saving} onClick={() => void save()}>
          保存
        </Button>
      </Group>
    </Box>
  )

  return (
    <Box>
      {/* 头部：名称 / 输出格式 / 分享链接 / 更多 */}
      <Box px={20} pt={16} pb={6}>
        <Box className="profile-head-grid">
          <TextInput label="名称" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <NativeSelect label="输出格式" value={target} onChange={(e) => setTarget(e.currentTarget.value)} data={renderers} />
          <Box>
            <Text component="label" fz={13} fw={500} c="dimmed" display="block" mb={5}>
              分享链接（凭此订阅，无需口令）
            </Text>
            <Group gap={6} wrap="nowrap">
              <TextInput
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: 1, minWidth: 0 }}
                styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 11.5, background: 'var(--sf-surface-subtle)' } }}
              />
              <CopyButton value={shareUrl} timeout={1600}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? '已复制' : '复制'}>
                    <ActionIcon variant="default" size={36} radius={7} onClick={copy} aria-label="复制分享链接">
                      {copied ? <ICheck size={15} /> : <ICopy size={15} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          </Box>
          <Menu position="bottom-end" width={160}>
            <Menu.Target>
              <ActionIcon variant="default" size={36} radius={7} c="dimmed" aria-label="更多操作" style={{ alignSelf: 'end' }}>
                <IDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IHistory size={14} />} onClick={() => void loadVersions()}>
                版本历史
              </Menu.Item>
              <Menu.Item color="red" leftSection={<ITrash size={14} />} onClick={() => setDeleteOpen(true)}>
                删除配置
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Box>

        <Group gap={8} mt={14} wrap="wrap">
          <Text fz={13} fw={500} c="dimmed">
            关联订阅
          </Text>
          {subsLoading ? (
            <Skeleton h={26} w={160} radius={100} />
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
        </Group>
      </Box>

      {/* 区块 tab */}
      <Group justify="space-between" gap={14} px={12} mt={10} wrap="nowrap" className="section-tabs">
        <Group gap={0} wrap="nowrap">
          {SECTIONS.map((s) => (
            <UnstyledButton
              key={s.key}
              className="section-tab"
              data-active={section === s.key || undefined}
              onClick={() => setSection(s.key)}
            >
              {s.label}
              {s.badge && <span className="section-tab-badge">{s.badge}</span>}
            </UnstyledButton>
          ))}
        </Group>
        {scriptActive && (
          <Text fz={12.5} fw={500} className="script-pill" title={groupsRulesIgnored ? '脚本 main(config) 覆写输出，代理组 / 规则由脚本决定' : '脚本以 transform 模式变换节点'}>
            <IAlert size={13} />
            {groupsRulesIgnored ? '脚本已启用 · 覆盖表单' : '脚本已启用 · transform'}
          </Text>
        )}
      </Group>

      {/* 节点处理 */}
      {section === 'nodes' && (
        <Box px={20} py={16}>
          <Group mb={14} gap={20}>
            <Checkbox label="去重" checked={opForm.dedupe} onChange={(e) => setOp({ dedupe: e.currentTarget.checked })} />
            <Checkbox label="地区打标签" checked={opForm.tagRegions} onChange={(e) => setOp({ tagRegions: e.currentTarget.checked })} />
            <Checkbox label="按名称排序" checked={opForm.sortByName} onChange={(e) => setOp({ sortByName: e.currentTarget.checked })} />
          </Group>
          <Box className="form-grid form-grid-2">
            <TextInput label="剔除节点（正则）" placeholder="过期|剩余|官网|流量" value={opForm.dropPattern} onChange={(e) => setOp({ dropPattern: e.currentTarget.value })} />
            <TextInput label="只保留节点（正则）" placeholder="留空 = 不限" value={opForm.keepPattern} onChange={(e) => setOp({ keepPattern: e.currentTarget.value })} />
            <TextInput label="重命名 · 匹配（正则）" value={opForm.renameFrom} onChange={(e) => setOp({ renameFrom: e.currentTarget.value })} />
            <TextInput label="重命名 · 替换为" value={opForm.renameTo} onChange={(e) => setOp({ renameTo: e.currentTarget.value })} />
          </Box>
          {groupsRulesIgnored && (
            <Text c="dimmed" fz="sm" mt={12}>
              节点处理在脚本之前生效，可与 override 脚本共存。
            </Text>
          )}
        </Box>
      )}

      {/* 代理组 */}
      {section === 'groups' && (
        <Box px={20} py={16}>
          <Group justify="space-between" gap={12} mb={12} wrap="wrap">
            <Checkbox
              label="地区自动分组（按节点生成 HK/US/JP… 测速组）"
              checked={autoRegion}
              disabled={groupsRulesIgnored}
              onChange={toggleAutoRegion}
            />
            <Group gap={6}>
              <Button size="compact-sm" variant="light" color="gray" disabled={groupsRulesIgnored} onClick={() => addCommon(COMMON_GROUPS.select)}>
                + 节点选择
              </Button>
              <Button size="compact-sm" variant="light" color="gray" disabled={groupsRulesIgnored} onClick={() => addCommon(COMMON_GROUPS.autoSelect)}>
                + 自动选择
              </Button>
              <Button size="compact-sm" variant="light" color="gray" disabled={groupsRulesIgnored} onClick={() => setGroups((gs) => [...gs, { name: '新组', type: 'select', includeAll: true }])}>
                + 空白组
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
            <Text c="dimmed" fz={12.5} mt={8}>
              地区组会在生成时按节点自动展开。
            </Text>
          )}
          {groupsRulesIgnored && (
            <Text c="dimmed" fz="sm" mt={12}>
              override 模式下代理组由脚本 <span className="mono">main(config)</span> 生成，此处忽略。
            </Text>
          )}
        </Box>
      )}

      {/* 分流规则 */}
      {section === 'rules' && (
        <Box px={20} py={16}>
          <Text fz={13} fw={500} c="dimmed" mb={8}>
            分流预设（勾选自动加分组 + 规则）
          </Text>
          <Group gap={8} mb={14}>
            {RULE_PRESETS.map((p) => (
              <Chip key={p.key} checked={presetOn(p.rules)} disabled={groupsRulesIgnored} onChange={() => togglePreset(p.key)} variant="light" size="sm">
                {p.label}
              </Chip>
            ))}
          </Group>
          <Text fz={13} fw={500} c="dimmed" mb={8}>
            规则列表（每行一条，末行一般 MATCH 兜底）
          </Text>
          <Textarea
            rows={8}
            disabled={groupsRulesIgnored}
            value={rules.join('\n')}
            onChange={(e) => setRules(e.currentTarget.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12.5, background: 'var(--sf-surface-subtle)' } }}
          />
          {groupsRulesIgnored && (
            <Text c="dimmed" fz="sm" mt={12}>
              override 模式下规则由脚本 <span className="mono">main(config)</span> 生成，此处忽略。
            </Text>
          )}
        </Box>
      )}

      {/* 脚本 */}
      {section === 'script' && (
        <Box px={20} py={16}>
          <Text c="dimmed" fz={13} mb={12}>
            留空则用表单；写代码可完全自定义（<span className="mono">return nodes</span> 变换，或{' '}
            <span className="mono">function main(config)</span> 覆写）。
            {scriptActive && (
              <Badge variant="light" color="violet" ml={8}>
                {isOverride ? 'override' : 'transform'}
              </Badge>
            )}
          </Text>
          <Suspense fallback={<DetailSkeleton />}>
            <ScriptEditor profileId={profile.id} value={script} onChange={setScript} dts={dts} />
          </Suspense>
        </Box>
      )}

      {/* 吸底保存栏（portal 到主列底部） */}
      {saveSlot && createPortal(saveBar, saveSlot)}

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
          <Button variant="default" data-autofocus disabled={templateSaving} onClick={() => setTemplateOpen(false)}>
            取消
          </Button>
          <Button loading={templateSaving} disabled={!templateName.trim()} onClick={() => void saveAsTemplate()}>
            保存模板
          </Button>
        </Group>
      </Modal>

      <Modal opened={!!pendingTemplate} onClose={() => setPendingTemplate(null)} title="套用模板" centered>
        <Text fz="sm">套用模板“{pendingTemplate?.label}”会替换当前尚未保存的节点处理、代理组、规则和脚本。</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" data-autofocus onClick={() => setPendingTemplate(null)}>
            取消
          </Button>
          <Button onClick={confirmApplyTemplate}>套用</Button>
        </Group>
      </Modal>

      <Modal opened={versionsOpen} onClose={() => setVersionsOpen(false)} title="版本历史" centered>
        {versions.length === 0 ? (
          <Text c="dimmed" fz="sm">
            还没有快照，保存一次即可生成。
          </Text>
        ) : (
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
        )}
      </Modal>

      <Modal opened={healthOpen} onClose={() => setHealthOpen(false)} title="节点测活" centered>
        {health && (
          <>
            <Text fz="sm" fw={500} mb={8}>
              存活 {health.alive} / {health.total}（按延迟排序）
            </Text>
            <Group gap={6} style={{ maxHeight: 280, overflow: 'auto' }}>
              {health.results
                .slice()
                .sort((a, b) => (a.latency ?? 99999) - (b.latency ?? 99999))
                .map((r, i) => (
                  <Badge key={i} variant="light" color={r.latency === null ? 'red' : 'gray'} tt="none" fw={500}>
                    {r.name} · {r.latency === null ? '超时' : `${r.latency}ms`}
                  </Badge>
                ))}
            </Group>
          </>
        )}
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
          <Button variant="default" data-autofocus disabled={deleting} onClick={() => setDeleteOpen(false)}>
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
    </Box>
  )
}
