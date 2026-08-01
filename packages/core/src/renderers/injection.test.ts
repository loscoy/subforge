import { describe, expect, it } from 'vitest'
import { parseSubscription } from '../parsers/index.js'
import { runPipeline } from '../pipeline.js'
import { sanitizeNodeName } from '../script/utils.js'
import { nodeToSurge, surgeSafeName, surgeSafeValue } from './surge.js'

/**
 * 节点名来自订阅原文（不可信）。URI 片段会经 decodeURIComponent 解码，
 * 于是 `%0A` 变成真正的换行——对按行拼接的 Surge 配置就是注入。
 */
const MALICIOUS_URI =
  'trojan://pw@1.2.3.4:443#Evil%0A%5BGeneral%5D%0Aexternal-controller%20%3D%200.0.0.0%3A6170'

const profile = { groups: [{ name: 'G', type: 'select' as const, includeAll: true }], rules: ['MATCH,G'] }

describe('节点名注入防护', () => {
  it('解析后的原始名字确实带换行（确认攻击输入有效）', () => {
    const nodes = parseSubscription(MALICIOUS_URI)
    expect(nodes[0]!.name).toContain('\n')
  })

  it('sanitizeNodeName 剥掉换行与控制字符', () => {
    expect(sanitizeNodeName('Evil\n[General]')).toBe('Evil[General]')
    expect(sanitizeNodeName('a\r\nb\tc')).toBe('abc')
    expect(sanitizeNodeName('\u0000\u009Fx')).toBe('x')
  })

  it('全是控制字符时回落到占位名，不产生空名', () => {
    expect(sanitizeNodeName('\n\r\t')).toBe('未命名节点')
  })

  it('正常名字（含 emoji / 中文 / 空格）不被改动', () => {
    expect(sanitizeNodeName('🇭🇰 香港 01')).toBe('🇭🇰 香港 01')
  })

  it('节点名超长时截断', () => {
    expect(sanitizeNodeName('x'.repeat(400))).toHaveLength(256)
  })

  it('surgeSafeName 中和 Surge 的字段分隔符与行首元字符', () => {
    expect(surgeSafeName('a,b=c')).toBe('a-b-c')
    expect(surgeSafeName('[General]')).toBe('_[General]')
    expect(surgeSafeName('#comment')).toBe('_#comment')
  })

  it('surgeSafeValue 去掉逗号与控制字符，但保留 base64 的 = 填充', () => {
    expect(surgeSafeValue('pw, obfs=http')).toBe('pw obfs=http')
    expect(surgeSafeValue('aGVsbG8=')).toBe('aGVsbG8=')
    expect(surgeSafeValue('a\nb')).toBe('ab')
  })

  it('值字段（密码 / sni）里的逗号不能撑出新字段', () => {
    // 名字干净，攻击载荷藏在密码里——只清洗名字是拦不住的
    const line = nodeToSurge({
      name: 'HK',
      type: 'trojan',
      server: '1.2.3.4',
      port: 443,
      password: 'pw, ws=true, ws-path=/evil',
      meta: {},
    })
    // 载荷仍以字面量留在密码里，但不再是独立字段——Surge 按逗号切，切不出 ws-path
    const fields = line.split(',').map((s) => s.trim())
    expect(fields).toHaveLength(4) // name=trojan / server / port / password
    expect(fields.some((f) => f.startsWith('ws-path') || f.startsWith('ws='))).toBe(false)
  })

  it.each(['surge', 'mihomo', 'singbox'])('%s 渲染不产生注入的配置行', async (target) => {
    const out = await runPipeline({ rawSubscriptions: [MALICIOUS_URI], target, profile })
    // 注入的载荷不得成为独立的一行指令
    expect(out.config).not.toMatch(/^\s*external-controller\s*=/m)
    // [General] 段最多只有渲染器自己写的那一个（surge 有，其余没有）
    expect(out.config.split('\n').filter((l) => l.trim() === '[General]').length).toBeLessThanOrEqual(1)
  })

  it('surge：组成员引用与 [Proxy] 段条目名保持一致', async () => {
    const out = await runPipeline({
      rawSubscriptions: ['trojan://pw@1.2.3.4:443#HK,01'],
      target: 'surge',
      profile,
    })
    const proxyLine = out.config.split('\n').find((l) => l.includes('trojan,'))!
    const entryName = proxyLine.split(' = ')[0]!
    const groupLine = out.config.split('\n').find((l) => l.startsWith('G = select'))!
    expect(entryName).toBe('HK-01')
    expect(groupLine).toContain(entryName)
  })
})
