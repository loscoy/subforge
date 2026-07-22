import { ActionIcon, Badge, Box, Code, CopyButton, Group, SimpleGrid, Stack, Tabs, Text, Tooltip } from '@mantine/core'
import { buildMcpExamples, resolveMcpEndpoint } from '../mcp'
import { ICheck, ICopy, IPlug } from '../icons'
import type { Meta } from '../types'

function CopyAction({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton value={value} timeout={1600}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? '已复制' : label} withArrow>
          <ActionIcon variant="default" size="lg" onClick={copy} aria-label={label}>
            {copied ? <ICheck size={16} /> : <ICopy size={16} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  )
}

function ConfigBlock({ value, label }: { value: string; label: string }) {
  return (
    <Box pos="relative">
      <Code
        block
        className="mono"
        style={{ minHeight: 128, maxHeight: 300, overflow: 'auto', padding: 16, paddingRight: 54, fontSize: 12 }}
      >
        {value}
      </Code>
      <Box pos="absolute" top={10} right={10}>
        <CopyAction value={value} label={label} />
      </Box>
    </Box>
  )
}

export function Mcp({ meta }: { meta: Meta['mcp'] }) {
  const endpoint = resolveMcpEndpoint(window.location.origin, meta.endpoint)
  const examples = buildMcpExamples(endpoint)
  const authorization = 'Authorization: Bearer <MCP_TOKEN>'

  return (
    <Stack gap={28}>
      <Box pb="lg" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Group gap={12} wrap="nowrap">
            <Box
              w={36}
              h={36}
              style={{
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 8,
                display: 'grid',
                placeItems: 'center',
                color: 'var(--mantine-color-violet-6)',
              }}
            >
              <IPlug size={18} />
            </Box>
            <Box>
              <Text fw={600}>远端连接</Text>
              <Text fz="sm" c="dimmed">
                Streamable HTTP · Bearer token
              </Text>
            </Box>
          </Group>
          <Badge color={meta.enabled ? 'teal' : 'gray'} variant="light" size="lg" tt="none">
            {meta.enabled ? '已启用' : '未启用'}
          </Badge>
        </Group>

        {!meta.enabled && (
          <Box
            mt="md"
            px="md"
            py="sm"
            style={{ borderLeft: '3px solid var(--mantine-color-yellow-6)', background: 'var(--mantine-color-default-hover)' }}
          >
            <Text fz="sm">服务端尚未配置 MCP_TOKEN，远端请求会被拒绝。</Text>
          </Box>
        )}
      </Box>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 24, md: 40 }}>
        <Stack gap="md">
          <Box>
            <Text fw={600} mb={4}>连接信息</Text>
            <Text fz="sm" c="dimmed">客户端通过下面的 HTTPS 端点访问当前 SubForge 实例。</Text>
          </Box>

          <Box>
            <Text fz={12} c="dimmed" mb={6}>端点</Text>
            <Group gap={8} wrap="nowrap" align="stretch">
              <Code
                block
                className="mono"
                style={{ flex: 1, minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap', padding: '9px 12px' }}
              >
                {endpoint}
              </Code>
              <CopyAction value={endpoint} label="复制端点" />
            </Group>
          </Box>

          <Box>
            <Text fz={12} c="dimmed" mb={6}>请求头</Text>
            <Group gap={8} wrap="nowrap" align="stretch">
              <Code
                block
                className="mono"
                style={{ flex: 1, minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap', padding: '9px 12px' }}
              >
                {authorization}
              </Code>
              <CopyAction value={authorization} label="复制请求头" />
            </Group>
          </Box>

          <Box mt="lg" pt="lg" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            <Text fw={600}>客户端配置</Text>
            <Text fz="sm" c="dimmed" mt={3} mb="md">将占位符替换为服务端设置的 MCP_TOKEN。</Text>
            <Tabs defaultValue="claude" keepMounted={false}>
              <Tabs.List mb="md">
                <Tabs.Tab value="claude">Claude Code</Tabs.Tab>
                <Tabs.Tab value="json">通用 JSON</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="claude">
                <ConfigBlock value={examples.claudeCode} label="复制 Claude Code 命令" />
              </Tabs.Panel>
              <Tabs.Panel value="json">
                <ConfigBlock value={examples.json} label="复制 JSON 配置" />
              </Tabs.Panel>
            </Tabs>
          </Box>
        </Stack>

        <Box>
          <Group justify="space-between" mb="sm">
            <Box>
              <Text fw={600}>可用工具</Text>
              <Text fz="sm" c="dimmed">当前运行时共 {meta.tools.length} 项能力</Text>
            </Box>
            <Badge color="gray" variant="light">{meta.tools.length}</Badge>
          </Group>
          <Stack gap={0} style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            {meta.tools.map((tool) => (
              <Box key={tool.name} py={9} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Text className="mono" fz={12} fw={600}>{tool.name}</Text>
                <Text fz={12} c="dimmed" mt={2}>{tool.description}</Text>
              </Box>
            ))}
          </Stack>
        </Box>
      </SimpleGrid>

    </Stack>
  )
}
