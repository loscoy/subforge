import type { AgentModelConfig } from './runner.js'

/**
 * 「测试连接」：用候选的 base URL / key / model 打一次最小请求，
 * 让用户在保存前就知道配置对不对，而不是存完去聊天面板碰运气。
 *
 * 只用 fetch，不引 AI SDK：边缘可移植，且探测本身不需要流式/工具那套。
 */

export interface ProbeResult {
  ok: boolean
  /** 上游 HTTP 状态码（拿到响应才有） */
  status?: number
  latencyMs: number
  error?: string
}

const TIMEOUT_MS = 15_000

/**
 * 不做私网地址校验（不同于 net.ts::assertPublicHttpUrl）：本地大模型
 * （Ollama / LM Studio 等 http://localhost:11434/v1）是自托管的一等场景，
 * 而这个端点本身在 ADMIN_TOKEN 之后——能调它的人已经能跑脚本了，
 * 拦私网地址挡不住真正的威胁，只会挡掉正常用法。
 */
export async function probeAgentModel(cfg: AgentModelConfig): Promise<ProbeResult> {
  const started = Date.now()
  const elapsed = () => Date.now() - started

  let endpoint: URL
  try {
    endpoint = new URL(`${cfg.baseURL.replace(/\/+$/, '')}/chat/completions`)
  } catch {
    return { ok: false, latencyMs: elapsed(), error: 'Base URL 格式不正确' }
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    return { ok: false, latencyMs: elapsed(), error: 'Base URL 必须是 http(s)' }
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return { ok: true, status: res.status, latencyMs: elapsed() }
    const detail = (await res.text()).slice(0, 300)
    return { ok: false, status: res.status, latencyMs: elapsed(), error: detail || `HTTP ${res.status}` }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return { ok: false, latencyMs: elapsed(), error: timedOut ? `请求超时（${TIMEOUT_MS / 1000}s）` : message }
  }
}
