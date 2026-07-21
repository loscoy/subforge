import { COMMON_GROUPS, RULE_PRESETS } from '@subforge/core'
import { useEffect, useState } from 'react'
import { api } from '../api'
import {
  IBot, ICode, IFilter, IGlobe, IHistory, ILayers, ILink, IPlay, IPlus, ISave, ISliders, ITemplate, ITrash, IZap,
} from '../icons'
import { builtinTemplates, serverToUI, type UITemplate } from '../templates'
import type { ConversionProfile, NodeOp, Profile, ProxyGroupDef, Subscription } from '../types'
import { AgentChatPanel } from './AgentChatPanel'
import { ScriptEditor } from './ScriptEditor'

export function Profiles({ dts, renderers, hasAgent }: { dts: string; renderers: string[]; hasAgent: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [sel, setSel] = useState<Profile | null>(null)

  const load = () => api.listProfiles().then(setProfiles)
  useEffect(() => { load(); api.listSubscriptions().then(setSubs) }, [])

  const create = async () => { const p = await api.createProfile({ name: '新转换档' }); await load(); setSel(p) }

  return (
    <div className="row">
      <div style={{ width: 220 }}>
        <div className="card">
          <div className="card-head"><h3><ILayers size={15} /> 转换档</h3><button className="sm primary icon-btn" title="新建" onClick={create}><IPlus size={14} /></button></div>
          {profiles.length === 0 && <div className="muted">还没有转换档，点右上「+」新建。</div>}
          {profiles.map((p) => (
            <div key={p.id} className={`item click ${sel?.id === p.id ? 'active' : ''}`} onClick={() => api.getProfile(p.id).then(setSel)}>
              <span className="item-title">{p.name}</span>
              <span className="badge">{p.target}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="col">
        {!sel ? (
          <div className="card"><div className="empty"><ILayers size={34} /><h4>选择或新建一个转换档</h4><div>转换档决定订阅怎么转成配置：套模板、勾选分流、或写脚本。</div></div></div>
        ) : (
          <ProfileDetail key={sel.id} profile={sel} subs={subs} dts={dts} renderers={renderers} hasAgent={hasAgent}
            onSaved={(p) => { setSel(p); load() }} onDeleted={() => { setSel(null); load() }} />
        )}
      </div>
    </div>
  )
}

interface OpForm { dedupe: boolean; tagRegions: boolean; sortByName: boolean; dropPattern: string; keepPattern: string; renameFrom: string; renameTo: string }
function parseOps(ops: NodeOp[] = []): OpForm {
  const f: OpForm = { dedupe: false, tagRegions: false, sortByName: false, dropPattern: '', keepPattern: '', renameFrom: '', renameTo: '' }
  for (const o of ops) {
    if (o.op === 'dedupe') f.dedupe = true
    else if (o.op === 'tagRegions') f.tagRegions = true
    else if (o.op === 'sortByName') f.sortByName = true
    else if (o.op === 'drop') f.dropPattern = o.pattern
    else if (o.op === 'keep') f.keepPattern = o.pattern
    else if (o.op === 'rename') { f.renameFrom = o.from; f.renameTo = o.to }
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

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
}

function ProfileDetail({ profile, subs, dts, renderers, hasAgent, onSaved, onDeleted }: {
  profile: Profile; subs: Subscription[]; dts: string; renderers: string[]; hasAgent: boolean
  onSaved: (p: Profile) => void; onDeleted: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [target, setTarget] = useState(profile.target)
  const [subIds, setSubIds] = useState<string[]>(profile.subscriptionIds)
  const [opForm, setOpForm] = useState<OpForm>(parseOps(profile.profile.operations))
  const [groups, setGroups] = useState<ProxyGroupDef[]>(profile.profile.groups || [])
  const [rules, setRules] = useState<string[]>(profile.profile.rules || [])
  const [script, setScript] = useState(profile.script || '')
  const [showScript, setShowScript] = useState(!!profile.script)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [versions, setVersions] = useState<{ id: string; note?: string; createdAt: number }[]>([])
  const [health, setHealth] = useState<{ alive: number; total: number; results: { name: string; latency: number | null }[] } | null>(null)
  const [testing, setTesting] = useState(false)
  const [templates, setTemplates] = useState<UITemplate[]>(builtinTemplates())
  const [showAgent, setShowAgent] = useState(false)

  const isOverride = /\bfunction\s+main\s*\(/.test(script)
  const scriptActive = !!script.trim()
  const groupsRulesIgnored = scriptActive && isOverride
  const shareUrl = `${location.origin}/sub/${profile.token}`
  const autoRegion = groups.some((g) => g.autoRegion)
  const setOp = (patch: Partial<OpForm>) => setOpForm((f) => ({ ...f, ...patch }))

  const reloadTemplates = () => api.listTemplates().then((l) => setTemplates([...builtinTemplates(), ...serverToUI(l)])).catch(() => {})
  useEffect(() => { reloadTemplates() }, [])

  const reloadFromServer = async () => {
    const p = await api.getProfile(profile.id)
    setName(p.name); setTarget(p.target); setSubIds(p.subscriptionIds)
    setOpForm(parseOps(p.profile.operations)); setGroups(p.profile.groups || []); setRules(p.profile.rules || [])
    setScript(p.script || ''); setShowScript(!!p.script); onSaved(p); setMsg('已根据 Agent 的改动刷新')
  }

  const save = async () => {
    setErr(''); setMsg('')
    const profileObj: ConversionProfile = { operations: buildOps(opForm), groups, rules, ruleProviders: profile.profile.ruleProviders }
    try {
      const p = await api.updateProfile(profile.id, { name, target, subscriptionIds: subIds, script: script || undefined, profile: profileObj })
      setMsg('已保存'); onSaved(p)
    } catch (e) { setErr(String(e)) }
  }

  const saveAsTemplate = async () => {
    const label = prompt('模板名称：', name + ' 模板')
    if (!label) return
    try {
      await api.createTemplate({ name: label, description: '（我的模板）', profile: { operations: buildOps(opForm), groups, rules }, script: script || undefined })
      await reloadTemplates(); setMsg(`已存为模板「${label}」`)
    } catch (e) { setErr(String(e)) }
  }

  const applyTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key)
    if (!t) return
    if (!confirm(`套用模板「${t.label}」会覆盖当前的节点处理/分组/规则/脚本，继续？`)) return
    setOpForm(parseOps(t.profile.operations)); setGroups(structuredClone(t.profile.groups)); setRules([...t.profile.rules])
    setScript(t.script || ''); setShowScript(!!t.script)
  }

  const toggleAutoRegion = () => autoRegion ? setGroups((gs) => gs.filter((g) => !g.autoRegion)) : setGroups((gs) => [...gs, { ...COMMON_GROUPS.regions }])
  const addCommon = (g: ProxyGroupDef) => { if (!groups.some((x) => x.name === g.name)) setGroups((gs) => [...gs, structuredClone(g)]) }
  const updateGroup = (i: number, patch: Partial<ProxyGroupDef>) => setGroups((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)))
  const delGroup = (i: number) => setGroups((gs) => gs.filter((_, idx) => idx !== i))

  const presetOn = (keys: string[]) => keys.every((r) => rules.includes(r))
  const togglePreset = (key: string) => {
    const p = RULE_PRESETS.find((x) => x.key === key)!
    if (presetOn(p.rules)) {
      setRules((rs) => rs.filter((r) => !p.rules.includes(r)))
      if (p.group) setGroups((gs) => gs.filter((g) => g.name !== p.group!.name))
    } else {
      setRules((rs) => { const at = rs.findIndex((r) => r.startsWith('MATCH')); const i = at < 0 ? rs.length : at; return [...rs.slice(0, i), ...p.rules, ...rs.slice(i)] })
      if (p.group && !groups.some((g) => g.name === p.group!.name)) setGroups((gs) => [...gs, structuredClone(p.group!)])
    }
  }
  const toggleSub = (id: string) => setSubIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  return (
    <>
      <div className="card">
        <div className="grid2">
          <div className="field"><div className="lbl">名称</div><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><div className="lbl">输出格式</div><select value={target} onChange={(e) => setTarget(e.target.value)}>{renderers.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
        </div>
        <div className="field" style={{ marginTop: 10 }}><div className="lbl"><ILink size={12} /> 分享链接（凭此订阅，无需口令）</div><input readOnly value={shareUrl} className="mono" onFocus={(e) => e.currentTarget.select()} /></div>
        <div className="field" style={{ marginTop: 10 }}>
          <div className="lbl">关联订阅</div>
          <div className="hstack">
            {subs.map((s) => <Check key={s.id} checked={subIds.includes(s.id)} onChange={() => toggleSub(s.id)}>{s.name}</Check>)}
            {subs.length === 0 && <span className="muted">先去「订阅」页添加订阅</span>}
          </div>
        </div>
        <div className="hstack" style={{ marginTop: 14 }}>
          <button className="primary" onClick={save}><ISave size={15} /> 保存</button>
          <select defaultValue="" onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); e.target.value = '' }} style={{ width: 'auto' }}>
            <option value="">从模板开始…</option>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.serverId ? '★ ' : ''}{t.label}</option>)}
          </select>
          <button className="ghost" onClick={saveAsTemplate}><ITemplate size={14} /> 存为模板</button>
          <button className="ghost" onClick={() => api.output(profile.id).then((o) => alert(o.ok ? o.config?.slice(0, 6000) : o.error))}><IPlay size={14} /> 查看输出</button>
          <button className="ghost" onClick={() => { setErr(''); api.versions(profile.id).then(setVersions).catch((e) => setErr(String(e))) }}><IHistory size={14} /> 版本</button>
          <button className="ghost" disabled={testing} onClick={() => { setErr(''); setHealth(null); setTesting(true); api.healthcheck(profile.id).then(setHealth).catch((e) => setErr(String(e).includes('501') ? '当前部署不支持测活（边缘运行时）' : String(e))).finally(() => setTesting(false)) }}><IZap size={14} /> {testing ? '测活中…' : '测活'}</button>
          <button className={showAgent ? 'primary' : 'ghost'} onClick={() => setShowAgent((v) => !v)}><IBot size={14} /> Agent</button>
          <div className="spacer" />
          <button className="danger icon-btn" title="删除转换档" onClick={() => api.deleteProfile(profile.id).then(onDeleted)}><ITrash size={15} /></button>
        </div>
        {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
        {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}

        {versions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="lbl">版本历史</div>
            {versions.map((v) => (
              <div key={v.id} className="item">
                <span className="item-sub">{new Date(v.createdAt).toLocaleString()} — {v.note || '快照'}</span>
                <button className="sm ghost" onClick={() => api.rollback(profile.id, v.id).then((p) => { setVersions([]); onSaved(p); setMsg('已回滚') }).catch((e) => setErr(String(e)))}>回滚</button>
              </div>
            ))}
          </div>
        )}
        {health && (
          <div style={{ marginTop: 12 }}>
            <div className="lbl">存活 {health.alive} / {health.total}（按延迟排序）</div>
            <div style={{ maxHeight: 160, overflow: 'auto' }}>
              {health.results.slice().sort((a, b) => (a.latency ?? 99999) - (b.latency ?? 99999)).map((r, i) => (
                <span className={`chip ${r.latency === null ? 'bad' : ''}`} key={i}>{r.name} · {r.latency === null ? '超时' : `${r.latency}ms`}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {showAgent && (
        <div className="card" style={{ borderColor: 'var(--accent-line)' }}>
          <div className="card-head"><h3><IBot size={15} /> Agent · 对话即改当前档</h3></div>
          <div className="muted" style={{ marginBottom: 8 }}>例：「香港节点单独分组、按延迟测速」「加一条 Netflix 分流」「把当前配置存成模板，叫 家用」「套用模板 家用」。改完自动刷新。</div>
          <AgentChatPanel threadId={`profile:${profile.id}`} hasAgent={hasAgent} onChanged={reloadFromServer} height={300}
            context={`用户正在编辑转换档：id=${profile.id}，name=「${name}」。除非明确指定其它档，所有 read/write/preview/validate/save_template/apply_template 操作都针对这个档（profileId=${profile.id}）。`} />
        </div>
      )}

      {groupsRulesIgnored && (
        <div className="card soft" style={{ borderColor: 'var(--accent-line)' }}>
          <div className="hstack"><span className="badge accent">override 模式</span></div>
          <div className="muted" style={{ marginTop: 6 }}>「代理组 / 规则」由脚本 <span className="mono">main(config)</span> 生成，此处忽略；但「节点处理」仍在脚本前生效，可共存。</div>
        </div>
      )}

      {/* ① 节点处理 */}
      <fieldset className="card">
        <div className="card-head"><h3><span className="step-num">1</span> 节点处理{groupsRulesIgnored && <span className="muted" style={{ fontWeight: 400 }}>· 脚本前生效</span>}</h3><ISliders size={15} className="muted" /></div>
        <div className="hstack" style={{ marginBottom: 10 }}>
          <Check checked={opForm.dedupe} onChange={(v) => setOp({ dedupe: v })}>去重</Check>
          <Check checked={opForm.tagRegions} onChange={(v) => setOp({ tagRegions: v })}>地区打标签</Check>
          <Check checked={opForm.sortByName} onChange={(v) => setOp({ sortByName: v })}>按名称排序</Check>
        </div>
        <div className="grid2">
          <div className="field"><div className="lbl">剔除节点（正则）</div><input placeholder="过期|剩余|官网|流量" value={opForm.dropPattern} onChange={(e) => setOp({ dropPattern: e.target.value })} /></div>
          <div className="field"><div className="lbl">只保留节点（正则）</div><input placeholder="留空 = 不限" value={opForm.keepPattern} onChange={(e) => setOp({ keepPattern: e.target.value })} /></div>
        </div>
        <div className="grid2" style={{ marginTop: 8 }}>
          <div className="field"><div className="lbl">重命名 · 匹配（正则）</div><input value={opForm.renameFrom} onChange={(e) => setOp({ renameFrom: e.target.value })} /></div>
          <div className="field"><div className="lbl">重命名 · 替换为</div><input value={opForm.renameTo} onChange={(e) => setOp({ renameTo: e.target.value })} /></div>
        </div>
      </fieldset>

      {/* ② 代理组 */}
      <fieldset className="card" disabled={groupsRulesIgnored} style={{ opacity: groupsRulesIgnored ? 0.45 : 1 }}>
        <div className="card-head"><h3><span className="step-num">2</span> 代理组</h3><IGlobe size={15} className="muted" /></div>
        <div className="hstack" style={{ marginBottom: 10 }}>
          <Check checked={autoRegion} onChange={toggleAutoRegion}>地区自动分组（按节点生成 HK/US/JP… 测速组）</Check>
          <div className="spacer" />
          <button className="sm ghost" onClick={() => addCommon(COMMON_GROUPS.select)}><IPlus size={13} /> 节点选择</button>
          <button className="sm ghost" onClick={() => addCommon(COMMON_GROUPS.autoSelect)}><IPlus size={13} /> 自动选择</button>
          <button className="sm ghost" onClick={() => setGroups((gs) => [...gs, { name: '新组', type: 'select', includeAll: true }])}><IPlus size={13} /> 空白组</button>
        </div>
        {groups.filter((g) => !g.autoRegion).map((g) => {
          const idx = groups.indexOf(g)
          return (
            <div key={idx} className="item" style={{ display: 'block' }}>
              <div className="hstack" style={{ flexWrap: 'nowrap' }}>
                <input style={{ flex: 2 }} value={g.name} onChange={(e) => updateGroup(idx, { name: e.target.value })} />
                <select style={{ flex: 1 }} value={g.type} onChange={(e) => updateGroup(idx, { type: e.target.value as ProxyGroupDef['type'] })}>{['select', 'url-test', 'fallback', 'load-balance'].map((t) => <option key={t}>{t}</option>)}</select>
                <Check checked={!!g.includeAll} onChange={(v) => updateGroup(idx, { includeAll: v })}>全部节点</Check>
                <button className="sm danger icon-btn" onClick={() => delGroup(idx)}><ITrash size={13} /></button>
              </div>
              <div className="grid2" style={{ marginTop: 6 }}>
                <input placeholder="filter 正则（可选）" value={g.filter || ''} onChange={(e) => updateGroup(idx, { filter: e.target.value })} />
                <input placeholder="excludeFilter 正则（可选）" value={g.excludeFilter || ''} onChange={(e) => updateGroup(idx, { excludeFilter: e.target.value })} />
              </div>
            </div>
          )
        })}
        {autoRegion && <div className="muted">✓ 地区组会在生成时按节点自动展开。</div>}
      </fieldset>

      {/* ③ 分流规则 */}
      <fieldset className="card" disabled={groupsRulesIgnored} style={{ opacity: groupsRulesIgnored ? 0.45 : 1 }}>
        <div className="card-head"><h3><span className="step-num">3</span> 分流规则</h3><IFilter size={15} className="muted" /></div>
        <div className="lbl">分流预设（勾选自动加分组 + 规则）</div>
        <div className="hstack" style={{ margin: '6px 0 12px' }}>
          {RULE_PRESETS.map((p) => <Check key={p.key} checked={presetOn(p.rules)} onChange={() => togglePreset(p.key)}>{p.label}</Check>)}
        </div>
        <div className="lbl">规则列表（每行一条，末行一般 MATCH 兜底）</div>
        <textarea className="mono" rows={8} value={rules.join('\n')} onChange={(e) => setRules(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />
      </fieldset>

      {/* ④ 脚本 */}
      <div className="card">
        <div className="card-head">
          <h3><span className="step-num">4</span> 自定义脚本{scriptActive && <span className="badge accent">{isOverride ? 'override' : 'transform'}</span>}</h3>
          <button className="sm ghost" onClick={() => setShowScript((v) => !v)}><ICode size={14} /> {showScript ? '收起' : '展开'}</button>
        </div>
        <div className="muted">留空则用上面的表单；写代码可完全自定义（<span className="mono">return nodes</span> 变换，或 <span className="mono">function main(config)</span> 覆写）。</div>
        {showScript && <div style={{ marginTop: 10 }}><ScriptEditor profileId={profile.id} value={script} onChange={setScript} dts={dts} /></div>}
      </div>
    </>
  )
}
