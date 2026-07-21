import {
  ActionIcon,
  AppShell,
  Box,
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
import { Profiles } from './components/Profiles'
import { Subscriptions } from './components/Subscriptions'
import { IBrand, ILayers, IMoon, IRss, ISparkles, ISun } from './icons'
import type { Meta } from './types'

type Tab = 'subs' | 'profiles' | 'agent'

const TABS: { key: Tab; label: string; title: string; sub: string; icon: typeof IRss }[] = [
  { key: 'subs', label: '订阅', title: '订阅', sub: '添加机场订阅或手工节点，SubForge 会抓取并解析。', icon: IRss },
  { key: 'profiles', label: '配置', title: '配置', sub: '把订阅按你的规则转成可用配置，用分享链接分发。', icon: ILayers },
  { key: 'agent', label: 'Agent', title: 'Agent', sub: '用对话调整配置、写脚本、管理模板。', icon: ISparkles },
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
          borderRadius: 9,
          background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(124,58,237,.35)',
        }}
      >
        <IBrand size={17} />
      </Box>
      <Text fw={650} fz={15.5}>
        Sub
        <Text span c="dimmed" fw={500}>
          Forge
        </Text>
      </Text>
    </Group>
  )
}

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
      <Box style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Card w={400} padding="xl">
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
    <AppShell navbar={{ width: 236, breakpoint: 'sm' }} padding={0}>
      <AppShell.Navbar p="sm">
        <Brand />
        <Stack gap={2} mt="xs">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <NavLink
                key={t.key}
                active={tab === t.key}
                label={t.label}
                leftSection={<Icon size={17} />}
                onClick={() => setTab(t.key)}
                variant="light"
                style={{ borderRadius: 9, fontWeight: 500 }}
              />
            )
          })}
        </Stack>
        <Box mt="auto" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
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

      <AppShell.Main>
        <Box px={30} py={22} style={{ maxWidth: 1180 }}>
          <Box mb={20}>
            <Title order={1} fz={22} fw={650}>
              {cur.title}
            </Title>
            <Text c="dimmed" fz="sm" mt={3}>
              {cur.sub}
            </Text>
          </Box>
          {tab === 'subs' && <Subscriptions />}
          {tab === 'profiles' && meta && (
            <Profiles dts={meta.scriptDts} renderers={meta.renderers} hasAgent={!!meta.hasAgent} />
          )}
          {tab === 'agent' && <Agent hasAgent={!!meta?.hasAgent} />}
        </Box>
      </AppShell.Main>
    </AppShell>
  )
}
