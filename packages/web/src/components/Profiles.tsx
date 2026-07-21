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
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import {
  IBot, ICode, IFilter, IGlobe, IHistory, ILayers, ILink, IPlay, IPlus, ISave, ISliders, ITemplate, ITrash, IZap,
} from '../icons'
import { builtinTemplates, serverToUI, type UITemplate } from '../templates'
import type { ConversionProfile, NodeOp, Profile, ProxyGroupDef, Subscription } from '../types'
import { AgentChatPanel } from './AgentChatPanel'
import { ScriptEditor } from './ScriptEditor'

const ok = (message: string) => notifications.show({ color: 'teal', message })
const fail = (e: unknown) => notifications.show({ color: 'red', message: String(e) })

function StepNum({ n }: { n: number }) {
  return (
    <Box
      style={{
        width: 21,
        height: 21,
        borderRadius: 7,
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

  const load = () => api.listProfiles().then(setProfiles)
  useEffect(() => {
    load()
    api.listSubscriptions().then(setSubs)
  }, [])

  const create = async () => {
    const p = await api.createProfile({ name: '新配置' })
    await load()
    setSel(p)
  }

  return (
    <Group align="flex-start" gap="lg" wrap="nowrap">
      <Box w={212} style={{ flexShrink: 0 }}>
        <Card padding={8}>
          <Group justify="space-between" mb={6} px={6} pt={4}>
            <Group gap={8}>
              <ILayers size={15} />
              <Text fw={600} fz="sm">
                配置
              </Text>
            </Group>
            <ActionIcon size="sm" onClick={create} aria-label="新建">
              <IPlus size={14} />
            </ActionIcon>
          </Group>
          {profiles.length === 0 && (
            <Text c="dimmed" fz="sm" px={6} py={4}>
              还没有配置，点右上「+」新建。
            </Text>
          )}
          <Stack gap={2}>
            {profiles.map((p) => {
              const on = sel?.id === p.id
              return (
                <Group
                  key={p.id}
                  justify="space-between"
                  wrap="nowrap"
                  px={11}
                  py={9}
                  onClick={() => api.getProfile(p.id).then(setSel)}
                  style={{
                    borderRadius: 9,
                    cursor: 'pointer',
                    background: on ? 'var(--mantine-color-violet-light)' : undefined,
                  }}
                >
                  <Text fz={13.5} fw={on ? 600 : 400} c={on ? 'violet' : undefined} truncate>
                    {p.name}
                  </Text>
                  <Badge variant="light" color="gray" size="sm" tt="none" fw={500}>
                    {p.target}
                  </Badge>
                </Group>
              )
            })}
          </Stack>
        </Card>
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        {!sel ? (
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
            dts={dts}
            renderers={renderers}
            hasAgent={hasAgent}
            onSaved={(p) => {
              setSel(p)
              load()
            }}
            onDeleted={() => {
              setSel(null)
              load()
            }}
          />
        )}
      </Box>
    </Group>
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
  dts,
  renderers,
  hasAgent,
  onSaved,
  onDeleted,
}: {
  profile: Profile
  subs: Subscription[]
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
  }

  const save = async () => {
    const profileObj: ConversionProfile = { operations: buildOps(opForm), groups, rules, ruleProviders: profile.profile.ruleProviders }
    try {
      const p = await api.updateProfile(profile.id, { name, target, subscriptionIds: subIds, script: script || undefined, profile: profileObj })
      ok('已保存')
      onSaved(p)
    } catch (e) {
      fail(e)
    }
  }

  const saveAsTemplate = async () => {
    const label = prompt('模板名称：', name + ' 模板')
    if (!label) return
    try {
      await api.createTemplate({ name: label, description: '（我的模板）', profile: { operations: buildOps(opForm), groups, rules }, script: script || undefined })
      await reloadTemplates()
      ok(`已存为模板「${label}」`)
    } catch (e) {
      fail(e)
    }
  }

  const applyTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key)
    if (!t) return
    if (!confirm(`套用模板「${t.label}」会覆盖当前的节点处理/分组/规则/脚本，继续？`)) return
    setOpForm(parseOps(t.profile.operations))
    setGroups(structuredClone(t.profile.groups))
    setRules([...t.profile.rules])
    setScript(t.script || '')
    setShowScript(!!t.script)
  }

  const viewOutput = async () => {
    try {
      const o = await api.output(profile.id)
      setOutput(o.ok ? o.config || '' : `生成失败：${o.error}`)
      outputCtl.open()
    } catch (e) {
      fail(e)
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
        <Group grow align="flex-start">
          <TextInput label="名称" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <NativeSelect label="输出格式" value={target} onChange={(e) => setTarget(e.currentTarget.value)} data={renderers} />
        </Group>
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
          {subs.length === 0 ? (
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

        <Group mt="md" gap={8}>
          <Button leftSection={<ISave size={15} />} onClick={save}>
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
          <Button variant="default" leftSection={<ITemplate size={14} />} onClick={saveAsTemplate}>
            存为模板
          </Button>
          <Button variant="default" leftSection={<IPlay size={14} />} onClick={viewOutput}>
            查看输出
          </Button>
          <Button
            variant="default"
            leftSection={<IHistory size={14} />}
            onClick={() => api.versions(profile.id).then(setVersions).catch(fail)}
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
          <Box style={{ flex: 1 }} />
          <ActionIcon size="lg" variant="subtle" color="red" onClick={() => api.deleteProfile(profile.id).then(onDeleted).catch(fail)} aria-label="删除配置">
            <ITrash size={15} />
          </ActionIcon>
        </Group>

        {versions.length > 0 && (
          <Box mt="md">
            <Text fz="sm" fw={500} mb={6}>
              版本历史
            </Text>
            <Stack gap={4}>
              {versions.map((v) => (
                <Group key={v.id} justify="space-between" wrap="nowrap">
                  <Text fz={12} c="dimmed">
                    {new Date(v.createdAt).toLocaleString()} — {v.note || '快照'}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() =>
                      api
                        .rollback(profile.id, v.id)
                        .then((p) => {
                          setVersions([])
                          onSaved(p)
                          ok('已回滚')
                        })
                        .catch(fail)
                    }
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
        <Group grow align="flex-start">
          <TextInput label="剔除节点（正则）" placeholder="过期|剩余|官网|流量" value={opForm.dropPattern} onChange={(e) => setOp({ dropPattern: e.currentTarget.value })} />
          <TextInput label="只保留节点（正则）" placeholder="留空 = 不限" value={opForm.keepPattern} onChange={(e) => setOp({ keepPattern: e.currentTarget.value })} />
        </Group>
        <Group grow align="flex-start" mt="sm">
          <TextInput label="重命名 · 匹配（正则）" value={opForm.renameFrom} onChange={(e) => setOp({ renameFrom: e.currentTarget.value })} />
          <TextInput label="重命名 · 替换为" value={opForm.renameTo} onChange={(e) => setOp({ renameTo: e.currentTarget.value })} />
        </Group>
      </Card>

      {/* ② 代理组 */}
      <Card style={{ opacity: groupsRulesIgnored ? 0.5 : 1, pointerEvents: groupsRulesIgnored ? 'none' : undefined }}>
        <CardHead right={<DimIcon><IGlobe size={15} /></DimIcon>}>
          <StepNum n={2} />
          <Text fw={600}>代理组</Text>
        </CardHead>
        <Group mb="sm" justify="space-between">
          <Checkbox
            label="地区自动分组（按节点生成 HK/US/JP… 测速组）"
            checked={autoRegion}
            onChange={toggleAutoRegion}
          />
          <Group gap={6}>
            <Button size="compact-sm" variant="default" leftSection={<IPlus size={13} />} onClick={() => addCommon(COMMON_GROUPS.select)}>
              节点选择
            </Button>
            <Button size="compact-sm" variant="default" leftSection={<IPlus size={13} />} onClick={() => addCommon(COMMON_GROUPS.autoSelect)}>
              自动选择
            </Button>
            <Button size="compact-sm" variant="default" leftSection={<IPlus size={13} />} onClick={() => setGroups((gs) => [...gs, { name: '新组', type: 'select', includeAll: true }])}>
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
                <Box key={idx} p={10} style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 10 }}>
                  <Group wrap="nowrap" gap={8}>
                    <TextInput style={{ flex: 2 }} value={g.name} onChange={(e) => updateGroup(idx, { name: e.currentTarget.value })} />
                    <NativeSelect
                      style={{ flex: 1 }}
                      value={g.type}
                      onChange={(e) => updateGroup(idx, { type: e.currentTarget.value as ProxyGroupDef['type'] })}
                      data={['select', 'url-test', 'fallback', 'load-balance']}
                    />
                    <Checkbox label="全部节点" checked={!!g.includeAll} onChange={(e) => updateGroup(idx, { includeAll: e.currentTarget.checked })} />
                    <ActionIcon variant="subtle" color="red" onClick={() => delGroup(idx)} aria-label="删除组">
                      <ITrash size={14} />
                    </ActionIcon>
                  </Group>
                  <Group grow mt={6} align="flex-start">
                    <TextInput placeholder="filter 正则（可选）" value={g.filter || ''} onChange={(e) => updateGroup(idx, { filter: e.currentTarget.value })} />
                    <TextInput placeholder="excludeFilter 正则（可选）" value={g.excludeFilter || ''} onChange={(e) => updateGroup(idx, { excludeFilter: e.currentTarget.value })} />
                  </Group>
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
      <Card style={{ opacity: groupsRulesIgnored ? 0.5 : 1, pointerEvents: groupsRulesIgnored ? 'none' : undefined }}>
        <CardHead right={<DimIcon><IFilter size={15} /></DimIcon>}>
          <StepNum n={3} />
          <Text fw={600}>分流规则</Text>
        </CardHead>
        <Text fz="sm" fw={500} mb={6}>
          分流预设（勾选自动加分组 + 规则）
        </Text>
        <Group gap={8} mb="sm">
          {RULE_PRESETS.map((p) => (
            <Chip key={p.key} checked={presetOn(p.rules)} onChange={() => togglePreset(p.key)} variant="light" size="sm">
              {p.label}
            </Chip>
          ))}
        </Group>
        <Text fz="sm" fw={500} mb={6}>
          规则列表（每行一条，末行一般 MATCH 兜底）
        </Text>
        <Textarea
          rows={8}
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

      <Modal opened={outputOpen} onClose={outputCtl.close} title="输出预览" size="xl" scrollAreaComponent={ScrollArea.Autosize}>
        <Code block style={{ maxHeight: '70vh', overflow: 'auto', fontSize: 12 }}>
          {output}
        </Code>
      </Modal>
    </Stack>
  )
}
