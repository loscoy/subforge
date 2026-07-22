import { ActionIcon, Badge, Box, Button, Card, Group, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtBytes, fmtExpire, usedBytes } from '../format'
import { IInbox, IPlus, IRefresh, IRss, ITrash } from '../icons'
import type { Subscription } from '../types'
import { ListSkeleton, LoadError } from './AsyncState'

export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [adding, setAdding] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null)

  const fail = (e: unknown) => notifications.show({ color: 'red', message: String(e) })
  const load = async (initial = false) => {
    if (initial) setLoading(true)
    try {
      setSubs(await api.listSubscriptions())
      setLoadError('')
    } catch (e) {
      if (initial) setLoadError(String(e))
      else fail(e)
    } finally {
      if (initial) setLoading(false)
    }
  }
  useEffect(() => {
    void load(true)
  }, [])

  const add = async () => {
    if (adding) return
    setAdding(true)
    try {
      await api.createSubscription({ name: name || '未命名', url: url || undefined, content: content || undefined })
      setName('')
      setUrl('')
      setContent('')
      notifications.show({ color: 'teal', message: '已添加订阅' })
      await load()
    } catch (e) {
      fail(e)
    } finally {
      setAdding(false)
    }
  }

  const refresh = async (subscription: Subscription) => {
    if (refreshingId) return
    setRefreshingId(subscription.id)
    try {
      await api.refreshSubscription(subscription.id)
      await load()
    } catch (e) {
      fail(e)
    } finally {
      setRefreshingId(null)
    }
  }

  const remove = async () => {
    if (!deleteTarget || deletingId) return
    setDeletingId(deleteTarget.id)
    try {
      await api.deleteSubscription(deleteTarget.id)
      notifications.show({ color: 'teal', message: '已删除订阅' })
      setDeleteTarget(null)
      await load()
    } catch (e) {
      fail(e)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Box className="subscriptions-layout">
      <Box style={{ flex: 1, minWidth: 0 }}>
        {loading ? (
          <Card>
            <ListSkeleton rows={4} />
          </Card>
        ) : loadError ? (
          <LoadError message={loadError} onRetry={() => void load(true)} />
        ) : subs.length === 0 ? (
          <Card>
            <Stack align="center" gap={6} py={40} c="dimmed">
              <IInbox size={34} />
              <Text fw={600} c="var(--mantine-color-text)">
                还没有订阅
              </Text>
              <Text fz="sm" ta="center">
                粘贴订阅链接或节点后，SubForge 会自动抓取解析。
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
                <Box
                  key={s.id}
                  className="subscription-row"
                >
                  <Box style={{ minWidth: 0 }}>
                    <Text fw={500} fz={14}>
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
                        loading={refreshingId === s.id}
                        disabled={refreshingId !== null && refreshingId !== s.id}
                        onClick={() => void refresh(s)}
                      >
                        刷新
                      </Button>
                    )}
                    <ActionIcon
                      size="lg"
                      variant="subtle"
                      color="red"
                      loading={deletingId === s.id}
                      onClick={() => setDeleteTarget(s)}
                      aria-label={`删除订阅 ${s.name}`}
                    >
                      <ITrash size={15} />
                    </ActionIcon>
                  </Group>
                </Box>
              ))}
            </Stack>
          </Card>
        )}
      </Box>

      <Box style={{ minWidth: 0 }}>
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
            <Button leftSection={<IPlus size={15} />} loading={adding} onClick={() => void add()}>
              添加订阅
            </Button>
          </Stack>
        </Card>
      </Box>

      <Modal
        opened={!!deleteTarget}
        onClose={() => !deletingId && setDeleteTarget(null)}
        title="删除订阅"
        centered
        closeOnClickOutside={!deletingId}
        closeOnEscape={!deletingId}
      >
        <Text fz="sm">
          确认删除订阅“{deleteTarget?.name}”？关联配置不会被删除，但将不再从该订阅读取节点。
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" autoFocus disabled={!!deletingId} onClick={() => setDeleteTarget(null)}>
            取消
          </Button>
          <Button color="red" loading={!!deletingId} onClick={() => void remove()}>
            删除
          </Button>
        </Group>
      </Modal>
    </Box>
  )
}
