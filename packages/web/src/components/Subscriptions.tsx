import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtBytes, fmtExpire, usedBytes } from '../format'
import { IInbox, IPlus, IRefresh, IRss, ITrash } from '../icons'
import type { Subscription } from '../types'

export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [content, setContent] = useState('')
  const [err, setErr] = useState('')

  const load = () => api.listSubscriptions().then(setSubs).catch((e) => setErr(String(e)))
  useEffect(() => { load() }, [])

  const add = async () => {
    setErr('')
    try {
      await api.createSubscription({ name: name || '未命名', url: url || undefined, content: content || undefined })
      setName(''); setUrl(''); setContent(''); load()
    } catch (e) { setErr(String(e)) }
  }

  return (
    <div className="row">
      <div className="col">
        {subs.length === 0 ? (
          <div className="card"><div className="empty"><IInbox size={34} /><h4>还没有订阅</h4><div>在右侧粘贴订阅链接或节点，SubForge 会自动抓取解析。</div></div></div>
        ) : (
          <div className="card">
            <div className="card-head"><h3><IRss size={15} /> 我的订阅</h3><span className="badge">{subs.length}</span></div>
            {subs.map((s) => (
              <div key={s.id} className="item">
                <div style={{ minWidth: 0 }}>
                  <div className="item-title">{s.name}</div>
                  <div className="item-sub mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}>{s.url || '手工节点'}</div>
                  <div className="item-sub">{s.fetchedAt ? `更新于 ${new Date(s.fetchedAt).toLocaleString()}` : '未抓取'}</div>
                  {s.userInfo && (s.userInfo.total !== undefined || s.userInfo.expire) && (
                    <div className="hstack" style={{ marginTop: 6 }}>
                      {s.userInfo.total !== undefined && <span className="badge">{fmtBytes(usedBytes(s.userInfo))} / {fmtBytes(s.userInfo.total)}</span>}
                      {s.userInfo.expire && <span className="badge">到期 {fmtExpire(s.userInfo.expire)}</span>}
                    </div>
                  )}
                </div>
                <div className="hstack">
                  {s.url && <button className="sm ghost" onClick={() => api.refreshSubscription(s.id).then(load).catch((e) => setErr(String(e)))}><IRefresh size={14} /> 刷新</button>}
                  <button className="sm danger icon-btn" title="删除" onClick={() => api.deleteSubscription(s.id).then(load)}><ITrash size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ width: 360 }}>
        <div className="card">
          <div className="card-head"><h3><IPlus size={15} /> 新增订阅</h3></div>
          <div className="stack">
            <div className="field"><div className="lbl">名称</div><input placeholder="例如 机场A" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><div className="lbl">订阅链接</div><input placeholder="https://…（可留空）" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
            <div className="field"><div className="lbl">或粘贴节点</div><textarea placeholder="每行一个 vmess:// trojan:// … 或整段 base64 / Clash YAML" rows={5} value={content} onChange={(e) => setContent(e.target.value)} /></div>
            <button className="primary" style={{ justifyContent: 'center' }} onClick={add}><IPlus size={15} /> 添加订阅</button>
            {err && <div className="error">{err}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
