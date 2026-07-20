import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtBytes, fmtExpire, usedBytes } from '../format'
import type { Subscription } from '../types'

export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [content, setContent] = useState('')
  const [err, setErr] = useState('')

  const load = () => api.listSubscriptions().then(setSubs).catch((e) => setErr(String(e)))
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    setErr('')
    try {
      await api.createSubscription({ name: name || '未命名', url: url || undefined, content: content || undefined })
      setName('')
      setUrl('')
      setContent('')
      load()
    } catch (e) {
      setErr(String(e))
    }
  }

  return (
    <div className="row">
      <div className="col">
        <div className="card">
          <h3>订阅列表</h3>
          {subs.length === 0 && <div className="muted">还没有订阅，右侧添加一个。</div>}
          {subs.map((s) => (
            <div key={s.id} className="list-item">
              <div>
                <div>{s.name}</div>
                <div className="muted mono">{s.url || '（手工节点）'}</div>
                <div className="muted">
                  {s.fetchedAt ? `更新于 ${new Date(s.fetchedAt).toLocaleString()}` : '未抓取'}
                </div>
                {s.userInfo && (s.userInfo.total !== undefined || s.userInfo.expire) && (
                  <div className="muted">
                    {s.userInfo.total !== undefined && (
                      <span className="pill" style={{ marginRight: 6 }}>
                        流量 {fmtBytes(usedBytes(s.userInfo))} / {fmtBytes(s.userInfo.total)}
                      </span>
                    )}
                    {s.userInfo.expire && <span className="pill">到期 {fmtExpire(s.userInfo.expire)}</span>}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.url && (
                  <button onClick={() => api.refreshSubscription(s.id).then(load).catch((e) => setErr(String(e)))}>
                    刷新
                  </button>
                )}
                <button className="danger" onClick={() => api.deleteSubscription(s.id).then(load)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col">
        <div className="card">
          <h3>新增订阅</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="订阅 URL（可留空）" value={url} onChange={(e) => setUrl(e.target.value)} />
            <textarea
              placeholder="或粘贴节点（每行一个 URI / 或整段 base64）"
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <button className="primary" onClick={add}>
              添加
            </button>
            {err && <div className="error">{err}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
