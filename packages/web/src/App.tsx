import {
  ActionIcon,
  Box,
  Button,
  Card,
  Group,
  PasswordInput,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api'
import { AgentDock } from './components/AgentDock'
import { LoadError, PageSkeleton } from './components/AsyncState'
import { Mcp } from './components/Mcp'
import { Profiles } from './components/Profiles'
import { Subscriptions } from './components/Subscriptions'
import { IBrand, IMoon, IPlus, ISparkles, ISun } from './icons'
import { readView, writeView, type View } from './navigation'
import type { Meta } from './types'

const TABS: { key: View; label: string; title: string; sub: string }[] = [
  { key: 'subs', label: '订阅', title: '订阅', sub: '添加机场订阅或手工节点，SubForge 会抓取并解析。' },
  { key: 'profiles', label: '配置', title: '配置', sub: '把订阅按你的规则转成可用配置，用分享链接分发。' },
  { key: 'mcp', label: 'MCP', title: 'MCP', sub: '管理外部 Agent 的远端连接与工具访问。' },
]

/** ProfileDetail 通过该事件通知「Agent 改动了当前配置」，抽屉与详情面板解耦。 */
export const AGENT_CHANGED_EVENT = 'subforge:agent-changed'

function ThemeToggle() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  return (
    <Tooltip label={dark ? '切换到浅色' : '切换到暗色'}>
      <ActionIcon variant="default" size={34} radius={7} onClick={toggleColorScheme} aria-label="切换主题">
        {dark ? <ISun size={15} /> : <IMoon size={15} />}
      </ActionIcon>
    </Tooltip>
  )
}

function Brand() {
  return (
    <Group gap={10} wrap="nowrap">
      <Box
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(124,58,237,.35)',
        }}
      >
        <IBrand size={15} />
      </Box>
      <Text fw={600} fz={15} className="brand-name" style={{ whiteSpace: 'nowrap' }}>
        Sub
        <Text span c="dimmed" fw={500}>
          Forge
        </Text>
      </Text>
    </Group>
  )
}

export function App() {
  const [tab, setTab] = useState<View>(() => readView(window.location.search))
  const [meta, setMeta] = useState<Meta | null>(null)
  const [metaStatus, setMetaStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [metaError, setMetaError] = useState('')
  const [needToken, setNeedToken] = useState(false)
  const [tokenInput, setTokenInput] = useState(getToken())
  const [agentOpen, setAgentOpen] = useState(false)
  const [subsAddOpen, setSubsAddOpen] = useState(false)
  // 配置页当前选中的档，用于 Agent 抽屉的上下文切换
  const [profileCtx, setProfileCtx] = useState<{ id: string; name: string } | null>(null)

  const loadMeta = () => {
    setMetaStatus('loading')
    setMetaError('')
    api
      .meta()
      .then((m) => {
        setMeta(m)
        setMetaStatus('success')
        setNeedToken(false)
      })
      .catch((e) => {
        if (String(e).includes('401')) {
          setNeedToken(true)
          setMetaStatus('error')
          return
        }
        setMetaError(String(e))
        setMetaStatus('error')
      })
  }
  useEffect(() => {
    loadMeta()
  }, [])
  useEffect(() => {
    const onPopState = () => setTab(readView(window.location.search))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const selectTab = (next: View) => {
    if (next !== tab) {
      const search = writeView(window.location.search, next)
      window.history.pushState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
      setTab(next)
    }
  }

  if (needToken) {
    return (
      <Box style={{ display: 'grid', placeItems: 'center', minHeight: '100svh' }}>
        <Card w={{ base: 'calc(100% - 32px)', xs: 400 }} padding="xl">
          <Brand />
          <Title order={3} mt="md">
            需要管理口令
          </Title>
          <Text c="dimmed" fz="sm" mt={4} mb="md">
            此实例设置了访问口令，输入后即可进入。
          </Text>
          <PasswordInput
            value={tokenInput}
            onChange={(e) => setTokenInput(e.currentTarget.value)}
            placeholder="ADMIN_TOKEN"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setToken(tokenInput)
                loadMeta()
              }
            }}
          />
          <Button
            fullWidth
            mt="md"
            onClick={() => {
              setToken(tokenInput)
              loadMeta()
            }}
          >
            进入
          </Button>
        </Card>
      </Box>
    )
  }

  const cur = TABS.find((t) => t.key === tab)!
  const pageTitle = tab === 'profiles' && profileCtx ? `配置 · ${profileCtx.name}` : cur.title
  const agentProfile = tab === 'profiles' ? profileCtx : null

  return (
    // 最小高度用 svh（小视口）而非 dvh：手机浏览器工具栏收起时 dvh 动态变大，
    // 会把不足一屏的页面撑出一段「能下滑的空白」。
    <Box style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏导航 */}
      <Box component="header" className="topbar">
        <Box className="topbar-brand">
          <Brand />
        </Box>
        <nav className="topbar-nav" aria-label="主导航">
          {TABS.map((t) => (
            <UnstyledButton
              key={t.key}
              component="a"
              className="topbar-tab"
              data-active={tab === t.key || undefined}
              aria-current={tab === t.key ? 'page' : undefined}
              href={`${window.location.pathname}${writeView(window.location.search, t.key)}${window.location.hash}`}
              onClick={(event: React.MouseEvent) => {
                event.preventDefault()
                selectTab(t.key)
              }}
            >
              {t.label}
            </UnstyledButton>
          ))}
        </nav>
        <Group gap={12} ml="auto" wrap="nowrap">
          <Text fz={12} c="dimmed" className="topbar-status">
            <Box
              component="span"
              mr={7}
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: meta?.hasAgent ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-gray-5)',
              }}
            />
            Agent {meta?.hasAgent ? '已就绪' : '未配置'}
            {meta ? ` · ${meta.renderers.join(' / ')}` : ''}
          </Text>
          <ThemeToggle />
          <Button
            variant={agentOpen ? 'filled' : 'light'}
            h={34}
            radius={7}
            px={16}
            className="agent-toggle"
            leftSection={<ISparkles size={14} />}
            onClick={() => setAgentOpen((v) => !v)}
            aria-pressed={agentOpen}
            aria-label={agentOpen ? '关闭 Agent 面板' : '打开 Agent 面板'}
          >
            <span className="agent-toggle-label">Agent</span>
          </Button>
        </Group>
      </Box>

      <Box style={{ display: 'flex', flex: 1, alignItems: 'stretch' }}>
        {/* 主内容列 */}
        <Box style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Group justify="space-between" align="flex-end" gap={16} px={28} pt={22} className="page-head">
            <Box>
              <Title order={1} fz={21} fw={600}>
                {pageTitle}
              </Title>
              <Text c="dimmed" fz={13.5} mt={2}>
                {cur.sub}
              </Text>
            </Box>
            {tab === 'subs' && (
              <Button h={36} radius={7} px={18} leftSection={<IPlus size={15} />} onClick={() => setSubsAddOpen(true)}>
                新增订阅
              </Button>
            )}
          </Group>

          <Box className="page-body">
            {metaStatus === 'loading' && <PageSkeleton />}
            {metaStatus === 'error' && <LoadError message={metaError || '无法读取实例信息。'} onRetry={loadMeta} />}
            {metaStatus === 'success' && meta && (
              <>
                {tab === 'subs' && <Subscriptions addOpened={subsAddOpen} onAddClose={() => setSubsAddOpen(false)} />}
                {tab === 'profiles' && (
                  <Profiles
                    dts={meta.scriptDts}
                    renderers={meta.renderers}
                    onSelectionChange={setProfileCtx}
                  />
                )}
                {tab === 'mcp' && <Mcp meta={meta.mcp} />}
              </>
            )}
          </Box>

          {/* 配置页吸底保存栏经 portal 渲染到这里 */}
          <div id="sf-save-slot" className="save-slot" />
        </Box>

        {/* Agent 面板：右侧可拖宽的停靠栏，可放大为居中弹窗 */}
        {agentOpen && (
          <AgentDock
            profile={agentProfile}
            hasAgent={!!meta?.hasAgent}
            onClose={() => setAgentOpen(false)}
            onChanged={() => window.dispatchEvent(new CustomEvent(AGENT_CHANGED_EVENT))}
          />
        )}
      </Box>
    </Box>
  )
}
