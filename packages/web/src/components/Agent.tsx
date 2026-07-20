import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AgentStep } from '../types'

interface ChatItem {
  role: 'user' | 'assistant' | 'step'
  content: string
}

const THREAD = 'default'

export function Agent({ hasAgent }: { hasAgent: boolean }) {
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .agentMessages(THREAD)
      .then((msgs) =>
        setItems(msgs.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))),
      )
      .catch(() => {})
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [items])

  const send = async () => {
    if (!input.trim() || busy) return
    const message = input.trim()
    setInput('')
    setErr('')
    setItems((c) => [...c, { role: 'user', content: message }])
    setBusy(true)
    try {
      const reply = await api.agentChat(THREAD, message)
      const steps: ChatItem[] = reply.steps.map((s: AgentStep) => ({
        role: 'step',
        content: `🔧 ${s.tool}(${JSON.stringify(s.args)})`,
      }))
      setItems((c) => [...c, ...steps, { role: 'assistant', content: reply.text }])
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!hasAgent) {
    return (
      <div className="card muted">
        Agent 未启用。请在服务端设置环境变量 <span className="mono">OPENAI_BASE_URL</span> /{' '}
        <span className="mono">OPENAI_API_KEY</span> / <span className="mono">OPENAI_MODEL</span>（兼容 OpenAI 接口）后重启。
      </div>
    )
  }

  return (
    <div className="card chat" style={{ height: 'calc(100vh - 130px)' }}>
      <div className="chat-log" ref={logRef}>
        {items.length === 0 && (
          <div className="muted">
            示例：「帮我把香港节点单独分一组，命名 🇭🇰 香港，按延迟测速」「给转换档加一条 Netflix 分流规则」
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className={`msg ${it.role}`}>
            {it.content}
          </div>
        ))}
        {busy && <div className="msg assistant muted">思考中…</div>}
      </div>
      {err && <div className="error" style={{ padding: '0 8px' }}>{err}</div>}
      <div className="chat-input">
        <textarea
          rows={2}
          placeholder="描述你想让 agent 做什么…（Enter 发送，Shift+Enter 换行）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="primary" onClick={send} disabled={busy}>
          发送
        </button>
      </div>
    </div>
  )
}
