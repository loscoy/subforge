/**
 * 回程规整：把 OpenAI 兼容 SSE 响应里的 `tool_calls[].index` 改写成从 0 开始的稠密序号。
 *
 * 为什么需要：上游 @ai-sdk/provider-utils 的 StreamingToolCallTracker 用
 * `toolCalls[index] = …` 存中间态。provider 若把 index 从非 0 开始、或跳号
 * （OpenRouter 转发的部分模型、跨 step 维持全局计数器的网关都这么发），
 * 数组里就留下空洞；它的 flush() 用 `for…of` 遍历，迭代到空洞会读到 undefined，
 * 抛 `Cannot read properties of undefined (reading 'hasFinished')`——
 * 这个异常发生在 TransformStream 的 flush 里，整段流式对话当场中断。
 * 见 provider-utils 5.0.12 的 streaming-tool-call-tracker.ts。
 *
 * 我们在传输层把序号压密，上游拿到的永远是稠密数组，空洞无从产生。
 * 只用 Web Streams + TextEncoder/Decoder，Node 与 Workers 通用。
 */

const DATA = 'data:'

/** choice 序号 → （provider 原始 tool_call index → 稠密 index）。映射只在单个响应内有效。 */
type IndexMaps = Map<number, Map<number, number>>

/** 改写一条 SSE data 载荷；没动过就原样返回入参（调用方据此决定是否重建该行）。 */
function remapPayload(json: string, maps: IndexMaps): string {
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return json // 不是 JSON 就不碰（心跳、注释、私有扩展）
  }
  const choices = (payload as { choices?: unknown })?.choices
  if (!Array.isArray(choices)) return json

  let touched = false
  for (const choice of choices) {
    const calls = (choice as { delta?: { tool_calls?: unknown } })?.delta?.tool_calls
    if (!Array.isArray(calls)) continue
    const choiceIndex = typeof (choice as { index?: unknown }).index === 'number' ? (choice as { index: number }).index : 0
    let map = maps.get(choiceIndex)
    if (!map) {
      map = new Map()
      maps.set(choiceIndex, map)
    }
    for (const call of calls as { index?: unknown }[]) {
      // index 缺席时上游会自己按 toolCalls.length 追加，本就是稠密的，不要替它编号
      if (typeof call?.index !== 'number') continue
      let dense = map.get(call.index)
      if (dense === undefined) {
        dense = map.size
        map.set(call.index, dense)
      }
      if (dense !== call.index) {
        call.index = dense
        touched = true
      }
    }
  }
  return touched ? JSON.stringify(payload) : json
}

/**
 * 包一层响应体。非 SSE（含错误响应、非流式 JSON）原样放行，
 * 保证这层只在真正的流式场景里介入。
 */
export function normalizeToolCallIndexes(res: Response): Response {
  const body = res.body
  if (!body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) return res

  const maps: IndexMaps = new Map()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''

  const rewriteLine = (line: string): string => {
    if (!line.startsWith(DATA)) return line
    const cr = line.endsWith('\r')
    const raw = (cr ? line.slice(0, -1) : line).slice(DATA.length).trim()
    if (!raw.startsWith('{')) return line // [DONE]、空载荷等
    const next = remapPayload(raw, maps)
    return next === raw ? line : `${DATA} ${next}${cr ? '\r' : ''}`
  }

  // 按整行处理：一个网络分片可能切断某一行，尾部残行留到下一片再拼
  const rewriteLines = (text: string) => text.split('\n').map(rewriteLine).join('\n')

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      const cut = pending.lastIndexOf('\n')
      if (cut < 0) return
      const complete = pending.slice(0, cut + 1)
      pending = pending.slice(cut + 1)
      controller.enqueue(encoder.encode(rewriteLines(complete)))
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending) controller.enqueue(encoder.encode(rewriteLines(pending)))
    },
  })

  return new Response(body.pipeThrough(transform), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}
