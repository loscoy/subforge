import { COMMON_GROUPS, RULE_PRESETS, TEMPLATES } from '@subforge/core'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { ConversionProfile, NodeOp, Profile, ProxyGroupDef, Subscription } from '../types'
import { ScriptEditor } from './ScriptEditor'

export function Profiles({ dts, renderers }: { dts: string; renderers: string[] }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [sel, setSel] = useState<Profile | null>(null)

  const load = () => api.listProfiles().then(setProfiles)
  useEffect(() => {
    load()
    api.listSubscriptions().then(setSubs)
  }, [])

  const create = async () => {
    const p = await api.createProfile({ name: '新转换档' })
    await load()
    setSel(p)
  }

  return (
    <div className="row">
      <div style={{ width: 240 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>转换档</h3>
            <button className="primary" onClick={create}>+ 新建</button>
          </div>
          <div style={{ marginTop: 10 }}>
            {profiles.map((p) => (
              <div key={p.id} className={`list-item ${sel?.id === p.id ? 'active' : ''}`} style={{ cursor: 'pointer' }}
                onClick={() => api.getProfile(p.id).then(setSel)}>
                <span>{p.name}</span>
                <span className="pill">{p.target}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="col">
        {!sel ? (
          <div className="card muted">选择或新建一个转换档。</div>
        ) : (
          <ProfileDetail key={sel.id} profile={sel} subs={subs} dts={dts} renderers={renderers}
            onSaved={(p) => { setSel(p); load() }}
            onDeleted={() => { setSel(null); load() }} />
        )}
      </div>
    </div>
  )
}

// ---- operations 表单 <-> NodeOp[] ----
interface OpForm {
  dedupe: boolean; tagRegions: boolean; sortByName: boolean
  dropPattern: string; keepPattern: string; renameFrom: string; renameTo: string
}
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

function ProfileDetail({ profile, subs, dts, renderers, onSaved, onDeleted }: {
  profile: Profile; subs: Subscription[]; dts: string; renderers: string[]
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

  const isOverride = /\bfunction\s+main\s*\(/.test(script)
  const scriptActive = !!script.trim()
  const shareUrl = `${location.origin}/sub/${profile.token}`
  const autoRegion = groups.some((g) => g.autoRegion)
  const setOp = (patch: Partial<OpForm>) => setOpForm((f) => ({ ...f, ...patch }))

  const save = async () => {
    setErr(''); setMsg('')
    const profileObj: ConversionProfile = {
      operations: buildOps(opForm), groups, rules,
      ruleProviders: profile.profile.ruleProviders,
    }
    try {
      const p = await api.updateProfile(profile.id, {
        name, target, subscriptionIds: subIds, script: script || undefined, profile: profileObj,
      })
      setMsg('已保存'); onSaved(p)
    } catch (e) { setErr(String(e)) }
  }

  const applyTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key)
    if (!t) return
    if (!confirm(`套用模板「${t.label}」会覆盖当前的节点处理/分组/规则，继续？`)) return
    setOpForm(parseOps(t.profile.operations))
    setGroups(structuredClone(t.profile.groups))
    setRules([...t.profile.rules])
    setScript('')
  }

  const toggleAutoRegion = () => {
    if (autoRegion) setGroups((gs) => gs.filter((g) => !g.autoRegion))
    else setGroups((gs) => [...gs, { ...COMMON_GROUPS.regions }])
  }
  const addCommon = (g: ProxyGroupDef) => {
    if (groups.some((x) => x.name === g.name)) return
    setGroups((gs) => [...gs, structuredClone(g)])
  }
  const updateGroup = (i: number, patch: Partial<ProxyGroupDef>) =>
    setGroups((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)))
  const delGroup = (i: number) => setGroups((gs) => gs.filter((_, idx) => idx !== i))

  const presetOn = (keys: string[]) => keys.every((r) => rules.includes(r))
  const togglePreset = (key: string) => {
    const p = RULE_PRESETS.find((x) => x.key === key)!
    const on = presetOn(p.rules)
    if (on) {
      setRules((rs) => rs.filter((r) => !p.rules.includes(r)))
      if (p.group) setGroups((gs) => gs.filter((g) => g.name !== p.group!.name))
    } else {
      // 预设规则插到 MATCH 之前
      setRules((rs) => {
        const matchIdx = rs.findIndex((r) => r.startsWith('MATCH'))
        const at = matchIdx < 0 ? rs.length : matchIdx
        return [...rs.slice(0, at), ...p.rules, ...rs.slice(at)]
      })
      if (p.group && !groups.some((g) => g.name === p.group!.name)) setGroups((gs) => [...gs, structuredClone(p.group!)])
    }
  }

  const toggleSub = (id: string) => setSubIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  return (
    <>
      {/* 基本信息 */}
      <div className="card">
        <div className="grid2">
          <div><div className="muted">名称</div><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><div className="muted">输出格式</div>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {renderers.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 8 }}><div className="muted">分享链接</div>
          <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} /></div>
        <div style={{ marginTop: 10 }}><div className="muted">关联订阅</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
            {subs.map((s) => (
              <label key={s.id} style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'auto' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={subIds.includes(s.id)} onChange={() => toggleSub(s.id)} />{s.name}
              </label>
            ))}
            {subs.length === 0 && <span className="muted">先去「订阅」页添加订阅</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="primary" onClick={save}>保存</button>
          <select defaultValue="" onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); e.target.value = '' }}
            title="从模板开始">
            <option value="">📋 从模板开始…</option>
            {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.description}</option>)}
          </select>
          <button onClick={() => api.output(profile.id).then((o) => alert(o.ok ? o.config?.slice(0, 6000) : o.error))}>查看输出</button>
          <button onClick={() => { setErr(''); api.versions(profile.id).then(setVersions).catch((e) => setErr(String(e))) }}>版本历史</button>
          <button disabled={testing} onClick={() => {
            setErr(''); setHealth(null); setTesting(true)
            api.healthcheck(profile.id).then(setHealth).catch((e) => setErr(String(e).includes('501') ? '当前部署不支持测活（边缘运行时）；请用 Node/Docker 部署' : String(e))).finally(() => setTesting(false))
          }}>{testing ? '测活中…' : '测活'}</button>
          <div className="spacer" />
          <button className="danger" onClick={() => api.deleteProfile(profile.id).then(onDeleted)}>删除</button>
        </div>
        {msg && <div className="muted" style={{ marginTop: 6 }}>{msg}</div>}
        {err && <div className="error" style={{ marginTop: 6 }}>{err}</div>}

        {versions.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="muted">版本历史（点回滚恢复到该快照）</div>
            {versions.map((v) => (
              <div key={v.id} className="list-item">
                <span className="muted">{new Date(v.createdAt).toLocaleString()} — {v.note || '快照'}</span>
                <button onClick={() => api.rollback(profile.id, v.id).then((p) => { setVersions([]); onSaved(p) }).catch((e) => setErr(String(e)))}>回滚</button>
              </div>
            ))}
          </div>
        )}
        {health && (
          <div style={{ marginTop: 10 }}>
            <div className="muted">存活 <b>{health.alive}</b> / {health.total}（按延迟排序）</div>
            <div style={{ maxHeight: 160, overflow: 'auto', marginTop: 4 }}>
              {health.results.slice().sort((a, b) => (a.latency ?? 99999) - (b.latency ?? 99999)).map((r, i) => (
                <span className="node-chip" key={i} style={{ color: r.latency === null ? 'var(--danger)' : undefined }}>
                  {r.name} · {r.latency === null ? '超时' : `${r.latency}ms`}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {scriptActive && isOverride && (
        <div className="card" style={{ borderColor: 'var(--accent2)' }}>
          <b style={{ color: 'var(--accent2)' }}>当前为 override 覆写脚本模式</b>
          <div className="muted" style={{ marginTop: 4 }}>
            下面的「节点处理 / 代理组 / 规则」将被<b>忽略</b>，一切以脚本 <span className="mono">main(config)</span> 的产出为准。
          </div>
        </div>
      )}

      {/* 节点处理 */}
      <fieldset className="card" disabled={scriptActive && isOverride} style={{ border: '1px solid var(--border)' }}>
        <h3>① 节点处理</h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
          <label style={{ width: 'auto', display: 'flex', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={opForm.dedupe} onChange={(e) => setOp({ dedupe: e.target.checked })} />去重</label>
          <label style={{ width: 'auto', display: 'flex', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={opForm.tagRegions} onChange={(e) => setOp({ tagRegions: e.target.checked })} />地区打标签</label>
          <label style={{ width: 'auto', display: 'flex', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={opForm.sortByName} onChange={(e) => setOp({ sortByName: e.target.checked })} />按名称排序</label>
        </div>
        <div className="grid2">
          <div><div className="muted">剔除节点（正则，匹配名字）</div><input placeholder="过期|剩余|官网|流量" value={opForm.dropPattern} onChange={(e) => setOp({ dropPattern: e.target.value })} /></div>
          <div><div className="muted">只保留节点（正则）</div><input placeholder="留空=不限" value={opForm.keepPattern} onChange={(e) => setOp({ keepPattern: e.target.value })} /></div>
        </div>
        <div className="grid2" style={{ marginTop: 8 }}>
          <div><div className="muted">重命名 · 匹配（正则）</div><input value={opForm.renameFrom} onChange={(e) => setOp({ renameFrom: e.target.value })} /></div>
          <div><div className="muted">重命名 · 替换为</div><input value={opForm.renameTo} onChange={(e) => setOp({ renameTo: e.target.value })} /></div>
        </div>
      </fieldset>

      {/* 代理组 */}
      <fieldset className="card" disabled={scriptActive && isOverride} style={{ border: '1px solid var(--border)' }}>
        <h3>② 代理组</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ width: 'auto', display: 'flex', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={autoRegion} onChange={toggleAutoRegion} /><b>地区自动分组</b>（按实际节点生成 HK/US/JP… 测速组）</label>
          <div className="spacer" />
          <button onClick={() => addCommon(COMMON_GROUPS.select)}>+ 节点选择</button>
          <button onClick={() => addCommon(COMMON_GROUPS.autoSelect)}>+ 自动选择</button>
          <button onClick={() => setGroups((gs) => [...gs, { name: '新组', type: 'select', includeAll: true }])}>+ 空白组</button>
        </div>
        {groups.filter((g) => !g.autoRegion).map((g, i) => {
          const realIdx = groups.indexOf(g)
          return (
            <div key={realIdx} className="list-item" style={{ display: 'block' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input style={{ flex: 2 }} value={g.name} onChange={(e) => updateGroup(realIdx, { name: e.target.value })} />
                <select style={{ flex: 1 }} value={g.type} onChange={(e) => updateGroup(realIdx, { type: e.target.value as ProxyGroupDef['type'] })}>
                  {['select', 'url-test', 'fallback', 'load-balance'].map((t) => <option key={t}>{t}</option>)}
                </select>
                <label style={{ width: 'auto', display: 'flex', gap: 4, whiteSpace: 'nowrap' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!g.includeAll} onChange={(e) => updateGroup(realIdx, { includeAll: e.target.checked })} />全部节点</label>
                <button className="danger" onClick={() => delGroup(realIdx)}>×</button>
              </div>
              <div className="grid2" style={{ marginTop: 6 }}>
                <input placeholder="filter 正则（可选）" value={g.filter || ''} onChange={(e) => updateGroup(realIdx, { filter: e.target.value })} />
                <input placeholder="excludeFilter 正则（可选）" value={g.excludeFilter || ''} onChange={(e) => updateGroup(realIdx, { excludeFilter: e.target.value })} />
              </div>
            </div>
          )
        })}
        {autoRegion && <div className="muted">✓ 地区组会在生成时按节点自动展开（此处不单独列出）。</div>}
      </fieldset>

      {/* 规则 */}
      <fieldset className="card" disabled={scriptActive && isOverride} style={{ border: '1px solid var(--border)' }}>
        <h3>③ 分流规则</h3>
        <div className="muted">分流预设（勾选自动加分组+规则）</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0 12px' }}>
          {RULE_PRESETS.map((p) => (
            <label key={p.key} className="pill" style={{ cursor: 'pointer', padding: '4px 10px' }}>
              <input type="checkbox" style={{ width: 'auto', marginRight: 4 }} checked={presetOn(p.rules)} onChange={() => togglePreset(p.key)} />{p.label}
            </label>
          ))}
        </div>
        <div className="muted">规则列表（每行一条，最后一般以 MATCH 兜底）</div>
        <textarea className="mono" rows={8} value={rules.join('\n')} onChange={(e) => setRules(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />
      </fieldset>

      {/* 高级：脚本 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>④ 高级：自定义脚本{scriptActive && <span className="pill" style={{ marginLeft: 8 }}>{isOverride ? 'override' : 'transform'}</span>}</h3>
          <button onClick={() => setShowScript((v) => !v)}>{showScript ? '收起' : '展开'}</button>
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          留空则用上面的表单配置；写代码可完全自定义（<span className="mono">return nodes</span> 变换，或 <span className="mono">function main(config)</span> 覆写）。
        </div>
        {showScript && (
          <div style={{ marginTop: 10 }}>
            <ScriptEditor profileId={profile.id} value={script} onChange={setScript} dts={dts} />
          </div>
        )}
      </div>
    </>
  )
}
