import { ActionIcon, Box, FocusTrap, Group, Text, Tooltip } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IMaximize, IMinimize, ISparkles, IX } from '../icons'
import { AgentChatPanel } from './AgentChatPanel'

const WIDTH_KEY = 'subforge-agent-width'
export const AGENT_MIN_WIDTH = 320
export const AGENT_MAX_WIDTH = 880
const AGENT_DEFAULT_WIDTH = 380
/** 键盘调整步长：普通 16px，按住 Shift 时 64px */
const STEP = 16
const STEP_LARGE = 64

/** 面板不能宽过视口的 72%，否则主内容区没法用了 */
function upperBound(viewport: number) {
  return Math.max(AGENT_MIN_WIDTH, Math.min(AGENT_MAX_WIDTH, Math.round(viewport * 0.72)))
}
export function clampAgentWidth(width: number, viewport: number) {
  return Math.min(upperBound(viewport), Math.max(AGENT_MIN_WIDTH, Math.round(width)))
}

function readStoredWidth() {
  try {
    const raw = Number(window.localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(raw) && raw > 0) return raw
  } catch {
    // 隐私模式下 localStorage 可能不可用，回落到默认宽度
  }
  return AGENT_DEFAULT_WIDTH
}

/**
 * Agent 面板容器：右侧可拖拽停靠栏 ↔ 页面中央弹窗。
 * 两种形态复用同一个 DOM 节点（切 data-maximized 而非换父容器），
 * 所以放大 / 还原不会重挂载 AgentChatPanel，流式输出与滚动位置都不丢。
 */
export function AgentDock({
  profile,
  hasAgent,
  onClose,
  onChanged,
}: {
  profile: { id: string; name: string } | null
  hasAgent: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [width, setWidth] = useState(() => clampAgentWidth(readStoredWidth(), window.innerWidth))
  const [maximized, setMaximized] = useState(false)
  const [resizing, setResizing] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)

  const commitWidth = useCallback((next: number) => {
    const clamped = clampAgentWidth(next, window.innerWidth)
    setWidth(clamped)
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped))
    } catch {
      // 存不下就只在本次会话内生效
    }
  }, [])

  // 视口变窄时同步收窄，避免面板把主内容挤没
  useEffect(() => {
    const onResize = () => setWidth((w) => clampAgentWidth(w, window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 弹窗形态下 Esc 还原为停靠栏（对话本身不关闭）
  useEffect(() => {
    if (!maximized) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMaximized(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [maximized])

  // 拖拽期间锁住全局选中态与光标，防止选到页面文字
  useEffect(() => {
    if (!resizing) return
    document.documentElement.setAttribute('data-sf-resizing', '')
    return () => document.documentElement.removeAttribute('data-sf-resizing')
  }, [resizing])

  // 弹窗形态锁住背景滚动；补上滚动条宽度，避免锁的瞬间整页横向抖一下
  useEffect(() => {
    if (!maximized) return
    const root = document.documentElement
    const gap = window.innerWidth - root.clientWidth
    const prevOverflow = root.style.overflow
    const prevPadding = root.style.paddingRight
    root.style.overflow = 'hidden'
    if (gap > 0) root.style.paddingRight = `${gap}px`
    return () => {
      root.style.overflow = prevOverflow
      root.style.paddingRight = prevPadding
    }
  }, [maximized])

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? STEP_LARGE : STEP
    // 面板停靠在右侧：向左拖 = 变宽
    if (e.key === 'ArrowLeft') commitWidth(width + step)
    else if (e.key === 'ArrowRight') commitWidth(width - step)
    else if (e.key === 'Home') commitWidth(AGENT_MIN_WIDTH)
    else if (e.key === 'End') commitWidth(upperBound(window.innerWidth))
    else return
    e.preventDefault()
  }

  const contextLabel = profile ? `配置「${profile.name}」` : '全局'

  return (
    <>
      {maximized && (
        <Box className="agent-scrim" onClick={() => setMaximized(false)} aria-hidden="true" />
      )}
      <FocusTrap active={maximized}>
        <Box
          component="aside"
          className="agent-drawer"
          data-maximized={maximized || undefined}
          data-resizing={resizing || undefined}
          style={{ '--sf-agent-width': `${width}px` } as React.CSSProperties}
          role={maximized ? 'dialog' : undefined}
          aria-modal={maximized || undefined}
          aria-label="Agent 对话"
        >
          {!maximized && (
            <div
              ref={handleRef}
              className="agent-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整 Agent 面板宽度"
              aria-valuenow={width}
              aria-valuemin={AGENT_MIN_WIDTH}
              aria-valuemax={upperBound(window.innerWidth)}
              tabIndex={0}
              onKeyDown={onHandleKeyDown}
              onDoubleClick={() => commitWidth(AGENT_DEFAULT_WIDTH)}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.currentTarget.setPointerCapture(e.pointerId)
                setResizing(true)
              }}
              onPointerMove={(e) => {
                if (!resizing) return
                commitWidth(window.innerWidth - e.clientX)
              }}
              onPointerUp={(e) => {
                if (!resizing) return
                e.currentTarget.releasePointerCapture(e.pointerId)
                setResizing(false)
              }}
              onPointerCancel={() => setResizing(false)}
            />
          )}

          <Group justify="space-between" align="flex-start" px={16} py={14} className="agent-drawer-head" wrap="nowrap">
            <Box style={{ minWidth: 0 }}>
              <Group gap={7} wrap="nowrap">
                <Box c="violet" style={{ display: 'flex' }}>
                  <ISparkles size={15} />
                </Box>
                <Text fw={600} fz={14}>
                  Agent
                </Text>
              </Group>
              <Text fz={12} c="dimmed" mt={2} truncate>
                上下文：{contextLabel}
              </Text>
            </Box>
            <Group gap={4} wrap="nowrap">
              <Tooltip label={maximized ? '还原为侧栏' : '放大为弹窗'}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={30}
                  radius={7}
                  className="agent-zoom"
                  onClick={() => setMaximized((v) => !v)}
                  aria-pressed={maximized}
                  aria-label={maximized ? '还原 Agent 面板' : '放大 Agent 面板'}
                >
                  {maximized ? <IMinimize size={15} /> : <IMaximize size={15} />}
                </ActionIcon>
              </Tooltip>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={30}
                radius={7}
                onClick={onClose}
                aria-label="关闭 Agent 面板"
              >
                <IX size={15} />
              </ActionIcon>
            </Group>
          </Group>

          <Box px={14} pb={12} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <AgentChatPanel
              key={profile ? `profile:${profile.id}` : 'global'}
              threadId={profile ? `profile:${profile.id}` : 'global'}
              hasAgent={hasAgent}
              onChanged={onChanged}
              context={
                profile
                  ? `用户正在编辑配置：id=${profile.id}，name=「${profile.name}」。除非明确指定其它档，所有 read/write/preview/validate/save_template/apply_template 操作都针对这个档（profileId=${profile.id}）。`
                  : undefined
              }
              placeholder="描述你想做的调整…"
            />
          </Box>
        </Box>
      </FocusTrap>
    </>
  )
}
