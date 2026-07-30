import { RE2JS } from 're2js'

const MAX_PATTERN_LENGTH = 1024

export interface LinearRegex {
  test(input: string): boolean
  replaceAll(input: string, replacement: string): string
}

/** 编译来自配置/脚本参数的不可信正则，保证匹配时间随输入长度线性增长。 */
export function compileLinearRegex(pattern: string): LinearRegex {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`正则表达式过长（上限 ${MAX_PATTERN_LENGTH} 字符）`)
  }
  try {
    const compiled = RE2JS.compile(pattern)
    return {
      test: (input) => compiled.test(input),
      replaceAll: (input, replacement) => compiled.matcher(input).replaceAll(replacement),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`正则表达式不受支持：${message}`)
  }
}
