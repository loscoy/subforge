import { MockLanguageModelV1 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { NodeVmRunner } from '../sandbox/nodeVm.js'
import { InMemoryStorage } from '../storage/index.js'
import { AiSdkAgentRunner } from './aiSdk.js'

const cfg = { baseURL: 'http://x', apiKey: 'k', model: 'm' }

describe('AiSdkAgentRunner（mock 模型）', () => {
  it('运行后把 user/assistant 写入记忆，且系统提示含工作记忆', async () => {
    const storage = new InMemoryStorage()
    storage.setWorkingMemory('用户偏好把香港节点单独分组')
    let capturedSystem = ''
    const model = new MockLanguageModelV1({
      doGenerate: async (opts: any) => {
        const sys = opts.prompt.find((m: any) => m.role === 'system')
        capturedSystem = typeof sys?.content === 'string' ? sys.content : JSON.stringify(sys?.content)
        return {
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          text: '好的，已按你的偏好处理。',
          rawCall: { rawPrompt: null, rawSettings: {} },
        }
      },
    })
    const runner = new AiSdkAgentRunner({ storage, runner: new NodeVmRunner() }, cfg, 5, () => model)

    const reply = await runner.run('thread-1', '帮我整理一下节点')
    expect(reply.text).toContain('已按你的偏好')
    // 工作记忆注入系统提示
    expect(capturedSystem).toContain('香港节点单独分组')
    // 会话历史落库
    const msgs = storage.listMessages('thread-1')
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0]!.content).toBe('帮我整理一下节点')
  })

  it('第二轮对话能带上历史', async () => {
    const storage = new InMemoryStorage()
    let lastPromptLen = 0
    const model = new MockLanguageModelV1({
      doGenerate: async (opts: any) => {
        lastPromptLen = opts.prompt.filter((m: any) => m.role === 'user' || m.role === 'assistant').length
        return {
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          text: 'ok',
          rawCall: { rawPrompt: null, rawSettings: {} },
        }
      },
    })
    const runner = new AiSdkAgentRunner({ storage, runner: new NodeVmRunner() }, cfg, 5, () => model)
    await runner.run('t', '第一句')
    await runner.run('t', '第二句')
    // 第二轮：历史 user+assistant(第一轮) + 本轮 user = 3
    expect(lastPromptLen).toBe(3)
  })
})
