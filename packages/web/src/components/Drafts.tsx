import { Alert, Badge, Button, Card, Code, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, apiErrorText } from '../api'
import { AGENT_CHANGED_EVENT, DRAFTS_CHANGED_EVENT } from '../App'

export interface ChangeDraftView {
  id: string
  tool: string
  entity: string
  entityId: string
  before: { name?: string } | null
  after: { name?: string } | null
  validation: { ok: boolean; error?: string; warnings: string[] }
  diff: { field: string; before: unknown; after: unknown }[]
}

export function Drafts() {
  const [drafts, setDrafts] = useState<ChangeDraftView[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ChangeDraftView | null>(null)
  const load = async () => {
    try { setDrafts(await api.listDrafts()); setError('') } catch (e) { setError(apiErrorText(e)) }
  }
  useEffect(() => {
    void load()
    const update = () => void load()
    window.addEventListener(DRAFTS_CHANGED_EVENT, update)
    return () => window.removeEventListener(DRAFTS_CHANGED_EVENT, update)
  }, [])
  const act = async (draft: ChangeDraftView, apply: boolean) => {
    setLoading(true)
    try {
      if (apply) await api.applyDraft(draft.id)
      else await api.deleteDraft(draft.id)
      setSelected(null)
      await load()
      if (apply) window.dispatchEvent(new CustomEvent(AGENT_CHANGED_EVENT))
    } catch (e) { setError(apiErrorText(e)); setSelected(null) } finally { setLoading(false) }
  }
  const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return <Stack>
    <Group justify="space-between"><Text c="dimmed">Agent 与 MCP 的修改在此审批。配置应用时保留版本；过期草稿会被拒绝。</Text><Button variant="default" onClick={() => void load()}>刷新草稿</Button></Group>
    {error && <Alert color="red">{error}</Alert>}
    {!drafts.length && <Card><Text>暂无待审批变更。</Text></Card>}
    {drafts.map((draft) => <Card key={draft.id} withBorder>
      <Stack gap="sm">
        <Group justify="space-between"><Text fw={600}>{draft.after?.name || draft.before?.name || draft.entityId} · {draft.after ? draft.before ? '修改' : '新建' : '删除'}</Text><Badge color={draft.validation.ok ? 'teal' : 'red'}>{draft.validation.ok ? '静态验证通过' : '验证未通过'}</Badge></Group>
        <Text size="xs" c="dimmed">{draft.tool} · {draft.entity}</Text>
        {draft.validation.error && <Alert color="red">{draft.validation.error}</Alert>}
        {draft.validation.warnings.map((warning, i) => <Text size="sm" c="orange" key={i}>{warning}</Text>)}
        {draft.diff.map((diff, i) => <details key={i} open={i === 0}>
          <summary>{diff.field}</summary>
          <SimpleGrid cols={{ base: 1, md: 2 }} mt="xs">
            <div><Text size="xs" c="dimmed">变更前</Text><Code block style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{display(diff.before)}</Code></div>
            <div><Text size="xs" c="dimmed">变更后</Text><Code block style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{display(diff.after)}</Code></div>
          </SimpleGrid>
        </details>)}
        <Group justify="flex-end"><Button variant="default" disabled={loading} onClick={() => void act(draft, false)}>弃用草稿</Button><Button disabled={!draft.validation.ok || loading} onClick={() => setSelected(draft)}>检查并应用</Button></Group>
      </Stack>
    </Card>)}
    <Modal opened={!!selected} onClose={() => !loading && setSelected(null)} title="应用变更草稿" centered>
      <Text>确认将上述变更应用到“{selected?.after?.name || selected?.before?.name}”？应用后分享输出可能发生变化。删除操作不可恢复。</Text>
      <Group justify="flex-end" mt="md"><Button variant="default" onClick={() => setSelected(null)} disabled={loading}>取消</Button><Button loading={loading} onClick={() => selected && void act(selected, true)}>确认应用</Button></Group>
    </Modal>
  </Stack>
}
