import {
  ActionIcon,
  AppShell,
  Box,
  Burger,
  Button,
  Card,
  Group,
  NavLink,
  PasswordInput,
  Stack,
  Text,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api'
import { Agent } from './components/Agent'
import { LoadError, PageSkeleton } from './components/AsyncState'
import { Mcp } from './components/Mcp'
import { Profiles } from './components/Profiles'
import { Subscriptions } from './components/Subscriptions'
import { IBrand, ILayers, IMoon, IPlug, IRss, ISparkles, ISun } from './icons'
import { readView, writeView, type View } from './navigation'
import type { Meta } from './types'

const TABS: { key: View; label: string; title: string; sub: string; icon: typeof IRss }[] = [
  { key: 'subs', label: '订阅', title: '订阅', sub: '添加机场订阅或手工节点，SubForge 会抓取并解析。', icon: IRss },
  { key: 'profiles', label: '配置', title: '配置', sub: '把订阅按你的规则转成可用配置，用分享链接分发。', icon: ILayers },
  { key: 'agent', label: 'Agent', title: 'Agent', sub: '用对话调整配置、写脚本、管理模板。', icon: ISparkles },
  { key: 'mcp', label: 'MCP', title: 'MCP', sub: '管理外部 Agent 的远端连接与工具访问。', icon: IPlug },
]

function ThemeToggle() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const dark = colorScheme === 'dark'
  return (
    <Tooltip label={dark ? '切换到浅色' : '切换到暗色'} position="right">
      <ActionIcon variant="default" size="lg" radius="md" onClick={toggleColorScheme} aria-label="切换主题">
        {dark ? <ISun size={17} /> : <IMoon size={17} />}
      </ActionIcon>
    </Tooltip>
  )
}

function Brand() {
  return (
    <Group gap={10} px={6} py={4}>
      <Box
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(124,58,237,.35)',
        }}
      >
        <IBrand size={17} />
      </Box>
      <Text fw={600} fz={15.5}>
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
  const [navOpened, setNavOpened] = useState(false)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [metaStatus, setMetaStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [metaError, setMetaError] = useState('')
  const [needToken, setNeedToken] = useState(false)
  const [tokenInput, setTokenInput] = useState(getToken())

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
    setNavOpened(false)
  }

  if (needToken) {
    return (
      <Box style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
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

  return (
    <AppShell
      header={{ height: { base: 56, sm: 0 } }}
      navbar={{ width: 236, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding={0}
    >
      <AppShell.Header hiddenFrom="sm" style={{ borderColor: 'var(--sf-border-subtle)' }}>
        <Group h="100%" px="md" gap="sm">
          <Burger opened={navOpened} onClick={() => setNavOpened((value) => !value)} size="sm" aria-label="切换导航" />
          <Brand />
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm" style={{ borderColor: 'var(--sf-border-subtle)' }}>
        <Box visibleFrom="sm">
          <Brand />
        </Box>
        <Stack gap={2} mt="xs">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <NavLink
                key={t.key}
                active={tab === t.key}
                label={t.label}
                leftSection={<Icon size={17} />}
                href={`${window.location.pathname}${writeView(window.location.search, t.key)}${window.location.hash}`}
                onClick={(event) => {
                  event.preventDefault()
                  selectTab(t.key)
                }}
                variant="light"
                style={{ borderRadius: 7, fontWeight: 500 }}
              />
            )
          })}
        </Stack>
        <Box mt="auto" pt="sm" style={{ borderTop: '1px solid var(--sf-border-subtle)' }}>
          <Group justify="space-between" align="center" wrap="nowrap">
            <Stack gap={4}>
              <Text fz={12} c="dimmed">
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
              </Text>
              <Text fz={12} c="dimmed">
                {meta ? `输出 · ${meta.renderers.join(' / ')}` : '连接中…'}
              </Text>
            </Stack>
            <ThemeToggle />
          </Group>
        </Box>
      </AppShell.Navbar>

      <AppShell.Main id="main-content">
        <Box px={{ base: 16, sm: 32 }} py={{ base: 20, sm: 24 }} style={{ maxWidth: 1240 }}>
          <Box mb={20}>
            <Title order={1} fz={22} fw={600}>
              {cur.title}
            </Title>
            <Text c="dimmed" fz="sm" mt={3}>
              {cur.sub}
            </Text>
          </Box>
          {metaStatus === 'loading' && <PageSkeleton />}
          {metaStatus === 'error' && <LoadError message={metaError || '无法读取实例信息。'} onRetry={loadMeta} />}
          {metaStatus === 'success' && meta && (
            <>
              {tab === 'subs' && <Subscriptions />}
              {tab === 'profiles' && (
                <Profiles dts={meta.scriptDts} renderers={meta.renderers} hasAgent={!!meta.hasAgent} />
              )}
              {tab === 'agent' && <Agent hasAgent={!!meta.hasAgent} />}
              {tab === 'mcp' && <Mcp meta={meta.mcp} />}
            </>
          )}
        </Box>
      </AppShell.Main>
    </AppShell>
  )
}
