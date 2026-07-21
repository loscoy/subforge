import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api'
import { Agent } from './components/Agent'
import { Profiles } from './components/Profiles'
import { Subscriptions } from './components/Subscriptions'
import { ILayers, IRss, ISparkles } from './icons'
import type { Meta } from './types'

type Tab = 'subs' | 'profiles' | 'agent'

const TABS: { key: Tab; label: string; title: string; sub: string; icon: typeof IRss }[] = [
  { key: 'subs', label: '订阅', title: '订阅', sub: '添加机场订阅或手工节点，SubForge 会抓取并解析。', icon: IRss },
  { key: 'profiles', label: '转换档', title: '转换档', sub: '把订阅按你的规则转成可用配置，用分享链接分发。', icon: ILayers },
  { key: 'agent', label: 'Agent', title: 'Agent', sub: '用对话调整配置、写脚本、管理模板。', icon: ISparkles },
]

export function App() {
  const [tab, setTab] = useState<Tab>('profiles')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [needToken, setNeedToken] = useState(false)
  const [tokenInput, setTokenInput] = useState(getToken())

  const loadMeta = () =>
    api.meta().then((m) => { setMeta(m); setNeedToken(false) })
      .catch((e) => { if (String(e).includes('401')) setNeedToken(true) })
  useEffect(() => { loadMeta() }, [])

  if (needToken) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="card" style={{ width: 400 }}>
          <div className="brand" style={{ padding: '0 0 14px' }}>
            <span className="brand-mark"><ILayers size={17} /></span>
            <span className="brand-name">Sub<span className="dim">Forge</span></span>
          </div>
          <h3>需要管理口令</h3>
          <p className="muted" style={{ margin: '4px 0 12px' }}>此实例设置了访问口令，输入后即可进入。</p>
          <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="ADMIN_TOKEN"
            onKeyDown={(e) => { if (e.key === 'Enter') { setToken(tokenInput); loadMeta() } }} />
          <button className="primary" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
            onClick={() => { setToken(tokenInput); loadMeta() }}>进入</button>
        </div>
      </div>
    )
  }

  const cur = TABS.find((t) => t.key === tab)!

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><ILayers size={17} /></span>
          <span className="brand-name">Sub<span className="dim">Forge</span></span>
        </div>
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button key={t.key} className={`nav-item ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              <Icon size={17} /> {t.label}
            </button>
          )
        })}
        <div className="sidebar-foot">
          <div className="status-line">
            <span className={`dot ${meta?.hasAgent ? 'on' : ''}`} />
            Agent {meta?.hasAgent ? '已就绪' : '未配置'}
          </div>
          <div className="status-line" style={{ marginTop: 6 }}>
            {meta ? `输出 · ${meta.renderers.join(' / ')}` : '连接中…'}
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="main-head">
          <h1>{cur.title}</h1>
          <span className="sub">{cur.sub}</span>
        </div>
        <div className="content">
          {tab === 'subs' && <Subscriptions />}
          {tab === 'profiles' && meta && <Profiles dts={meta.scriptDts} renderers={meta.renderers} hasAgent={!!meta.hasAgent} />}
          {tab === 'agent' && <Agent hasAgent={!!meta?.hasAgent} />}
        </div>
      </main>
    </div>
  )
}
