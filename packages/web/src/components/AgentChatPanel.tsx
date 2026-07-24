import { ActionIcon, Collapse, Group, Loader, Text, Textarea, UnstyledButton } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { IAlert, IBulb, ICheck, IChevron, ISend, IStop } from '../icons'
import type { AgentStep } from '../types'
import { LoadError, MessageSkeleton } from './AsyncState'

interface ChatItem {
  role: 'user' | 'assistant'
  content: string
  /** 0004 之前的历史消息只有工具名，没有参数/结果，展开也无内容可看 */
  tools?: string[]
  reasoning?: string
  steps?: AgentStep[]
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

/** 单段详情的展示上限：工具结果动辄几百个节点，整段 dump 会把面板拖垮 */
const MAX_DETAIL = 4000

function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function Detail({ label, value, tone }: { label: string; value: unknown; tone?: 'error' }) {
  const text = pretty(value)
  const clipped = text.length > MAX_DETAIL
  return (
    <div className="trace-detail">
      <div className="trace-detail-label">{label}</div>
      <pre className={`trace-detail-body mono${tone === 'error' ? ' is-error' : ''}`}>
        {clipped ? `${text.slice(0, MAX_DETAIL)}\n…（已截断，完整内容共 ${text.length} 字符）` : text}
      </pre>
    </div>
  )
}

/** 中间过程的统一表头：状态图标 + 标题 + 展开箭头。无详情时退化成不可点的一行。 */
function TraceRow({
  icon,
  title,
  hint,
  tone,
  expandable,
  open,
  onToggle,
  ariaLabel,
  children,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  hint?: string
  tone?: 'error'
  expandable: boolean
  open: boolean
  onToggle: () => void
  ariaLabel: string
  children?: React.ReactNode
}) {
  const head = (
    <>
      <span className="trace-icon">{icon}</span>
      <span className="trace-title">{title}</span>
      {hint && <span className="trace-hint">{hint}</span>}
      {expandable && (
        <span className="trace-chevron" data-open={open || undefined}>
          <IChevron size={12} />
        </span>
      )}
    </>
  )
  return (
    <div className="trace-item" data-tone={tone}>
      {expandable ? (
        <UnstyledButton className="trace-head" onClick={onToggle} aria-expanded={open} aria-label={ariaLabel}>
          {head}
        </UnstyledButton>
      ) : (
        <div className="trace-head is-static" aria-label={ariaLabel}>
          {head}
        </div>
      )}
      {expandable && <Collapse in={open}>{children}</Collapse>}
    </div>
  )
}

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming)
  // streaming=思考通道正在流：流式输出时自动展开跟看，流完自动收起；用户手动动过就不再自动改
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setOpen(streaming)
  }, [streaming])

  return (
    <TraceRow
      icon={<IBulb size={12} />}
      title="思考过程"
      hint={streaming ? '进行中…' : `${text.length} 字`}
      expandable
      open={open}
      onToggle={() => {
        touched.current = true
        setOpen((v) => !v)
      }}
      ariaLabel={`思考过程，${open ? '点击收起' : '点击展开'}`}
    >
      <div className="trace-body">
        <pre className="trace-detail-body is-reasoning">{text}</pre>
      </div>
    </TraceRow>
  )
}

function ToolBlock({ step, running }: { step: AgentStep; running: boolean }) {
  const [open, setOpen] = useState(false)
  const hasDetail = step.args !== undefined || step.result !== undefined || step.error !== undefined
  const status = running ? '运行中' : step.error ? '失败' : '已完成'

  return (
    <TraceRow
      icon={running ? <Loader size={11} /> : step.error ? <IAlert size={12} /> : <ICheck size={12} />}
      title={<span className="mono">{step.tool}</span>}
      hint={step.error ? '失败' : undefined}
      tone={step.error ? 'error' : undefined}
      expandable={hasDetail}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      ariaLabel={`工具 ${step.tool}，${status}${hasDetail ? `，${open ? '点击收起' : '点击展开详情'}` : ''}`}
    >
      <div className="trace-body">
        {step.args !== undefined && <Detail label="参数" value={step.args} />}
        {step.error !== undefined ? (
          <Detail label="错误" value={step.error} tone="error" />
        ) : (
          step.result !== undefined && <Detail label="结果" value={step.result} />
        )}
      </div>
    </TraceRow>
  )
}

/** 一轮里的思考 + 工具链。busy 表示这一轮还在跑（决定工具是否显示为运行中）。 */
function Trace({
  reasoning,
  steps,
  tools,
  busy,
  reasoningStreaming = false,
}: {
  reasoning?: string
  steps?: AgentStep[]
  tools?: string[]
  busy: boolean
  /** 思考通道是否正在流——只驱动思考块的自动展开/收起（历史消息恒为 false → 默认收起）。 */
  reasoningStreaming?: boolean
}) {
  // 老消息只存了工具名，补成没有详情的步骤，展示上与新消息一致（只是点不开）
  const list: AgentStep[] = steps?.length ? steps : (tools ?? []).map((tool) => ({ tool }))
  if (!reasoning && !list.length) return null
  return (
    <div className="trace">
      {/* 思考块：思考在流时自动展开，思考一停（正文/工具开始）自动收起；用户手动动过则不再自动改。
          用 reasoningStreaming 而非整轮 busy——否则思考会一直摊开到本轮结束。 */}
      {reasoning && <ReasoningBlock text={reasoning} streaming={reasoningStreaming} />}
      {list.map((step, i) => (
        <ToolBlock
          key={step.id ?? `${step.tool}-${i}`}
          step={step}
          running={busy && step.result === undefined && step.error === undefined}
        />
      ))}
    </div>
  )
}

interface LiveTurn {
  text: string
  reasoning: string
  /** 当前是否正在流式吐「思考」通道（reasoning delta 到来时为 true，正文/工具开始时转 false）。
   *  用它驱动思考块「在流时展开、流完收起」，而不是拿整轮 busy——否则思考会一直摊开到本轮结束。 */
  reasoningActive: boolean
  steps: AgentStep[]
}

/** 紧凑的 Agent 对话面板：流式输出 + 思考/工具可展开 + Markdown。对话产生写操作后回调 onChanged。 */
export function AgentChatPanel({
  sessionId,
  ensureSession,
  onActivity,
  context,
  hasAgent,
  onChanged,
  height,
  placeholder,
}: {
  /** 当前会话 id；null = 草稿态（尚未落库），发首条消息时经 ensureSession 建会话。 */
  sessionId: string | null
  /** 草稿态首次发送时调用：建会话并返回其 id。由 AgentDock 实现（POST + 更新列表）。 */
  ensureSession: (firstMessage: string) => Promise<string>
  /** 每轮发送后回调实际 threadId，供外层把该会话顶到列表最前。 */
  onActivity?: (id: string) => void
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
  const [live, setLive] = useState<LiveTurn | null>(null)
  const turn = useRef<LiveTurn>({ text: '', reasoning: '', reasoningActive: false, steps: [] })
  const logRef = useRef<HTMLDivElement>(null)
  // 是否「贴底」：仅当用户已在底部附近时才随新内容自动滚动，避免打断用户上翻查看历史
  const stick = useRef(true)
  const historyRequest = useRef(0)
  // 实际用于流式的 threadId：初始等于 sessionId；草稿态为 null，发首条消息时被 ensureSession 填上。
  // 用 ref 而非 state——草稿→会话的解析发生在 send() 里，不该触发历史重载（本轮消息已在内存）。
  const threadIdRef = useRef<string | null>(sessionId)
  // 本轮流式的中止句柄；点「停止」时 abort。null 表示当前没有进行中的请求。
  const abortRef = useRef<AbortController | null>(null)

  const loadHistory = async (id: string) => {
    const requestId = ++historyRequest.current
    setItems([])
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const messages = await api.agentMessages(id)
      if (requestId !== historyRequest.current) return
      setItems(
        messages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: message.content,
            tools: message.tools,
            reasoning: message.trace?.reasoning,
            steps: message.trace?.steps,
          })),
      )
    } catch (e) {
      if (requestId === historyRequest.current) setHistoryError(String(e))
    } finally {
      if (requestId === historyRequest.current) setHistoryLoading(false)
    }
  }
  useEffect(() => {
    threadIdRef.current = sessionId
    if (sessionId == null) {
      // 草稿态：没有历史可拉，直接进入空态（显示 placeholder）
      historyRequest.current += 1
      setItems([])
      setHistoryError('')
      setHistoryLoading(false)
      return
    }
    void loadHistory(sessionId)
    return () => {
      historyRequest.current += 1
    }
  }, [sessionId])
  useEffect(() => {
    if (stick.current) logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [items, live])

  const send = async () => {
    if (!input.trim() || busy) return
    const message = input.trim()
    setInput('')
    setErr('')
    setBusy(true)
    // 草稿态：先建会话拿到 threadId 再开聊（起标题会阻塞一下，是刻意为之——
    // 标题定下来再返回，列表里不会先冒一个临时名再跳变）。失败则把消息还回输入框。
    let tid = threadIdRef.current
    if (tid == null) {
      try {
        tid = await ensureSession(message)
        threadIdRef.current = tid
      } catch (e) {
        setErr(`创建会话失败：${e instanceof Error ? e.message : String(e)}`)
        setInput(message)
        setBusy(false)
        return
      }
    }
    onActivity?.(tid)
    stick.current = true // 发送后回到底部跟随本轮输出
    setItems((c) => [...c, { role: 'user', content: message }])
    turn.current = { text: '', reasoning: '', reasoningActive: false, steps: [] }
    const flush = () => setLive({ ...turn.current, steps: [...turn.current.steps] })
    flush()
    const controller = new AbortController()
    abortRef.current = controller
    // 把本轮已流式产出的内容定格成一条 assistant 消息。正常收到 done、以及
    // 中途停止 / 异常结束都会走到这；committed 去重，避免重复插入。
    let committed = false
    const commit = () => {
      if (committed) return
      committed = true
      const finished = turn.current
      const steps = [...finished.steps]
      if (!finished.text && steps.length === 0) return // 什么都没来就不留空气泡
      setItems((c) => [
        ...c,
        {
          role: 'assistant',
          content: finished.text,
          tools: steps.map((s) => s.tool),
          reasoning: finished.reasoning || undefined,
          steps,
        },
      ])
      if (steps.some((s) => MUTATING.has(s.tool))) onChanged?.()
    }
    try {
      await api.agentStream(
        tid,
        message,
        context,
        (ev) => {
          if (ev.type === 'text') {
            turn.current.text += ev.delta
            turn.current.reasoningActive = false // 正文开始 → 思考视为结束，收起
            flush()
          } else if (ev.type === 'reasoning') {
            turn.current.reasoning += ev.delta
            turn.current.reasoningActive = true // 思考正在流 → 展开
            flush()
          } else if (ev.type === 'tool-call') {
            turn.current.steps.push({ id: ev.id, tool: ev.tool, args: ev.args })
            turn.current.reasoningActive = false // 转去调工具 → 思考暂停，收起（若之后又吐思考会再展开）
            flush()
          } else if (ev.type === 'tool-result') {
            const step = turn.current.steps.find((s) => s.id === ev.id)
            if (step) {
              // 用 null 而不是留 undefined：undefined 是「还没跑完」的标记
              if (ev.error !== undefined) step.error = ev.error
              else step.result = ev.result ?? null
            }
            flush()
          } else if (ev.type === 'error') {
            setErr(ev.error)
          } else if (ev.type === 'done') {
            if (ev.text) turn.current.text = ev.text // done 带的最终文本更准，覆盖累积
            commit()
            setLive(null)
          }
        },
        controller.signal,
      )
    } catch (e) {
      // 用户主动停止不算错误，保留已产出的部分即可
      if (!controller.signal.aborted) setErr(String(e))
    } finally {
      commit() // 中途停止 / 异常结束时把已流式的部分定格
      abortRef.current = null
      setBusy(false)
      setLive(null)
    }
  }

  /** 停止当前进行中的一轮：中止请求（服务端也会随连接断开停下生成）。 */
  const stop = () => abortRef.current?.abort()

  if (!hasAgent) {
    return (
      <Text c="dimmed" fz="sm" p="xs">
        Agent 未启用。请到「设置」页填模型的 Base URL / API Key / 模型名。
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
          <LoadError message={historyError} onRetry={() => sessionId && void loadHistory(sessionId)} />
        ) : items.length === 0 && !live ? (
          <Text c="dimmed" fz="sm" p="xs">
            {placeholder || '对我说需求，例如「把香港节点单独分一组」「加一条 Netflix 分流」「把当前配置存成模板 家用」。'}
          </Text>
        ) : null}
        {items.map((it, i) => (
          <div key={i} className={`turn ${it.role}`}>
            {it.role === 'assistant' && (
              <Trace reasoning={it.reasoning} steps={it.steps} tools={it.tools} busy={false} />
            )}
            <div className={`msg ${it.role}`}>
              {it.role === 'assistant' ? <Markdown text={it.content} /> : it.content}
            </div>
          </div>
        ))}
        {live && (
          <div className="turn assistant">
            <Trace
              reasoning={live.reasoning}
              steps={live.steps}
              busy={busy}
              reasoningStreaming={busy && live.reasoningActive}
            />
            {(live.text || !live.steps.length) && (
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
      <Group className="chat-composer" gap={8} pt={10} mt={8} align="flex-end">
        <Textarea
          style={{ flex: 1 }}
          autosize
          minRows={1}
          maxRows={5}
          placeholder="描述你想做的调整…（Enter 发送）"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            // 输入法组词时的回车是「确认候选词」，不能当发送。isComposing 覆盖现代浏览器；
            // keyCode===229 兜底部分输入法在组字期间 isComposing 仍为 false 的情况。
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <ActionIcon
          size={40}
          radius="md"
          color={busy ? 'red' : undefined}
          onClick={() => (busy ? stop() : void send())}
          aria-label={busy ? '停止生成' : '发送'}
        >
          {busy ? <IStop size={15} /> : <ISend size={16} />}
        </ActionIcon>
      </Group>
    </div>
  )
}
