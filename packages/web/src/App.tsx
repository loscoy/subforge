import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api'
import { Agent } from './components/Agent'
import { Profiles } from './components/Profiles'
import { Subscriptions } from './components/Subscriptions'
import type { Meta } from './types'

type Tab = 'subs' | 'profiles' | 'agent'

export function App() {
  const [tab, setTab] = useState<Tab>('profiles')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [needToken, setNeedToken] = useState(false)
  const [tokenInput, setTokenInput] = useState(getToken())

  const loadMeta = () =>
    api
      .meta()
      .then((m) => {
        setMeta(m)
        setNeedToken(false)
      })
      .catch((e) => {
        if (String(e).includes('401')) setNeedToken(true)
      })

  useEffect(() => {
    loadMeta()
  }, [])

  if (needToken) {
    return (
      <div className="app">
        <div className="main">
          <div className="card" style={{ maxWidth: 420, margin: '80px auto' }}>
            <h3>需要管理口令</h3>
            <p className="muted">服务端设置了 ADMIN_TOKEN，请输入以继续。</p>
            <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="ADMIN_TOKEN" />
            <button
              className="primary"
              style={{ marginTop: 8 }}
              onClick={() => {
                setToken(tokenInput)
                loadMeta()
              }}
            >
              进入
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="logo">⚙️ SubForge</span>
        <div className="tabs">
          <button className={tab === 'subs' ? 'active' : ''} onClick={() => setTab('subs')}>
            订阅
          </button>
          <button className={tab === 'profiles' ? 'active' : ''} onClick={() => setTab('profiles')}>
            转换档
          </button>
          <button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}>
            Agent
          </button>
        </div>
        <div className="spacer" />
        <span className="muted">
          {meta ? `${meta.renderers.join(', ')} · Agent ${meta.hasAgent ? '已启用' : '未配置'}` : '连接中…'}
        </span>
      </div>
      <div className="main">
        {tab === 'subs' && <Subscriptions />}
        {tab === 'profiles' && meta && <Profiles dts={meta.scriptDts} renderers={meta.renderers} hasAgent={!!meta.hasAgent} />}
        {tab === 'agent' && <Agent hasAgent={!!meta?.hasAgent} />}
      </div>
    </div>
  )
}
