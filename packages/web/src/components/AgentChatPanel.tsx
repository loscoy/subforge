import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { ISend } from '../icons'
import type { AgentStep } from '../types'

interface ChatItem { role: 'user' | 'assistant' | 'step'; content: string }

const MUTATING = new Set(['write_config', 'write_script', 'apply_template', 'rollback_profile', 'save_template', 'delete_template', 'update_working_memory'])

/** 紧凑的 Agent 对话面板，可内嵌到编辑器。对话产生写操作后回调 onChanged。 */
export function AgentChatPanel({ threadId, context, hasAgent, onChanged, height = 320, placeholder }: {
  threadId: string
  context?: string
  hasAgent: boolean
  onChanged?: () => void
  height?: number
  placeholder?: string
}) {
  const fill = height === undefined
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.agentMessages(threadId).then((msgs) =>
      setItems(msgs.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))),
    ).catch(() => {})
  }, [threadId])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [items])

  const send = async () => {
    if (!input.trim() || busy) return
    const message = input.trim(); setInput(''); setErr('')
    setItems((c) => [...c, { role: 'user', content: message }]); setBusy(true)
    try {
      const reply = await api.agentChat(threadId, message, context)
      const steps: ChatItem[] = reply.steps.map((s: AgentStep) => ({ role: 'step', content: `🔧 ${s.tool}` }))
      setItems((c) => [...c, ...steps, { role: 'assistant', content: reply.text }])
      if (reply.steps.some((s) => MUTATING.has(s.tool))) onChanged?.()
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  if (!hasAgent) {
    return (
      <div className="muted">
        Agent 未启用。请给部署设置环境变量 <span className="mono">OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL</span> 后刷新。
      </div>
    )
  }

  return (
    <div className="chat" style={fill ? { height: '100%' } : { height }}>
      <div className="chat-log" ref={logRef}>
        {items.length === 0 && <div className="muted" style={{ padding: 8 }}>{placeholder || '对我说需求，例如「把香港节点单独分一组」「加一条 Netflix 分流」「把当前配置存成模板 家用」。'}</div>}
        {items.map((it, i) => <div key={i} className={`msg ${it.role}`}>{it.content}</div>)}
        {busy && <div className="msg assistant muted">思考中…</div>}
      </div>
      {err && <div className="error" style={{ padding: '4px 8px' }}>{err}</div>}
      <div className="chat-input">
        <textarea rows={2} placeholder="描述你想做的调整…（Enter 发送）" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button className="primary icon-btn" title="发送" onClick={send} disabled={busy}><ISend size={16} /></button>
      </div>
    </div>
  )
}
