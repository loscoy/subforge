import { describe, expect, it } from 'vitest'
import { compileLinearRegex, tryCompileLinearRegex } from './safeRegex.js'

describe('compileLinearRegex', () => {
  it('RE2 能编译的模式走线性引擎', () => {
    const re = compileLinearRegex('香港|港|HK')
    expect(re.test('香港 01')).toBe(true)
    expect(re.test('US 01')).toBe(false)
  })

  it('灾难性回溯模式在 RE2 下依然是线性时间', () => {
    const re = compileLinearRegex('(a+)+$')
    const started = Date.now()
    expect(re.test('a'.repeat(2000) + 'b')).toBe(false)
    // 原生 RegExp 在几十个字符上就会卡死，这里必须瞬间返回
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('负向环视（RE2 不支持）回退到原生引擎而不是报错', () => {
    // Clash 生态最常见的排除写法，存量配置大量依赖
    const re = compileLinearRegex('^(?!.*(?:回国|游戏)).*$')
    expect(re.test('HK 01')).toBe(true)
    expect(re.test('回国专线')).toBe(false)
  })

  it('正向环视同样可用', () => {
    const re = compileLinearRegex('^(?=.*HK).*$')
    expect(re.test('a HK b')).toBe(true)
    expect(re.test('US 01')).toBe(false)
  })

  it('环视 + 嵌套量词的组合被拒绝（回退路径不能引入 ReDoS）', () => {
    expect(() => compileLinearRegex('^(?!x)(a+)+$')).toThrow(/回溯风险/)
  })

  it('超长模式被拒绝', () => {
    expect(() => compileLinearRegex('a'.repeat(2000))).toThrow(/过长/)
  })

  it('回退路径对超长输入按不匹配处理，限制最坏情况', () => {
    const re = compileLinearRegex('^(?!x).*$')
    expect(re.test('ok')).toBe(true)
    expect(re.test('a'.repeat(2000))).toBe(false)
  })

  it('replaceAll 在两条路径上都可用', () => {
    expect(compileLinearRegex('\\d+').replaceAll('a1b22c', '#')).toBe('a#b#c')
    expect(compileLinearRegex('(?!x)b').replaceAll('abcb', '-')).toBe('a-c-')
  })
})

describe('tryCompileLinearRegex', () => {
  it('编译失败返回 undefined 而不抛错', () => {
    expect(tryCompileLinearRegex('^(?!x)(a+)+$')).toBeUndefined()
    expect(tryCompileLinearRegex('[unclosed')).toBeUndefined()
  })

  it('编译成功正常返回', () => {
    expect(tryCompileLinearRegex('HK')?.test('HK 01')).toBe(true)
  })
})
