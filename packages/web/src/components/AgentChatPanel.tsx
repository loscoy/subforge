import { ActionIcon, Group, Loader, Text, Textarea } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { ICheck, ISend } from '../icons'
import { LoadError, MessageSkeleton } from './AsyncState'

interface ChatItem {
  role: 'user' | 'assistant'
  content: string
  tools?: string[]
}

const MUTATING = new Set([
  'write_config',
  'write_script',
  'apply_template',
  'rollback_profile',
  'save_template',
  'delete_template',
  'update_working_memory',
])

function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

const ToolRow = ({ tools, running }: { tools: string[]; running?: boolean }) =>
  tools.length ? (
    <Group gap={5} mb={4}>
      {tools.map((t, i) => (
        <span key={i} className="tool-chip">
          {running && i === tools.length - 1 ? <Loader size={10} aria-hidden="true" /> : <ICheck size={11} />}
          <span>{t}</span>
          <span className="visually-hidden">{running && i === tools.length - 1 ? '运行中' : '已完成'}</span>
        </span>
      ))}
    </Group>
  ) : null

/** 紧凑的 Agent 对话面板：流式输出 + 工具实时显示 + Markdown。对话产生写操作后回调 onChanged。 */
export function AgentChatPanel({
  threadId,
  context,
  hasAgent,
  onChanged,
  height,
  placeholder,
}: {
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
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  // 当前进行中的一轮（流式）
  const [live, setLive] = useState<{ text: string; tools: string[] } | null>(null)
  const turn = useRef<{ text: string; tools: string[] }>({ text: '', tools: [] })
  const logRef = useRef<HTMLDivElement>(null)
  // 是否「贴底」：仅当用户已在底部附近时才随新内容自动滚动，避免打断用户上翻查看历史
  const stick = useRef(true)
  const historyRequest = useRef(0)

  const loadHistory = async () => {
    const requestId = ++historyRequest.current
    setItems([])
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const messages = await api.agentMessages(threadId)
      if (requestId !== historyRequest.current) return
      setItems(
        messages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: message.content,
            tools: message.tools,
          })),
      )
    } catch (e) {
      if (requestId === historyRequest.current) setHistoryError(String(e))
    } finally {
      if (requestId === historyRequest.current) setHistoryLoading(false)
    }
  }
  useEffect(() => {
    void loadHistory()
    return () => {
      historyRequest.current += 1
    }
  }, [threadId])
  useEffect(() => {
    if (stick.current) logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [items, live])

  const send = async () => {
    if (!input.trim() || busy) return
    const message = input.trim()
    setInput('')
    setErr('')
    stick.current = true // 发送后回到底部跟随本轮输出
    setItems((c) => [...c, { role: 'user', content: message }])
    turn.current = { text: '', tools: [] }
    setLive({ text: '', tools: [] })
    setBusy(true)
    try {
      await api.agentStream(threadId, message, context, (ev) => {
        if (ev.type === 'text') {
          turn.current.text += ev.delta
          setLive({ text: turn.current.text, tools: [...turn.current.tools] })
        } else if (ev.type === 'tool-call') {
          turn.current.tools.push(ev.tool)
          setLive({ text: turn.current.text, tools: [...turn.current.tools] })
        } else if (ev.type === 'error') {
          setErr(ev.error)
        } else if (ev.type === 'done') {
          const finalText = ev.text || turn.current.text
          const tools = [...turn.current.tools]
          setItems((c) => [...c, { role: 'assistant', content: finalText, tools }])
          setLive(null)
          if (tools.some((t) => MUTATING.has(t))) onChanged?.()
        }
      })
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
      setLive(null)
    }
  }

  if (!hasAgent) {
    return (
      <Text c="dimmed" fz="sm" p="xs">
        Agent 未启用。请给部署设置 <span className="mono">OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL</span> 后刷新。
      </Text>
    )
  }

  return (
    <div className={`chat${fill ? ' chat-fill' : ''}`} style={fill ? undefined : { height }}>
      <div
        className="chat-log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {historyLoading ? (
          <MessageSkeleton />
        ) : historyError ? (
          <LoadError message={historyError} onRetry={() => void loadHistory()} />
        ) : items.length === 0 && !live ? (
          <Text c="dimmed" fz="sm" p="xs">
            {placeholder || '对我说需求，例如「把香港节点单独分一组」「加一条 Netflix 分流」「把当前配置存成模板 家用」。'}
          </Text>
        ) : null}
        {items.map((it, i) => (
          <div key={i} className={`turn ${it.role}`}>
            {it.role === 'assistant' && it.tools && <ToolRow tools={it.tools} />}
            <div className={`msg ${it.role}`}>
              {it.role === 'assistant' ? <Markdown text={it.content} /> : it.content}
            </div>
          </div>
        ))}
        {live && (
          <div className="turn assistant">
            <ToolRow tools={live.tools} running={busy} />
            {(live.text || !live.tools.length) && (
              <div className="msg assistant">
                {live.text ? <Markdown text={live.text} /> : <Text span c="dimmed">思考中…</Text>}
                {live.text && busy && <span className="caret" />}
              </div>
            )}
          </div>
        )}
      </div>
      {err && (
        <Text c="red" fz="sm" px="xs" py={4}>
          {err}
        </Text>
      )}
      <Group gap={8} pt={10} mt={8} align="flex-end" style={{ borderTop: '1px solid var(--sf-border-subtle)' }}>
        <Textarea
          style={{ flex: 1 }}
          autosize
          minRows={1}
          maxRows={5}
          placeholder="描述你想做的调整…（Enter 发送）"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <ActionIcon size={40} radius="md" onClick={() => void send()} loading={busy} aria-label="发送">
          <ISend size={16} />
        </ActionIcon>
      </Group>
    </div>
  )
}
