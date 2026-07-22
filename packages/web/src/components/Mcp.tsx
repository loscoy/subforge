import { ActionIcon, Badge, Box, Code, CopyButton, Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core'
import { useState } from 'react'
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

function CopyField({ value, label, copyLabel }: { value: string; label: string; copyLabel: string }) {
  return (
    <Box>
      <Text fz={12} fw={500} c="dimmed" mb={6}>{label}</Text>
      <Box className="mcp-copy-field">
        <Code block className="mono" classNames={{ root: 'mcp-copy-value' }}>
          {value}
        </Code>
        <CopyAction value={value} label={copyLabel} />
      </Box>
    </Box>
  )
}

export function Mcp({ meta }: { meta: Meta['mcp'] }) {
  const [exampleMode, setExampleMode] = useState<'claude' | 'json'>('claude')
  const endpoint = resolveMcpEndpoint(window.location.origin, meta.endpoint)
  const examples = buildMcpExamples(endpoint)
  const authorization = 'Authorization: Bearer <MCP_TOKEN>'

  return (
    <Stack gap={28}>
      <Box className="mcp-status">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Group gap={12} wrap="nowrap">
            <Box
              w={36}
              h={36}
              style={{
                border: '1px solid var(--sf-border-subtle)',
                borderRadius: 8,
                display: 'grid',
                placeItems: 'center',
                color: 'var(--mantine-color-violet-6)',
                background: 'var(--sf-surface-subtle)',
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
            style={{ borderLeft: '3px solid var(--mantine-color-yellow-6)', background: 'var(--sf-surface-subtle)', borderRadius: 6 }}
          >
            <Text fz="sm">服务端尚未配置 MCP_TOKEN，远端请求会被拒绝。</Text>
          </Box>
        )}
      </Box>

      <Box className="mcp-layout">
        <Stack gap="md">
          <Box>
            <Text fw={600} mb={4}>连接信息</Text>
            <Text fz="sm" c="dimmed">客户端通过下面的 HTTPS 端点访问当前 SubForge 实例。</Text>
          </Box>

          <CopyField label="端点" value={endpoint} copyLabel="复制端点" />
          <CopyField label="请求头" value={authorization} copyLabel="复制请求头" />

          <Box mt="lg">
            <Group justify="space-between" align="flex-end" mb="md" wrap="wrap">
              <Box>
                <Text fw={600}>客户端配置</Text>
                <Text fz="sm" c="dimmed" mt={3}>将占位符替换为服务端设置的 MCP_TOKEN。</Text>
              </Box>
              <SegmentedControl
                size="xs"
                value={exampleMode}
                onChange={(value) => setExampleMode(value as 'claude' | 'json')}
                data={[
                  { value: 'claude', label: 'Claude Code' },
                  { value: 'json', label: '通用 JSON' },
                ]}
              />
            </Group>
            {exampleMode === 'claude' ? (
              <ConfigBlock value={examples.claudeCode} label="复制 Claude Code 命令" />
            ) : (
              <ConfigBlock value={examples.json} label="复制 JSON 配置" />
            )}
          </Box>
        </Stack>

        <Box>
          <Group justify="space-between" mb="md" align="flex-end">
            <Box>
              <Text fw={600}>可用工具</Text>
              <Text fz="sm" c="dimmed">当前运行时共 {meta.tools.length} 项能力</Text>
            </Box>
            <Badge color="gray" variant="light">{meta.tools.length}</Badge>
          </Group>
          <Stack gap={0} className="mcp-tool-list">
            {meta.tools.map((tool) => (
              <Box key={tool.name} className="mcp-tool-row">
                <Text className="mono" fz={13} fw={600}>{tool.name}</Text>
                <Text fz={13} lh={1.5} c="dimmed" mt={3}>{tool.description}</Text>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>

    </Stack>
  )
}
