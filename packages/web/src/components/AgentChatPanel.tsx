import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { ISend } from '../icons'

interface ChatItem { role: 'user' | 'assistant'; content: string; tools?: string[] }

const MUTATING = new Set(['write_config', 'write_script', 'apply_template', 'rollback_profile', 'save_template', 'delete_template', 'update_working_memory'])

function Markdown({ text }: { text: string }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
}

/** 紧凑的 Agent 对话面板：流式输出 + 工具实时显示 + Markdown。对话产生写操作后回调 onChanged。 */
export function AgentChatPanel({ threadId, context, hasAgent, onChanged, height, placeholder }: {
  threadId: string
  context?: string
  hasAgent: boolean
  onChanged?: () => void
  height?: number
  placeholder?: string
}) {
  // 未传 height 即填充模式（用 flex 撑满父容器）。注意不能给 height 设默认值，
  // 否则默认参数会把显式传入的 undefined 变成默认数值，导致 fill 永远为 false。
  const fill = height == null
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // 当前进行中的一轮（流式）
  const [live, setLive] = useState<{ text: string; tools: string[] } | null>(null)
  const turn = useRef<{ text: string; tools: string[] }>({ text: '', tools: [] })
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.agentMessages(threadId).then((msgs) =>
      setItems(msgs.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))),
    ).catch(() => {})
  }, [threadId])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [items, live])

  const send = async () => {
    if (!input.trim() || busy) return
    const message = input.trim(); setInput(''); setErr('')
    setItems((c) => [...c, { role: 'user', content: message }])
    turn.current = { text: '', tools: [] }
    setLive({ text: '', tools: [] })
    setBusy(true)
    try {
      await api.agentStream(threadId, message, context, (ev) => {
        if (ev.type === 'text') { turn.current.text += ev.delta; setLive({ text: turn.current.text, tools: [...turn.current.tools] }) }
        else if (ev.type === 'tool-call') { turn.current.tools.push(ev.tool); setLive({ text: turn.current.text, tools: [...turn.current.tools] }) }
        else if (ev.type === 'error') { setErr(ev.error) }
        else if (ev.type === 'done') {
          const finalText = ev.text || turn.current.text
          const tools = [...turn.current.tools]
          setItems((c) => [...c, { role: 'assistant', content: finalText, tools }])
          setLive(null)
          if (tools.some((t) => MUTATING.has(t))) onChanged?.()
        }
      })
    } catch (e) { setErr(String(e)) } finally { setBusy(false); setLive(null) }
  }

  if (!hasAgent) {
    return (
      <div className="muted" style={{ padding: 8 }}>
        Agent 未启用。请给部署设置 <span className="mono">OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL</span> 后刷新。
      </div>
    )
  }

  const ToolRow = ({ tools, running }: { tools: string[]; running?: boolean }) =>
    tools.length ? (
      <div className="hstack" style={{ gap: 5, marginBottom: 4 }}>
        {tools.map((t, i) => <span key={i} className="tool-chip">{running && i === tools.length - 1 ? '⏳' : '✓'} {t}</span>)}
      </div>
    ) : null

  return (
    <div className={`chat${fill ? ' chat-fill' : ''}`} style={fill ? undefined : { height }}>
      <div className="chat-log" ref={logRef}>
        {items.length === 0 && !live && (
          <div className="muted" style={{ padding: 8 }}>{placeholder || '对我说需求，例如「把香港节点单独分一组」「加一条 Netflix 分流」「把当前配置存成模板 家用」。'}</div>
        )}
        {items.map((it, i) => (
          <div key={i} className={`turn ${it.role}`}>
            {it.role === 'assistant' && it.tools && <ToolRow tools={it.tools} />}
            <div className={`msg ${it.role}`}>{it.role === 'assistant' ? <Markdown text={it.content} /> : it.content}</div>
          </div>
        ))}
        {live && (
          <div className="turn assistant">
            <ToolRow tools={live.tools} running={busy} />
            {(live.text || !live.tools.length) && (
              <div className="msg assistant">
                {live.text ? <Markdown text={live.text} /> : <span className="muted">思考中…</span>}
                {live.text && busy && <span className="caret" />}
              </div>
            )}
          </div>
        )}
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
