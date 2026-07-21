import { ActionIcon, Badge, Box, Button, Card, Group, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtBytes, fmtExpire, usedBytes } from '../format'
import { IInbox, IPlus, IRefresh, IRss, ITrash } from '../icons'
import type { Subscription } from '../types'

export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [content, setContent] = useState('')

  const fail = (e: unknown) => notifications.show({ color: 'red', message: String(e) })
  const load = () => api.listSubscriptions().then(setSubs).catch(fail)
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    try {
      await api.createSubscription({ name: name || '未命名', url: url || undefined, content: content || undefined })
      setName('')
      setUrl('')
      setContent('')
      notifications.show({ color: 'teal', message: '已添加订阅' })
      load()
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Group align="flex-start" gap="lg" wrap="nowrap">
      <Box style={{ flex: 1, minWidth: 0 }}>
        {subs.length === 0 ? (
          <Card>
            <Stack align="center" gap={6} py={40} c="dimmed">
              <IInbox size={34} />
              <Text fw={600} c="var(--mantine-color-text)">
                还没有订阅
              </Text>
              <Text fz="sm" ta="center">
                在右侧粘贴订阅链接或节点，SubForge 会自动抓取解析。
              </Text>
            </Stack>
          </Card>
        ) : (
          <Card>
            <Group justify="space-between" mb="sm">
              <Group gap={8}>
                <IRss size={15} />
                <Text fw={600}>我的订阅</Text>
              </Group>
              <Badge variant="light" color="gray">
                {subs.length}
              </Badge>
            </Group>
            <Stack gap={4}>
              {subs.map((s) => (
                <Group
                  key={s.id}
                  justify="space-between"
                  wrap="nowrap"
                  align="flex-start"
                  py={9}
                  px={11}
                  style={{ borderRadius: 10, border: '1px solid var(--mantine-color-default-border)' }}
                >
                  <Box style={{ minWidth: 0 }}>
                    <Text fw={550} fz={14}>
                      {s.name}
                    </Text>
                    <Text className="mono" fz={12} c="dimmed" truncate maw={360}>
                      {s.url || '手工节点'}
                    </Text>
                    <Text fz={12} c="dimmed">
                      {s.fetchedAt ? `更新于 ${new Date(s.fetchedAt).toLocaleString()}` : '未抓取'}
                    </Text>
                    {s.userInfo && (s.userInfo.total !== undefined || s.userInfo.expire) && (
                      <Group gap={6} mt={6}>
                        {s.userInfo.total !== undefined && (
                          <Badge variant="light" color="gray" tt="none" fw={500}>
                            {fmtBytes(usedBytes(s.userInfo))} / {fmtBytes(s.userInfo.total)}
                          </Badge>
                        )}
                        {s.userInfo.expire && (
                          <Badge variant="light" color="gray" tt="none" fw={500}>
                            到期 {fmtExpire(s.userInfo.expire)}
                          </Badge>
                        )}
                      </Group>
                    )}
                  </Box>
                  <Group gap={6} wrap="nowrap">
                    {s.url && (
                      <Button
                        size="xs"
                        variant="default"
                        leftSection={<IRefresh size={14} />}
                        onClick={() => api.refreshSubscription(s.id).then(load).catch(fail)}
                      >
                        刷新
                      </Button>
                    )}
                    <ActionIcon
                      size="lg"
                      variant="subtle"
                      color="red"
                      onClick={() => api.deleteSubscription(s.id).then(load).catch(fail)}
                      aria-label="删除"
                    >
                      <ITrash size={15} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))}
            </Stack>
          </Card>
        )}
      </Box>

      <Box w={360} style={{ flexShrink: 0 }}>
        <Card>
          <Group gap={8} mb="sm">
            <IPlus size={15} />
            <Text fw={600}>新增订阅</Text>
          </Group>
          <Stack gap="sm">
            <TextInput label="名称" placeholder="例如 机场A" value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <TextInput
              label="订阅链接"
              placeholder="https://…（可留空）"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
            />
            <Textarea
              label="或粘贴节点"
              placeholder="每行一个 vmess:// trojan:// … 或整段 base64 / Clash YAML"
              rows={5}
              value={content}
              onChange={(e) => setContent(e.currentTarget.value)}
            />
            <Button leftSection={<IPlus size={15} />} onClick={add}>
              添加订阅
            </Button>
          </Stack>
        </Card>
      </Box>
    </Group>
  )
}
