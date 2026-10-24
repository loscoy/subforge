import { ActionIcon, Alert, Badge, Box, Button, Card, Group, Modal, NumberInput, Stack, Switch, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
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
  const [editTarget, setEditTarget] = useState<Subscription | null>(null)
  const [userAgent, setUserAgent] = useState('')
  const [maxAgeMinutes, setMaxAgeMinutes] = useState<number | string>(60)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState<number | string>(60)
  const [failureThreshold, setFailureThreshold] = useState<number | string>(3)
  const [dropPercent, setDropPercent] = useState<number | string>(50)
  const [historyTarget, setHistoryTarget] = useState<Subscription | null>(null)
  const [bulkOpened, setBulkOpened] = useState(false)
  const [bulkUrls, setBulkUrls] = useState('')
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

  useEffect(() => {
    if (addOpened) {
      setName(''); setUrl(''); setContent(''); setUserAgent(''); setMaxAgeMinutes(60)
      setAutoRefresh(false); setIntervalMinutes(60); setFailureThreshold(3); setDropPercent(50)
    }
  }, [addOpened])

  const edit = (sub: Subscription) => {
    setName(sub.name); setUrl(sub.url || ''); setContent(sub.url ? '' : sub.content || '')
    setUserAgent(sub.fetchPolicy?.userAgent || '')
    setMaxAgeMinutes(sub.fetchPolicy?.maxAgeMinutes ?? 60)
    setAutoRefresh(sub.fetchPolicy?.autoRefresh ?? false)
    setIntervalMinutes(sub.fetchPolicy?.intervalMinutes ?? 60)
    setFailureThreshold(sub.fetchPolicy?.failureThreshold ?? 3)
    setDropPercent(sub.fetchPolicy?.dropPercent ?? 50)
    setEditTarget(sub)
  }
  const closeEditor = () => { setEditTarget(null); onAddClose() }
  const add = async () => {
    if (adding) return
    setAdding(true)
    try {
      const patch = {
        name: name || '未命名', url: url.trim(),
        ...(!url.trim() ? { content } : {}),
        fetchPolicy: { userAgent, maxAgeMinutes: Number(maxAgeMinutes), autoRefresh: !!url.trim() && autoRefresh, intervalMinutes: Number(intervalMinutes), failureThreshold: Number(failureThreshold), dropPercent: Number(dropPercent) },
      }
      if (!patch.url && !content.trim()) throw new Error('请填写订阅链接或手工节点')
      if (editTarget) await api.updateSubscription(editTarget.id, patch)
      else await api.createSubscription(patch)
      setName('')
      setUrl('')
      setContent('')
      notifications.show({ color: 'teal', message: editTarget ? '已保存订阅' : '已添加订阅' })
      closeEditor()
      await load()
    } catch (e) {
      fail(e)
    } finally {
      setAdding(false)
    }
  }

  const importUrls = async () => {
    setAdding(true)
    const urls = [...new Set(bulkUrls.split(/\s+/).filter(Boolean))]
    try {
      if (!urls.length || urls.some((u) => { try { return !['http:', 'https:'].includes(new URL(u).protocol) } catch { return true } })) {
        throw new Error('每行填写一个有效的 HTTP(S) 订阅链接')
      }
      while (urls.length) {
        const address = urls[0]
        await api.createSubscription({ name: new URL(address).hostname, url: address })
        urls.shift()
        setBulkUrls(urls.join('\n'))
      }
      setBulkOpened(false)
      notifications.show({ color: 'teal', message: '订阅链接已导入，构建时自动抓取' })
    } catch (e) { fail(e) } finally { setAdding(false); await load() }
  }

  const refresh = async (subscription: Subscription) => {
    if (refreshingId) return
    setRefreshingId(subscription.id)
    try {
      await api.refreshSubscription(subscription.id)
    } catch (e) {
      fail(e)
    } finally {
      await load()
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
      <Group justify="flex-end" mb="sm"><Button variant="light" onClick={() => setBulkOpened(true)}>批量导入链接</Button></Group>
      {subs.flatMap(s => (s.refreshStatus?.alerts || []).map((message, i) => <Alert color="orange" mb="sm" key={`${s.id}:${i}`} title={s.name}>{message} <Button size="compact-xs" variant="subtle" onClick={() => setHistoryTarget(s)}>查看刷新记录</Button></Alert>))}
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
              <Stack gap={0} align="flex-start">
                <Text fz={13} c="dimmed">{fmtTime(s.fetchedAt)}</Text>
                {s.url && <Button size="compact-xs" variant="subtle" onClick={() => setHistoryTarget(s)}>刷新记录</Button>}
              </Stack>
              <Group gap={6} justify="flex-end" wrap="nowrap">
                <Button size="compact-xs" variant="subtle" onClick={() => edit(s)}>编辑</Button>
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

      <Modal opened={addOpened || !!editTarget} onClose={() => !adding && closeEditor()} title={editTarget ? '编辑订阅' : '新增订阅'} centered>
        <Stack gap="sm">
          <TextInput label="名称" placeholder="例如 机场A" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
          <TextInput
            label="订阅链接"
            placeholder="https://…（可留空）"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          {!url.trim() && <Textarea
            label="或粘贴节点"
            placeholder="每行一个 vmess:// trojan:// … 或整段 base64 / Clash YAML"
            rows={5}
            value={content}
            onChange={(e) => setContent(e.currentTarget.value)}
          />}
          <TextInput label="抓取 User-Agent" placeholder="留空使用默认值" value={userAgent} onChange={(e) => setUserAgent(e.currentTarget.value)} />
          <NumberInput label="缓存有效期（分钟）" description="构建时过期才刷新；失败会报错并保留最后有效缓存。更换链接或 UA 会清除旧缓存。" min={1} max={1440} value={maxAgeMinutes} onChange={setMaxAgeMinutes} />
          {!!url.trim() && <>
            <Switch label="启用定时刷新" description="默认关闭；启用后由服务端自动刷新，失败不替换有效缓存。" checked={autoRefresh} onChange={e => setAutoRefresh(e.currentTarget.checked)} />
            {autoRefresh && <NumberInput label="刷新间隔（分钟）" description="调度检查可能延迟 1–5 分钟；服务停止期间不执行。" min={5} max={10080} value={intervalMinutes} onChange={setIntervalMinutes} />}
            <Group grow><NumberInput label="连续失败提醒次数" min={1} max={100} value={failureThreshold} onChange={setFailureThreshold} /><NumberInput label="节点减少提醒比例（%）" min={1} max={100} value={dropPercent} onChange={setDropPercent} /></Group>
            <Text size="xs" c="dimmed">提醒显示在订阅页；不发送外部通知。</Text>
          </>}
          <Group justify="flex-end" mt={4}>
            <Button variant="default" disabled={adding} onClick={closeEditor}>
              取消
            </Button>
            <Button leftSection={<IPlus size={15} />} loading={adding} onClick={() => void add()}>
              {editTarget ? '保存订阅' : '添加订阅'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!historyTarget} onClose={() => setHistoryTarget(null)} title={`刷新记录 · ${historyTarget?.name || ''}`} size="lg" centered>
        <Stack>
          <Text size="sm" c="dimmed">最近 20 次刷新；增删节点名称各最多展示 100 项，计数完整。字段变化记录为移除旧项并加入新项。</Text>
          {!historyTarget?.refreshStatus?.history.length && <Text>暂无刷新记录。</Text>}
          {historyTarget?.refreshStatus?.history.map((entry, i) => <Card withBorder key={i}>
            <Group justify="space-between"><Text size="sm">{new Date(entry.at).toLocaleString()}</Text><Badge color={entry.ok ? 'teal' : 'red'}>{entry.ok ? '刷新成功' : '刷新失败'}</Badge></Group>
            {entry.error && <Text size="sm" c="red">{entry.error}</Text>}
            {entry.delta && <Stack gap={4} mt="sm"><Text>节点数量：{entry.delta.before} → {entry.delta.after}</Text><Text size="sm">新增：{entry.delta.added.map(n => n.name).join('、') || '无'}</Text><Text size="sm">移除：{entry.delta.removed.map(n => n.name).join('、') || '无'}</Text></Stack>}
          </Card>)}
        </Stack>
      </Modal>

      <Modal opened={bulkOpened} onClose={() => !adding && setBulkOpened(false)} title="批量导入普通订阅链接" centered>
        <Stack>
          <Textarea label="每行一个 HTTP(S) 订阅链接" description="手工节点请在新增订阅中整段粘贴。已成功导入的链接会从下方移除，失败后可继续。" rows={8} value={bulkUrls} onChange={(e) => setBulkUrls(e.currentTarget.value)} disabled={adding} />
          <Button loading={adding} onClick={() => void importUrls()}>导入链接</Button>
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
        <Text fz="sm">确认删除订阅“{deleteTarget?.name}”？若仍被配置引用，请先在配置中移除该来源。</Text>
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
