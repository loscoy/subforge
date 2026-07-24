import { describe, expect, it } from 'vitest'
import { normalizeToolCallIndexes } from './toolCallIndex.js'

const sse = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })

/** 按任意粒度切片喂进去，模拟真实网络分片 */
const sseChunked = (parts: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        for (const p of parts) controller.enqueue(enc.encode(p))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )

const read = async (res: Response) => await res.text()

const chunk = (toolCalls: unknown[]) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: toolCalls } }] })}\n\n`

const indexesOf = (text: string) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('data: {'))
    .flatMap((l) =>
      (JSON.parse(l.slice(5)).choices ?? []).flatMap((choice: { delta?: { tool_calls?: { index?: number }[] } }) =>
        (choice.delta?.tool_calls ?? []).map((c) => c.index),
      ),
    )

describe('normalizeToolCallIndexes', () => {
  it('把非 0 起始的 index 压到 0（provider-utils 稀疏数组崩溃的直接成因）', async () => {
    const body = chunk([{ index: 1, id: 'a', type: 'function', function: { name: 'f', arguments: '' } }]) + chunk([{ index: 1, function: { arguments: '{}' } }])
    expect(indexesOf(await read(normalizeToolCallIndexes(sse(body))))).toEqual([0, 0])
  })

  it('多个工具调用按首次出现顺序压成 0,1,2', async () => {
    const body =
      chunk([{ index: 3, id: 'a', function: { name: 'f' } }]) +
      chunk([{ index: 7, id: 'b', function: { name: 'g' } }]) +
      chunk([{ index: 3, function: { arguments: '{}' } }]) +
      chunk([{ index: 9, id: 'c', function: { name: 'h' } }])
    expect(indexesOf(await read(normalizeToolCallIndexes(sse(body))))).toEqual([0, 1, 0, 2])
  })

  it('本就稠密的 index 不改动', async () => {
    const body = chunk([{ index: 0, id: 'a', function: { name: 'f' } }, { index: 1, id: 'b', function: { name: 'g' } }])
    const out = await read(normalizeToolCallIndexes(sse(body)))
    expect(out).toBe(body)
  })

  it('不同 choice 各自独立编号', async () => {
    const body = `data: ${JSON.stringify({
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 5, id: 'a' }] } },
        { index: 1, delta: { tool_calls: [{ index: 8, id: 'b' }] } },
      ],
    })}\n\n`
    expect(indexesOf(await read(normalizeToolCallIndexes(sse(body))))).toEqual([0, 0])
  })

  it('index 缺席时不替它编号（上游会自己按长度追加）', async () => {
    const body = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: 'a', function: { name: 'f' } }] } }] })}\n\n`
    expect(await read(normalizeToolCallIndexes(sse(body)))).toBe(body)
  })

  it('[DONE]、纯文本增量、非 JSON 行原样透传', async () => {
    const body =
      `: keep-alive\n\n` +
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '你好' } }] })}\n\n` +
      `data: [DONE]\n\n`
    expect(await read(normalizeToolCallIndexes(sse(body)))).toBe(body)
  })

  it('行被网络分片切断也能正确改写', async () => {
    const body = chunk([{ index: 2, id: 'a', function: { name: 'f' } }])
    const cut = Math.floor(body.length / 2)
    const out = await read(normalizeToolCallIndexes(sseChunked([body.slice(0, cut), body.slice(cut)])))
    expect(indexesOf(out)).toEqual([0])
  })

  it('非 SSE 响应原样返回同一个对象', () => {
    const res = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
    expect(normalizeToolCallIndexes(res)).toBe(res)
  })
})
