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
 * 而这个端点本身在账号会话鉴权之后——能调它的人已经能跑脚本了，
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
      redirect: 'manual',
    })
    if (res.ok) return { ok: true, status: res.status, latencyMs: elapsed() }
    // 不读取、更不回显上游正文：Base URL 是全仓库唯一豁免私网校验的抓取路径（本地大模型），
    // 回显正文会把它变成能读任意内网服务响应的 SSRF。用状态码给出可操作的提示即可。
    await res.body?.cancel().catch(() => undefined)
    return { ok: false, status: res.status, latencyMs: elapsed(), error: probeHint(res.status) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return { ok: false, latencyMs: elapsed(), error: timedOut ? `请求超时（${TIMEOUT_MS / 1000}s）` : message }
  }
}

/** 按状态码给出可操作提示——不依赖上游正文，也就不会把内网响应带回前端。 */
function probeHint(status: number): string {
  if (status === 401 || status === 403) return `鉴权失败（HTTP ${status}）：检查 API Key`
  if (status === 404) return `找不到接口或模型（HTTP ${status}）：检查 Base URL 是否以 /v1 结尾、模型名是否正确`
  if (status === 429) return `被限流（HTTP ${status}）：稍后重试或检查配额`
  if (status >= 500) return `模型服务异常（HTTP ${status}）`
  return `模型服务返回 HTTP ${status}`
}
