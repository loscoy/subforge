import { Box, Button, Group, Skeleton, Stack, Text } from '@mantine/core'

export function PageSkeleton() {
  return (
    <Stack className="async-skeleton async-page-skeleton" gap={24} role="status" aria-label="正在加载">
      <Group justify="space-between" wrap="nowrap">
        <Group gap={12} wrap="nowrap">
          <Skeleton h={36} w={36} radius={8} />
          <Stack gap={7}>
            <Skeleton h={14} w={112} radius={4} />
            <Skeleton h={10} w={184} radius={4} />
          </Stack>
        </Group>
        <Skeleton h={24} w={64} radius={8} />
      </Group>
      <Group align="flex-start" grow wrap="wrap" gap={32}>
        <Stack gap={14} miw={260}>
          <Skeleton h={16} w="34%" radius={4} />
          <Skeleton h={44} radius={8} />
          <Skeleton h={44} radius={8} />
          <Skeleton h={132} radius={8} />
        </Stack>
        <ListSkeleton rows={6} />
      </Group>
    </Stack>
  )
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Stack className="async-skeleton" gap={0} role="status" aria-label="正在加载列表">
      {Array.from({ length: rows }, (_, index) => (
        <Box className="async-skeleton-row" data-skeleton-row key={index}>
          <Skeleton h={12} w={`${42 + (index % 3) * 9}%`} radius={4} />
          <Skeleton h={9} w={`${68 + (index % 2) * 14}%`} radius={4} mt={8} />
        </Box>
      ))}
    </Stack>
  )
}

export function DetailSkeleton() {
  return (
    <Stack className="async-skeleton" gap={16} role="status" aria-label="正在加载详情">
      {[112, 156, 184, 132].map((height, index) => (
        <Box className="async-detail-skeleton" key={height}>
          <Group justify="space-between" mb={16} wrap="nowrap">
            <Skeleton h={14} w={112 + index * 12} radius={4} />
            <Skeleton h={14} w={48} radius={4} />
          </Group>
          <Skeleton h={height - 46} radius={8} />
        </Box>
      ))}
    </Stack>
  )
}

export function MessageSkeleton() {
  return (
    <Stack className="async-skeleton async-message-skeleton" gap={14} role="status" aria-label="正在加载对话">
      <Skeleton h={42} w="54%" radius={8} ml="auto" />
      <Skeleton h={68} w="72%" radius={8} />
      <Skeleton h={42} w="46%" radius={8} ml="auto" />
    </Stack>
  )
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Box className="async-error" role="alert">
      <Text fw={600}>加载失败</Text>
      <Text c="dimmed" fz="sm" mt={4}>
        {message}
      </Text>
      <Button variant="default" size="xs" mt="md" onClick={onRetry}>
        重试
      </Button>
    </Box>
  )
}
