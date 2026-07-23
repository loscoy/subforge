import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  CopyButton,
  Group,
  NativeSelect,
  NumberInput,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { IAlert, ICheck, IKey, IPlug, IPulse, ISparkles } from '../icons'
import {
  FETCH_ENGINES,
  SEARCH_ENGINES,
  type ProbeResult,
  type SecretPatch,
  type SecretView,
  type Settings as SettingsDto,
  type SettingsPatch,
  type WebProvider,
} from '../types'
import { LoadError, PageSkeleton } from './AsyncState'

/**
 * 密钥输入：服务端只回「配没配 + 掩码」，明文永远不出后端。
 * 三态由 draft 表达——undefined 不改、'' 经「清除」变成 null、有值即覆盖。
 */
function SecretInput({
  label,
  description,
  view,
  draft,
  disabled,
  onChange,
  extraActions,
}: {
  label: string
  description?: string
  view: SecretView
  /** undefined = 未改动 */
  draft: string | null | undefined
  disabled?: boolean
  onChange: (next: SecretPatch) => void
  extraActions?: React.ReactNode
}) {
  const cleared = draft === null
  const placeholder = cleared
    ? '（保存后清除）'
    : view.configured
      ? `已配置 ${view.hint ?? ''}，留空即不改`
      : '尚未配置'
  return (
    <Box>
      <PasswordInput
        label={label}
        description={description}
        placeholder={placeholder}
        disabled={disabled}
        value={typeof draft === 'string' ? draft : ''}
        onChange={(e) => onChange(e.currentTarget.value || undefined)}
      />
      {!disabled && (
        <Group gap={8} mt={6}>
          {cleared ? (
            <>
              <Badge variant="light" color="red" size="sm" tt="none" fw={500}>
                保存后将清除
              </Badge>
              <Button variant="subtle" size="compact-xs" onClick={() => onChange(undefined)}>
                撤销
              </Button>
            </>
          ) : (
            <>
              {extraActions}
              {view.configured && (
                <Button variant="subtle" color="red" size="compact-xs" onClick={() => onChange(null)}>
                  清除
                </Button>
              )}
            </>
          )}
        </Group>
      )}
    </Box>
  )
}

/** 32 字节随机数转 base64url，够强且没有需要转义的字符。 */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function SectionCard({
  icon,
  title,
  sub,
  children,
}: {
  icon: React.ReactNode
  title: string
  sub: string
  children: React.ReactNode
}) {
  return (
    <Card padding={0}>
      <Group gap={10} wrap="nowrap" px={20} py={16} className="settings-card-head">
        <Box
          w={34}
          h={34}
          style={{
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--mantine-color-violet-6)',
            background: 'var(--mantine-color-violet-light)',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box style={{ minWidth: 0 }}>
          <Text fw={600}>{title}</Text>
          <Text fz={12.5} c="dimmed">
            {sub}
          </Text>
        </Box>
      </Group>
      <Stack gap={14} px={20} py={16}>
        {children}
      </Stack>
    </Card>
  )
}

const PROVIDER_OPTIONS = [
  { value: '', label: '关闭' },
  { value: 'openrouter', label: 'OpenRouter 服务端工具' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'exa', label: 'Exa' },
]

export function Settings({ onSaved }: { onSaved?: () => void }) {
  const [data, setData] = useState<SettingsDto | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  // 草稿只存「改动过的字段」，未改动的保持 undefined，直接对应 PUT 的三态语义
  const [patch, setPatch] = useState<SettingsPatch>({})

  const load = async () => {
    setLoadError('')
    try {
      setData(await api.getSettings())
      setPatch({})
      setProbe(null)
    } catch (e) {
      setLoadError(String(e))
    }
  }
  useEffect(() => {
    void load()
  }, [])

  if (loadError) return <LoadError message={loadError} onRetry={() => void load()} />
  if (!data) return <PageSkeleton />

  const dirty = Object.keys(patch).length > 0
  const lockSecrets = !data.canStoreSecrets
  // 当前生效值 = 草稿优先，否则用服务端已存值
  const agentField = (k: 'baseURL' | 'model') => patch.agent?.[k] ?? data.agent[k]
  const webField = <K extends 'searchEngine' | 'fetchEngine' | 'maxToolCalls' | 'maxResults'>(k: K) =>
    patch.web?.[k] ?? data.web[k]
  // null 是有效值（关闭），不能用 ?? 兜底
  const providerOf = (k: 'searchProvider' | 'fetchProvider') =>
    patch.web?.[k] !== undefined ? patch.web[k] : data.web[k]
  const searchProvider = providerOf('searchProvider')
  const fetchProvider = providerOf('fetchProvider')
  const usesProvider = (p: WebProvider) => searchProvider === p || fetchProvider === p
  const anyWebEnabled = !!searchProvider || !!fetchProvider

  const patchAgent = (next: Partial<NonNullable<SettingsPatch['agent']>>) =>
    setPatch((p) => ({ ...p, agent: { ...p.agent, ...next } }))
  const patchWeb = (next: Partial<NonNullable<SettingsPatch['web']>>) =>
    setPatch((p) => ({ ...p, web: { ...p.web, ...next } }))

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      setData(await api.saveSettings(patch))
      setPatch({})
      notifications.show({ color: 'teal', message: '设置已保存，立即生效' })
      onSaved?.()
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (testing) return
    setTesting(true)
    setProbe(null)
    try {
      setProbe(
        await api.testAgent({
          baseURL: agentField('baseURL'),
          model: agentField('model'),
          // 只有本次输入了新 key 才带上；否则让服务端用已存的
          apiKey: typeof patch.agent?.apiKey === 'string' ? patch.agent.apiKey : undefined,
        }),
      )
    } catch (e) {
      setProbe({ ok: false, latencyMs: 0, error: String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Stack gap={16} className="settings-page">
      {lockSecrets && (
        <Alert color="orange" icon={<IAlert size={16} />} title="未配置 SETTINGS_KEY">
          密钥（API Key、MCP 口令）需要用它加密后才能入库，当前无法保存，Agent 与远端 MCP 会保持关闭。
          给部署设置环境变量 <span className="mono">SETTINGS_KEY</span>（任意足够长的随机串）后刷新本页。
          其余非密钥项不受影响，仍可正常修改。
        </Alert>
      )}

      <SectionCard icon={<ISparkles size={17} />} title="Agent 模型" sub="OpenAI 兼容接口，三项齐备 Agent 才可用">
        <TextInput
          label="Base URL"
          placeholder="https://openrouter.ai/api/v1"
          description="兼容 OpenAI 的接口根地址，本地模型（Ollama / LM Studio）也可以"
          value={agentField('baseURL')}
          onChange={(e) => patchAgent({ baseURL: e.currentTarget.value })}
        />
        <TextInput
          label="模型名"
          placeholder="anthropic/claude-sonnet-4"
          value={agentField('model')}
          onChange={(e) => patchAgent({ model: e.currentTarget.value })}
        />
        <SecretInput
          label="API Key"
          view={data.agent.apiKey}
          draft={patch.agent?.apiKey}
          disabled={lockSecrets}
          onChange={(apiKey) => patchAgent({ apiKey })}
        />
        <Group gap={12}>
          <Button variant="default" leftSection={<IPulse size={15} />} loading={testing} onClick={() => void test()}>
            测试连接
          </Button>
          {probe && (
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <Box c={probe.ok ? 'teal' : 'red'} style={{ display: 'flex', flexShrink: 0 }}>
                {probe.ok ? <ICheck size={15} /> : <IAlert size={15} />}
              </Box>
              <Text fz={13} c={probe.ok ? 'teal' : 'red'} style={{ minWidth: 0 }}>
                {probe.ok ? `连接正常 · ${probe.latencyMs}ms` : probe.error || '连接失败'}
              </Text>
            </Group>
          )}
        </Group>
      </SectionCard>

      <SectionCard icon={<IPlug size={17} />} title="联网工具" sub="搜索与抓取分别选供应商，可以混搭">
        <Box className="form-grid form-grid-2">
          <NativeSelect
            label="搜索（web_search）"
            data={PROVIDER_OPTIONS}
            value={searchProvider ?? ''}
            onChange={(e) => patchWeb({ searchProvider: (e.currentTarget.value || null) as WebProvider | null })}
          />
          <NativeSelect
            label="抓取（web_fetch）"
            data={PROVIDER_OPTIONS}
            value={fetchProvider ?? ''}
            onChange={(e) => patchWeb({ fetchProvider: (e.currentTarget.value || null) as WebProvider | null })}
          />
        </Box>

        {usesProvider('openrouter') && (
          <Alert color="gray" variant="light">
            OpenRouter 的工具由网关服务端执行，**只有当上面的模型 Base URL 指向 OpenRouter 时才生效**。
            换成直连 OpenAI 或本地模型的话，请改用 Tavily / Exa（那两个由本实例自己调用，与模型供应商无关）。
          </Alert>
        )}

        <Box className="form-grid form-grid-2">
          {searchProvider === 'openrouter' && (
            <NativeSelect
              label="搜索引擎"
              description="auto 交给 OpenRouter 自选"
              data={[...SEARCH_ENGINES]}
              value={webField('searchEngine')}
              onChange={(e) => patchWeb({ searchEngine: e.currentTarget.value })}
            />
          )}
          {fetchProvider === 'openrouter' && (
            <NativeSelect
              label="抓取引擎"
              description="不含 perplexity，它只做搜索"
              data={[...FETCH_ENGINES]}
              value={webField('fetchEngine')}
              onChange={(e) => patchWeb({ fetchEngine: e.currentTarget.value })}
            />
          )}
        </Box>

        {usesProvider('tavily') && (
          <SecretInput
            label="Tavily API Key"
            description="缺 key 时用到 Tavily 的那个能力不会注册"
            view={data.web.tavilyApiKey}
            draft={patch.web?.tavilyApiKey}
            disabled={lockSecrets}
            onChange={(tavilyApiKey) => patchWeb({ tavilyApiKey })}
          />
        )}
        {usesProvider('exa') && (
          <SecretInput
            label="Exa API Key"
            description="缺 key 时用到 Exa 的那个能力不会注册"
            view={data.web.exaApiKey}
            draft={patch.web?.exaApiKey}
            disabled={lockSecrets}
            onChange={(exaApiKey) => patchWeb({ exaApiKey })}
          />
        )}

        {anyWebEnabled && (
          <Box className="form-grid form-grid-2">
            <NumberInput
              label="单轮调用上限"
              description="防止一轮对话烧掉几十次搜索"
              min={1}
              max={25}
              value={webField('maxToolCalls')}
              onChange={(v) => patchWeb({ maxToolCalls: typeof v === 'number' ? v : undefined })}
            />
            <NumberInput
              label="单次结果条数"
              min={1}
              max={25}
              value={webField('maxResults')}
              onChange={(v) => patchWeb({ maxResults: typeof v === 'number' ? v : undefined })}
            />
          </Box>
        )}
      </SectionCard>

      <SectionCard icon={<IKey size={17} />} title="远端 MCP" sub="外部 Agent 连接本实例的独立口令">
        <SecretInput
          label="MCP Token"
          description="点「生成」即可，不用自己想。清除即关闭远端 MCP，与管理口令 ADMIN_TOKEN 相互独立。"
          view={data.mcpToken}
          draft={patch.mcpToken}
          disabled={lockSecrets}
          onChange={(mcpToken) => setPatch((p) => ({ ...p, mcpToken }))}
          extraActions={
            <>
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={() => setPatch((p) => ({ ...p, mcpToken: generateToken() }))}
              >
                {data.mcpToken.configured ? '重新生成' : '生成'}
              </Button>
              {typeof patch.mcpToken === 'string' && (
                <CopyButton value={patch.mcpToken} timeout={1600}>
                  {({ copied, copy }) => (
                    <Button variant="subtle" size="compact-xs" onClick={copy}>
                      {copied ? '已复制' : '复制'}
                    </Button>
                  )}
                </CopyButton>
              )}
            </>
          }
        />
        {typeof patch.mcpToken === 'string' && (
          <Alert color="orange" variant="light" icon={<IAlert size={16} />}>
            保存后这个口令就只剩掩码了，读不回来。现在把它复制出去填进 Claude Code / Codex 的连接配置——
            忘了就重新生成一个，两边同步改即可。
          </Alert>
        )}
      </SectionCard>

      <Card>
        <Text fw={600} mb={10}>
          运行环境
        </Text>
        <Group gap={8} wrap="wrap">
          {[
            ['运行时', data.diagnostics.runtime],
            ['存储', data.diagnostics.storage],
            ['脚本沙箱', data.diagnostics.sandbox],
            ['渲染器', data.diagnostics.renderers.join(' / ')],
            ['节点测活', data.diagnostics.healthcheck ? '支持' : '不支持'],
          ].map(([k, v]) => (
            <Badge key={k} variant="light" color="gray" size="lg" tt="none" fw={500}>
              {k}：{v}
            </Badge>
          ))}
        </Group>
      </Card>

      <Group justify="flex-end" gap={10}>
        {dirty && (
          <Button variant="default" disabled={saving} onClick={() => setPatch({})}>
            放弃修改
          </Button>
        )}
        <Button disabled={!dirty} loading={saving} onClick={() => void save()}>
          保存设置
        </Button>
      </Group>
    </Stack>
  )
}
