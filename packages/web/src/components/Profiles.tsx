import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Profile, Subscription } from '../types'
import { ScriptEditor } from './ScriptEditor'

export function Profiles({ dts }: { dts: string }) {
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
      <div style={{ width: 260 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>转换档</h3>
            <button className="primary" onClick={create}>
              + 新建
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            {profiles.map((p) => (
              <div
                key={p.id}
                className={`list-item ${sel?.id === p.id ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => api.getProfile(p.id).then(setSel)}
              >
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
          <ProfileDetail
            key={sel.id}
            profile={sel}
            subs={subs}
            dts={dts}
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
      </div>
    </div>
  )
}

function ProfileDetail({
  profile,
  subs,
  dts,
  onSaved,
  onDeleted,
}: {
  profile: Profile
  subs: Subscription[]
  dts: string
  onSaved: (p: Profile) => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [subIds, setSubIds] = useState<string[]>(profile.subscriptionIds)
  const [script, setScript] = useState(profile.script || '')
  const [configText, setConfigText] = useState(JSON.stringify(profile.profile, null, 2))
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [versions, setVersions] = useState<{ id: string; note?: string; createdAt: number }[]>([])

  const shareUrl = `${location.origin}/sub/${profile.token}`

  const save = async () => {
    setErr('')
    setMsg('')
    let parsedProfile
    try {
      parsedProfile = JSON.parse(configText)
    } catch (e) {
      setErr('组/规则 JSON 解析失败：' + String(e))
      return
    }
    try {
      const p = await api.updateProfile(profile.id, {
        name,
        subscriptionIds: subIds,
        script: script || undefined,
        profile: parsedProfile,
      })
      setMsg('已保存')
      onSaved(p)
    } catch (e) {
      setErr(String(e))
    }
  }

  const toggleSub = (id: string) =>
    setSubIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  return (
    <>
      <div className="card">
        <div className="grid2">
          <div>
            <div className="muted">名称</div>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <div className="muted">分享链接</div>
            <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="muted">关联订阅</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
            {subs.map((s) => (
              <label key={s.id} style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'auto' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={subIds.includes(s.id)}
                  onChange={() => toggleSub(s.id)}
                />
                {s.name}
              </label>
            ))}
            {subs.length === 0 && <span className="muted">先去「订阅」页添加订阅</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={save}>
            保存
          </button>
          <button onClick={() => api.output(profile.id).then((o) => alert(o.ok ? o.config?.slice(0, 4000) : o.error))}>
            查看输出
          </button>
          <button
            onClick={() =>
              api.versions(profile.id).then(setVersions)
            }
          >
            版本历史
          </button>
          <div className="spacer" />
          <button className="danger" onClick={() => api.deleteProfile(profile.id).then(onDeleted)}>
            删除
          </button>
        </div>
        {msg && <div className="muted" style={{ marginTop: 6 }}>{msg}</div>}
        {err && <div className="error" style={{ marginTop: 6 }}>{err}</div>}
        {versions.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {versions.map((v) => (
              <div key={v.id} className="list-item">
                <span className="muted">
                  {new Date(v.createdAt).toLocaleString()} — {v.note || '快照'}
                </span>
                <button onClick={() => api.rollback(profile.id, v.id).then(onSaved)}>回滚</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>转换脚本 + 实时预览</h3>
        <ScriptEditor profileId={profile.id} value={script} onChange={setScript} dts={dts} />
      </div>

      <div className="card">
        <h3>代理组 / 规则（JSON）</h3>
        <textarea rows={12} className="mono" value={configText} onChange={(e) => setConfigText(e.target.value)} />
        <div className="muted" style={{ marginTop: 4 }}>
          groups 支持 includeAll / filter（正则）/ excludeFilter；rules 为字符串数组。
        </div>
      </div>
    </>
  )
}
