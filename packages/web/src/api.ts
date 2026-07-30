import type {
  AgentEvent,
  AgentReply,
  AgentTrace,
  Meta,
  PreviewResult,
  ProbeResult,
  Profile,
  Session,
  Settings,
  SettingsPatch,
  Subscription,
} from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // 鉴权走 HttpOnly Cookie 会话（同源自动携带），无需手动加头
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

export interface AuthStatus {
  initialized: boolean
  authenticated: boolean
  username?: string
}

export const authApi = {
  status: () => req<AuthStatus>('/auth/status'),
  setup: (b: { username: string; password: string }) =>
    req<{ ok: boolean }>('/auth/setup', { method: 'POST', body: JSON.stringify(b) }),
  login: (b: { username: string; password: string }) =>
    req<{ ok: boolean }>('/auth/login', { method: 'POST', body: JSON.stringify(b) }),
  logout: () => req<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  changePassword: (b: { oldPassword: string; newPassword: string }) =>
    req<{ ok: boolean }>('/auth/password', { method: 'POST', body: JSON.stringify(b) }),
}

/** 从 req 抛出的 `${status}: ${body}` 错误里抠出服务端中文 error 文案 */
export function apiErrorText(e: unknown): string {
  const raw = String(e instanceof Error ? e.message : e)
  const body = raw.replace(/^\d+:\s*/, '')
  try {
    return (JSON.parse(body) as { error?: string }).error || raw
  } catch {
    return raw
  }
}

export const api = {
  meta: () => req<Meta>('/meta'),

  getSettings: () => req<Settings>('/settings'),
  saveSettings: (patch: SettingsPatch) => req<Settings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  testAgent: (candidate: { baseURL?: string; model?: string; apiKey?: string }) =>
    req<ProbeResult>('/settings/test', { method: 'POST', body: JSON.stringify(candidate) }),

  listSubscriptions: () => req<Subscription[]>('/subscriptions'),
  createSubscription: (b: Partial<Subscription>) =>
    req<Subscription>('/subscriptions', { method: 'POST', body: JSON.stringify(b) }),
  updateSubscription: (id: string, b: Partial<Subscription>) =>
    req<Subscription>(`/subscriptions/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteSubscription: (id: string) => req(`/subscriptions/${id}`, { method: 'DELETE' }),
  refreshSubscription: (id: string) => req<Subscription>(`/subscriptions/${id}/refresh`, { method: 'POST' }),

  listProfiles: () => req<Profile[]>('/profiles'),
  getProfile: (id: string) => req<Profile>(`/profiles/${id}`),
  createProfile: (b: Partial<Profile>) => req<Profile>('/profiles', { method: 'POST', body: JSON.stringify(b) }),
  updateProfile: (id: string, b: Partial<Profile>) =>
    req<Profile>(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteProfile: (id: string) => req(`/profiles/${id}`, { method: 'DELETE' }),
  preview: (id: string, script: string) =>
    req<PreviewResult>(`/profiles/${id}/preview`, { method: 'POST', body: JSON.stringify({ script }) }),
  output: (id: string) =>
    req<{ ok: boolean; config?: string; error?: string; warnings?: string[] }>(`/profiles/${id}/output`),
  healthcheck: (id: string) =>
    req<{ total: number; alive: number; results: { name: string; latency: number | null }[] }>(
      `/profiles/${id}/healthcheck`,
      { method: 'POST' },
    ),
  versions: (id: string) => req<{ id: string; note?: string; createdAt: number }[]>(`/profiles/${id}/versions`),
  rollback: (id: string, versionId: string) =>
    req<Profile>(`/profiles/${id}/rollback`, { method: 'POST', body: JSON.stringify({ versionId }) }),

  // 会话：profileId=null 取全局组，否则取该配置档的会话组
  agentSessions: (profileId: string | null) =>
    req<Session[]>(`/agent/sessions${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`),
  createAgentSession: (profileId: string | null, firstMessage: string) =>
    req<Session>('/agent/sessions', {
      method: 'POST',
      body: JSON.stringify({ profileId: profileId ?? undefined, firstMessage }),
    }),
  renameAgentSession: (id: string, title: string) =>
    req<Session>(`/agent/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteAgentSession: (id: string) => req<{ ok: boolean }>(`/agent/sessions/${id}`, { method: 'DELETE' }),

  agentMessages: (threadId: string) =>
    req<{ role: string; content: string; tools?: string[]; trace?: AgentTrace }[]>(`/agent/messages/${threadId}`),
  agentChat: (threadId: string, message: string, context?: string) =>
    req<AgentReply>('/agent/chat', { method: 'POST', body: JSON.stringify({ threadId, message, context }) }),

  /**
   * 流式对话：SSE，逐事件回调。返回一个可 await 的 Promise（结束时 resolve）。
   * 传入 signal 并 abort 时中止请求（用户点停止）——此时 fetch/read 抛 AbortError，
   * 由调用方按「主动取消」处理，而非报错。
   */
  async agentStream(
    threadId: string,
    message: string,
    context: string | undefined,
    on: (ev: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threadId, message, context }),
      signal,
    })
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '')
      throw new Error(`${res.status}: ${t}`)
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const chunks = buf.split('\n\n')
      buf = chunks.pop() || ''
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        try { on(JSON.parse(line.slice(5).trim()) as AgentEvent) } catch { /* ignore */ }
      }
    }
  },

  listTemplates: () => req<ServerTemplate[]>('/templates'),
  createTemplate: (b: Partial<ServerTemplate>) => req<ServerTemplate>('/templates', { method: 'POST', body: JSON.stringify(b) }),
  deleteTemplate: (id: string) => req(`/templates/${id}`, { method: 'DELETE' }),
  applyTemplate: (id: string, profileId: string) =>
    req<Profile>(`/templates/${id}/apply`, { method: 'POST', body: JSON.stringify({ profileId }) }),
}

export interface ServerTemplate {
  id: string
  name: string
  description?: string
  profile: import('./types').ConversionProfile
  script?: string
  createdAt: number
  updatedAt: number
}
