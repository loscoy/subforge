import { RE2JS } from 're2js'

/**
 * 编译来自配置 / 脚本参数的不可信正则，避免灾难性回溯（ReDoS）。
 *
 * 两级策略：
 * 1. 优先用 RE2（线性时间，天然免疫回溯）——绝大多数筛选式正则都能编译。
 * 2. RE2 不支持环视与反向引用，而 `^(?!.*(?:回国|游戏)).*$` 这类负向环视是
 *    Clash/mihomo 生态排除节点的惯用写法，直接拒绝会让存量配置不可用。
 *    因此仅当模式**不含**易回溯构造时，回退到原生 `RegExp`，并对输入长度设上限
 *    ——环视本身不是回溯根因，嵌套/歧义量词才是。
 *
 * 回退路径是「尽力而为」而非严格保证：静态检查偏保守（宁可拒绝也不放过），
 * 加上输入长度上限，把最坏情况约束在可接受范围内。
 */

const MAX_PATTERN_LENGTH = 1024
/** 回退到原生 RegExp 时的单次输入长度上限。节点名远短于此，超长者按不匹配处理。 */
const MAX_FALLBACK_INPUT_LENGTH = 1024

export interface LinearRegex {
  test(input: string): boolean
  replaceAll(input: string, replacement: string): string
}

/** RE2 无法编译时才用到：判断模式是否**明显**存在易回溯构造。 */
function hasBacktrackRisk(pattern: string): boolean {
  // 去掉转义字符与字符类内容，避免把 `\+` 或 `[+*]` 里的量词当成真量词。
  const stripped = pattern.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'C')
  return (
    // 嵌套量词：(a+)+ / (a*)* / (a{1,3})+ 等——回溯爆炸的典型形态
    /\([^()]*[+*}][^()]*\)\s*[+*{]/.test(stripped) ||
    // 相邻的两个开放量词：.*.* / .+.+
    /[.\w)\]][+*]\s*[.\w([][*+]/.test(stripped) ||
    // 交替分支自身带量词且整体再量化：(a|b)+ 形式下分支可重叠
    /\([^()]*\|[^()]*\)\s*[+*]\s*[+*{]/.test(stripped)
  )
}

/**
 * 编译不可信正则。RE2 编译成功即返回线性引擎；否则在通过安全检查后回退原生引擎。
 * 两者都不可用时抛错——调用方应捕获并降级，不要让单个坏正则打挂整次渲染。
 */
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
  } catch (re2Error) {
    // RE2 不支持环视/反向引用等语法，尝试有界回退，保住存量配置的可用性。
    if (hasBacktrackRisk(pattern)) {
      throw new Error(`正则表达式不受支持且存在回溯风险：${pattern.slice(0, 80)}`)
    }
    let native: RegExp
    let globalNative: RegExp
    try {
      native = new RegExp(pattern)
      globalNative = new RegExp(pattern, 'g')
    } catch {
      const message = re2Error instanceof Error ? re2Error.message : String(re2Error)
      throw new Error(`正则表达式不受支持：${message}`)
    }
    const bounded = (input: string) => input.length <= MAX_FALLBACK_INPUT_LENGTH
    return {
      test: (input) => (bounded(input) ? native.test(input) : false),
      replaceAll: (input, replacement) => {
        if (!bounded(input)) return input
        globalNative.lastIndex = 0
        return input.replace(globalNative, replacement)
      },
    }
  }
}

/** 编译失败时返回 undefined 而不抛错，供「坏正则应降级而非中断渲染」的调用方使用。 */
export function tryCompileLinearRegex(pattern: string): LinearRegex | undefined {
  try {
    return compileLinearRegex(pattern)
  } catch {
    return undefined
  }
}
