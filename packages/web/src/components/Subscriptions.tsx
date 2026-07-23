import { ActionIcon, Badge, Box, Button, Card, Group, Modal, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtBytes, fmtExpire, usedBytes } from '../format'
import { IInbox, IPlus, IRefresh, ITrash } from '../icons'
import type { Subscription } from '../types'
import { ListSkeleton, LoadError } from './AsyncState'

function fmtTime(ts?: number) {
  if (!ts) return '未抓取'
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function Subscriptions({ addOpened, onAddClose }: { addOpened: boolean; onAddClose: () => void }) {
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
      onAddClose()
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

  const usage = (s: Subscription) => {
    if (!s.userInfo || s.userInfo.total === undefined) return '—'
    return `${fmtBytes(usedBytes(s.userInfo))} / ${fmtBytes(s.userInfo.total)}`
  }

  return (
    <Box className="subs-page">
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
              点右上「新增订阅」，粘贴订阅链接或节点后，SubForge 会自动抓取解析。
            </Text>
          </Stack>
        </Card>
      ) : (
        <Card padding={0} className="subs-table">
          <Box className="subs-table-head">
            <span>名称</span>
            <span>来源</span>
            <span>用量</span>
            <span>更新时间</span>
            <span style={{ textAlign: 'right' }}>操作</span>
          </Box>
          {subs.map((s) => (
            <Box key={s.id} className="subs-table-row">
              <Group gap={7} wrap="nowrap" style={{ minWidth: 0 }}>
                <Text fw={600} fz={14} truncate>
                  {s.name}
                </Text>
                {!s.url && (
                  <Badge variant="light" color="violet" size="sm" tt="none" fw={600} style={{ flexShrink: 0 }}>
                    手工
                  </Badge>
                )}
              </Group>
              <Text className="mono" fz={12} c="dimmed" truncate>
                {s.url || (s.content ? '手工节点' : '—')}
              </Text>
              {/* 允许换行：窄屏放不下时到期徽章换行，而不是被压成「到…」 */}
              <Group gap={6}>
                <Text fz={13} style={{ whiteSpace: 'nowrap' }}>
                  {usage(s)}
                </Text>
                {s.userInfo?.expire && (
                  <Badge variant="light" color="gray" size="sm" tt="none" fw={500}>
                    到期 {fmtExpire(s.userInfo.expire)}
                  </Badge>
                )}
              </Group>
              <Text fz={13} c="dimmed">
                {fmtTime(s.fetchedAt)}
              </Text>
              <Group gap={6} justify="flex-end" wrap="nowrap">
                {s.url && (
                  <Tooltip label="刷新">
                    <ActionIcon
                      variant="default"
                      size={30}
                      radius={7}
                      loading={refreshingId === s.id}
                      disabled={refreshingId !== null && refreshingId !== s.id}
                      onClick={() => void refresh(s)}
                      aria-label={`刷新订阅 ${s.name}`}
                    >
                      <IRefresh size={13} />
                    </ActionIcon>
                  </Tooltip>
                )}
                <Tooltip label="删除">
                  <ActionIcon
                    variant="default"
                    size={30}
                    radius={7}
                    c="red"
                    loading={deletingId === s.id}
                    onClick={() => setDeleteTarget(s)}
                    aria-label={`删除订阅 ${s.name}`}
                  >
                    <ITrash size={13} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Box>
          ))}
          <Text fz={12.5} c="dimmed" px={18} py={10}>
            共 {subs.length} 个订阅
          </Text>
        </Card>
      )}

      <Modal opened={addOpened} onClose={() => !adding && onAddClose()} title="新增订阅" centered>
        <Stack gap="sm">
          <TextInput label="名称" placeholder="例如 机场A" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
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
          <Group justify="flex-end" mt={4}>
            <Button variant="default" disabled={adding} onClick={onAddClose}>
              取消
            </Button>
            <Button leftSection={<IPlus size={15} />} loading={adding} onClick={() => void add()}>
              添加订阅
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={!!deleteTarget}
        onClose={() => !deletingId && setDeleteTarget(null)}
        title="删除订阅"
        centered
        closeOnClickOutside={!deletingId}
        closeOnEscape={!deletingId}
      >
        <Text fz="sm">确认删除订阅“{deleteTarget?.name}”？关联配置不会被删除，但将不再从该订阅读取节点。</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" data-autofocus disabled={!!deletingId} onClick={() => setDeleteTarget(null)}>
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
