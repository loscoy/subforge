import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { fallbackTitle, generateSessionTitle } from './title.js'

const cfg = { baseURL: 'http://x', apiKey: 'k', model: 'm' }
const gen = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } },
  warnings: [],
})
const model = (text: string) => () => new MockLanguageModelV4({ doGenerate: async () => gen(text) })

describe('fallbackTitle', () => {
  it('压空白、截断超长、空串给「新对话」', () => {
    expect(fallbackTitle('  帮我  分组  ')).toBe('帮我 分组')
    expect(fallbackTitle('')).toBe('新对话')
    expect(fallbackTitle('一二三四五六七八九十一二三四五六七八九十甲乙丙')).toBe('一二三四五六七八九十一二三四五六七八九十…')
  })
})

describe('generateSessionTitle', () => {
  it('采用模型返回并清洗掉引号/前缀', async () => {
    expect(await generateSessionTitle(cfg, '随便', model('「香港节点分组」'))).toBe('香港节点分组')
    expect(await generateSessionTitle(cfg, '随便', model('标题：加 Netflix 分流'))).toBe('加 Netflix 分流')
  })

  it('超长模型输出被截断', async () => {
    expect(await generateSessionTitle(cfg, '随便', model('这是一个非常非常非常冗长啰嗦的标题超过二十字上限了'))).toHaveLength(20)
  })

  it('模型抛错时降级成截断首句', async () => {
    const boom = () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error('connect ECONNREFUSED')
        },
      })
    expect(await generateSessionTitle(cfg, '给香港节点分组', boom)).toBe('给香港节点分组')
  })

  it('模型返回空串时降级成截断首句', async () => {
    expect(await generateSessionTitle(cfg, '给香港节点分组', model('  '))).toBe('给香港节点分组')
  })
})
