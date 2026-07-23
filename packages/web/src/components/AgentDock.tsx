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
/** 与 styles.css 里手机全屏那条断点保持一致（48em = 768px） */
const FULLSCREEN_QUERY = '(max-width: 48em)'

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
  // width 存的是「用户想要的宽度」，渲染时才按当前视口收窄。
  // 若直接把收窄结果写回 state，窗口变窄一次就再也回不去了。
  const [width, setWidth] = useState(readStoredWidth)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [maximized, setMaximized] = useState(false)
  const [resizing, setResizing] = useState(false)
  // 手机上面板本身就是全屏（CSS 负责），这里只是让 JS 侧知道，
  // 以便同样按「模态」对待：焦点陷阱、aria-modal、锁背景滚动。
  const [fullscreen, setFullscreen] = useState(() => window.matchMedia(FULLSCREEN_QUERY).matches)
  const handleRef = useRef<HTMLDivElement>(null)
  // 全屏与放大是同一件事的两种触发方式，对外统一按模态处理
  const asDialog = maximized || fullscreen
  const effectiveWidth = clampAgentWidth(width, viewport)

  const commitWidth = useCallback((next: number) => {
    const clamped = clampAgentWidth(next, window.innerWidth)
    setWidth(clamped)
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped))
    } catch {
      // 存不下就只在本次会话内生效
    }
  }, [])

  // 视口宽度与全屏断点一起同步。除了 matchMedia 的 change，也挂 resize：
  // 某些环境（含无头 / 设备模拟）改视口不一定派发 change，只靠它会漏。
  // 进入手机尺寸时清掉「放大」，避免两套弹窗样式打架。
  useEffect(() => {
    const mq = window.matchMedia(FULLSCREEN_QUERY)
    const sync = () => {
      setViewport(window.innerWidth)
      setFullscreen(mq.matches)
      if (mq.matches) setMaximized(false)
    }
    sync()
    window.addEventListener('resize', sync)
    mq.addEventListener('change', sync)
    return () => {
      window.removeEventListener('resize', sync)
      mq.removeEventListener('change', sync)
    }
  }, [])

  // Esc：放大态还原为停靠栏；手机全屏态直接关闭（没有可还原的中间形态）
  useEffect(() => {
    if (!asDialog) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (maximized) setMaximized(false)
      else onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [asDialog, maximized, onClose])

  // 拖拽期间锁住全局选中态与光标，防止选到页面文字
  useEffect(() => {
    if (!resizing) return
    document.documentElement.setAttribute('data-sf-resizing', '')
    return () => document.documentElement.removeAttribute('data-sf-resizing')
  }, [resizing])

  // 模态形态（放大 / 手机全屏）锁住背景滚动；补上滚动条宽度，避免锁的瞬间整页横向抖一下
  useEffect(() => {
    if (!asDialog) return
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
  }, [asDialog])

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? STEP_LARGE : STEP
    // 以当前实际宽度为基准增减，面板停靠在右侧：向左 = 变宽
    if (e.key === 'ArrowLeft') commitWidth(effectiveWidth + step)
    else if (e.key === 'ArrowRight') commitWidth(effectiveWidth - step)
    else if (e.key === 'Home') commitWidth(AGENT_MIN_WIDTH)
    else if (e.key === 'End') commitWidth(upperBound(viewport))
    else return
    e.preventDefault()
  }

  const contextLabel = profile ? `配置「${profile.name}」` : '全局'

  return (
    <>
      {maximized && (
        <Box className="agent-scrim" onClick={() => setMaximized(false)} aria-hidden="true" />
      )}
      <FocusTrap active={asDialog}>
        <Box
          component="aside"
          className="agent-drawer"
          data-maximized={maximized || undefined}
          data-resizing={resizing || undefined}
          style={{ '--sf-agent-width': `${effectiveWidth}px` } as React.CSSProperties}
          role={asDialog ? 'dialog' : undefined}
          aria-modal={asDialog || undefined}
          aria-label="Agent 对话"
        >
          {!asDialog && (
            <div
              ref={handleRef}
              className="agent-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整 Agent 面板宽度"
              aria-valuenow={effectiveWidth}
              aria-valuemin={AGENT_MIN_WIDTH}
              aria-valuemax={upperBound(viewport)}
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
