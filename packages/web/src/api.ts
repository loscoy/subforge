import type { AgentEvent, AgentReply, Meta, PreviewResult, Profile, Subscription } from './types'

/** 管理口令（若服务端设了 ADMIN_TOKEN），存 localStorage。 */
export function getToken(): string {
  return localStorage.getItem('subforge_admin_token') || ''
}
export function setToken(t: string) {
  localStorage.setItem('subforge_admin_token', t)
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(getToken() ? { 'X-Admin-Token': getToken() } : {}),
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  meta: () => req<Meta>('/meta'),

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
  output: (id: string) => req<{ ok: boolean; config?: string; error?: string }>(`/profiles/${id}/output`),
  healthcheck: (id: string) =>
    req<{ total: number; alive: number; results: { name: string; latency: number | null }[] }>(
      `/profiles/${id}/healthcheck`,
      { method: 'POST' },
    ),
  versions: (id: string) => req<{ id: string; note?: string; createdAt: number }[]>(`/profiles/${id}/versions`),
  rollback: (id: string, versionId: string) =>
    req<Profile>(`/profiles/${id}/rollback`, { method: 'POST', body: JSON.stringify({ versionId }) }),

  agentMessages: (threadId: string) =>
    req<{ role: string; content: string }[]>(`/agent/messages/${threadId}`),
  agentChat: (threadId: string, message: string, context?: string) =>
    req<AgentReply>('/agent/chat', { method: 'POST', body: JSON.stringify({ threadId, message, context }) }),

  /** 流式对话：SSE，逐事件回调。返回一个可 await 的 Promise（结束时 resolve）。 */
  async agentStream(
    threadId: string,
    message: string,
    context: string | undefined,
    on: (ev: AgentEvent) => void,
  ): Promise<void> {
    const res = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(getToken() ? { 'X-Admin-Token': getToken() } : {}) },
      body: JSON.stringify({ threadId, message, context }),
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
