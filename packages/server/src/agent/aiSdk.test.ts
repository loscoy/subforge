import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { NodeVmRunner } from '../sandbox/nodeVm.js'
import { InMemoryStorage } from '../storage/index.js'
import { AiSdkAgentRunner } from './aiSdk.js'

const cfg = { baseURL: 'http://x', apiKey: 'k', model: 'm' }

const genResult = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1 },
    outputTokens: { total: 1, text: 1 },
  },
  warnings: [],
})

/** 每一步都只吐一个 tool-call、从不收尾——用来逼出 stopWhen 的步数上限 */
const loopingToolCallStream = () => {
  let seq = 0
  return async () => ({
    stream: new ReadableStream({
      start(controller) {
        seq += 1
        controller.enqueue({ type: 'stream-start' as const, warnings: [] })
        controller.enqueue({
          type: 'tool-call' as const,
          toolCallId: `call-${seq}`,
          toolName: 'list_profiles',
          input: '{}',
        })
        controller.enqueue({
          type: 'finish' as const,
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } },
        })
        controller.close()
      },
    }),
  })
}

describe('AiSdkAgentRunner（mock 模型）', () => {
  it('运行后把 user/assistant 写入记忆，且系统提示含长期记忆', async () => {
    const storage = new InMemoryStorage()
    storage.setWorkingMemory('用户偏好把香港节点单独分组')
    let capturedSystem = ''
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        const sys = opts.prompt.find((m: any) => m.role === 'system')
        capturedSystem = typeof sys?.content === 'string' ? sys.content : JSON.stringify(sys?.content)
        return genResult('好的，已按你的偏好处理。')
      },
    })
    const runner = new AiSdkAgentRunner({ storage, runner: new NodeVmRunner() }, cfg, 5, () => model)

    const reply = await runner.run('thread-1', '帮我整理一下节点')
    expect(reply.text).toContain('已按你的偏好')
    // 长期记忆注入系统提示
    expect(capturedSystem).toContain('香港节点单独分组')
    // 会话历史落库
    const msgs = await storage.listMessages('thread-1')
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0]!.content).toBe('帮我整理一下节点')
  })

  it('第二轮对话能带上历史', async () => {
    const storage = new InMemoryStorage()
    let lastPromptLen = 0
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        lastPromptLen = opts.prompt.filter((m: any) => m.role === 'user' || m.role === 'assistant').length
        return genResult('ok')
      },
    })
    const runner = new AiSdkAgentRunner({ storage, runner: new NodeVmRunner() }, cfg, 5, () => model)
    await runner.run('t', '第一句')
    await runner.run('t', '第二句')
    // 第二轮：历史 user+assistant(第一轮) + 本轮 user = 3
    expect(lastPromptLen).toBe(3)
  })

  it('历史里的工具调用与结果会还原成 tool-call / tool-result 送回模型', async () => {
    const storage = new InMemoryStorage()
    await storage.addMessage({ id: 'u1', threadId: 't', role: 'user', content: '看看 p1', createdAt: 1 })
    await storage.addMessage({
      id: 'a1',
      threadId: 't',
      role: 'assistant',
      content: '看过了。',
      trace: { steps: [{ id: 'call-1', tool: 'get_profile', args: { id: 'p1' }, result: { configRev: 'rev-abc' } }] },
      createdAt: 2,
    })
    let prompt: any[] = []
    const model = new MockLanguageModelV4({
      doGenerate: async (opts: any) => {
        prompt = opts.prompt
        return genResult('ok')
      },
    })
    const runner = new AiSdkAgentRunner({ storage, runner: new NodeVmRunner() }, cfg, 5, () => model)
    await runner.run('t', '接着改')

    const call = prompt.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).find((p: any) => p.type === 'tool-call')
    expect(call).toMatchObject({ toolCallId: 'call-1', toolName: 'get_profile', input: { id: 'p1' } })
    const result = prompt.find((m: any) => m.role === 'tool')
    // 指纹这类关键信息必须原样回到模型手里，否则下一轮的 read-before-write 只能重读
    expect(JSON.stringify(result.content)).toContain('rev-abc')
  })

  it('撞上步数上限时补一句说明，而不是留一条空 assistant 消息', async () => {
    const storage = new InMemoryStorage()
    const model = new MockLanguageModelV4({ doStream: loopingToolCallStream() as any })
    const runner = new AiSdkAgentRunner({ storage, runner: new NodeVmRunner() }, cfg, 3, () => model)

    const events = []
    for await (const ev of runner.runStream('t', '帮我改配置')) events.push(ev)

    const done = events.find((e) => e.type === 'done') as { type: 'done'; text: string }
    expect(done.text).toContain('上限 3 步')
    // 落库的 assistant 消息不是空串——空 content 会被不少 provider 在下一轮直接拒收
    const msgs = await storage.listMessages('t')
    expect(msgs.at(-1)!.role).toBe('assistant')
    expect(msgs.at(-1)!.content).toContain('上限 3 步')
  })
})
