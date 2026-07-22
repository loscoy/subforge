import { ActionIcon, Badge, Box, Card, Code, CopyButton, Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core'
import { useState } from 'react'
import { buildMcpExamples, resolveMcpEndpoint } from '../mcp'
import { ICheck, ICopy, IPlug } from '../icons'
import type { Meta } from '../types'

function CopyAction({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton value={value} timeout={1600}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? '已复制' : label} withArrow>
          <ActionIcon variant="default" size={36} radius={7} onClick={copy} aria-label={label}>
            {copied ? <ICheck size={15} /> : <ICopy size={15} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  )
}

function CopyField({ value, label, copyLabel }: { value: string; label: string; copyLabel: string }) {
  return (
    <Box>
      <Text fz={12} fw={500} c="dimmed" mb={5}>
        {label}
      </Text>
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
  const [exampleMode, setExampleMode] = useState<'claude' | 'codex' | 'json'>('claude')
  const endpoint = resolveMcpEndpoint(window.location.origin, meta.endpoint)
  const examples = buildMcpExamples(endpoint)
  const authorization = 'Authorization: Bearer <MCP_TOKEN>'
  const selectedExample = {
    claude: { value: examples.claudeCode, copyLabel: '复制 Claude Code 命令' },
    codex: { value: examples.codex, copyLabel: '复制 Codex 命令' },
    json: { value: examples.json, copyLabel: '复制 JSON 配置' },
  }[exampleMode]

  return (
    <Card padding={0} maw={1080} className="mcp-card">
      {/* 左：远端连接 */}
      <Box className="mcp-conn">
        <Group justify="space-between" px={20} py={16} className="mcp-pane-head">
          <Group gap={10} wrap="nowrap">
            <Box
              w={34}
              h={34}
              style={{
                borderRadius: 8,
                display: 'grid',
                placeItems: 'center',
                color: 'var(--mantine-color-violet-6)',
                background: 'var(--mantine-color-violet-light)',
              }}
            >
              <IPlug size={17} />
            </Box>
            <Box>
              <Text fw={600}>远端连接</Text>
              <Text fz={12.5} c="dimmed">
                Streamable HTTP · Bearer token
              </Text>
            </Box>
          </Group>
          <Badge color={meta.enabled ? 'teal' : 'gray'} variant="light" size="lg" tt="none">
            {meta.enabled ? '已启用' : '未启用'}
          </Badge>
        </Group>

        <Stack gap={12} px={20} py={16}>
          {!meta.enabled && (
            <Box
              px="md"
              py="sm"
              style={{ borderLeft: '3px solid var(--mantine-color-yellow-6)', background: 'var(--sf-surface-subtle)', borderRadius: 6 }}
            >
              <Text fz="sm">服务端尚未配置 MCP_TOKEN，远端请求会被拒绝。</Text>
            </Box>
          )}
          <CopyField label="端点" value={endpoint} copyLabel="复制端点" />
          <CopyField label="请求头" value={authorization} copyLabel="复制请求头" />
          <Box>
            <Group justify="space-between" align="center" mb={8}>
              <Text fz={12} fw={500} c="dimmed">
                客户端配置
              </Text>
              <SegmentedControl
                size="xs"
                value={exampleMode}
                onChange={(value) => setExampleMode(value as 'claude' | 'codex' | 'json')}
                data={[
                  { value: 'claude', label: 'Claude Code' },
                  { value: 'codex', label: 'Codex' },
                  { value: 'json', label: 'JSON' },
                ]}
              />
            </Group>
            <Box pos="relative">
              <Code
                block
                className="mono"
                style={{
                  padding: 14,
                  paddingRight: 54,
                  fontSize: 12,
                  overflow: 'auto',
                  background: 'var(--sf-surface-subtle)',
                  border: '1px solid var(--sf-border-subtle)',
                  borderRadius: 7,
                }}
              >
                {selectedExample.value}
              </Code>
              <Box pos="absolute" top={9} right={9}>
                <CopyAction value={selectedExample.value} label={selectedExample.copyLabel} />
              </Box>
            </Box>
            <Text fz={12} c="dimmed" mt={6}>
              将占位符替换为服务端设置的 MCP_TOKEN。
            </Text>
          </Box>
        </Stack>
      </Box>

      {/* 右：可用工具 */}
      <Box>
        <Group justify="space-between" px={20} py={16} className="mcp-pane-head">
          <Text fw={600}>可用工具</Text>
          <Badge color="gray" variant="light">
            {meta.tools.length}
          </Badge>
        </Group>
        <Box px={20} pt={4} pb={16}>
          {meta.tools.map((tool) => (
            <Box key={tool.name} py={9}>
              <Text className="mono" fz={12.5} fw={600}>
                {tool.name}
              </Text>
              <Text fz={12.5} lh={1.5} c="dimmed" mt={2}>
                {tool.description}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Card>
  )
}
