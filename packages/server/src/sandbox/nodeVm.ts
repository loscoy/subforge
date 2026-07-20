import vm from 'node:vm'
import { scriptUtils, type ProxyNode, type ScriptResult, type ScriptRunner } from '@subforge/core'

const DEFAULT_TIMEOUT_MS = 3000

/**
 * 基于 node:vm 的脚本执行器。
 *
 * 隔离级别：脚本在一个裸 context 中运行，无法访问外层作用域、`process`、`require`、
 * `globalThis` 上的 Node API——只能看到我们显式注入的 nodes / utils / console / params。
 * 同步无限循环由 vm 的 `timeout` 中断；异步挂起由 Promise.race 兜底。
 *
 * 注意：node:vm 不是强安全边界。面向「单部署者自用」足够；若要执行不可信第三方脚本，
 * 换 isolated-vm（Node）或 QuickJS-wasm（serverless）实现同一 ScriptRunner 接口即可。
 */
export class NodeVmRunner implements ScriptRunner {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  async run(code: string, nodes: ProxyNode[], params: Record<string, string> = {}): Promise<ScriptResult> {
    const start = performance.now()
    const logs: string[] = []
    const capture =
      (level: string) =>
      (...args: unknown[]) => {
        logs.push(`[${level}] ${args.map(fmt).join(' ')}`)
      }
    const sandboxConsole = { log: capture('log'), warn: capture('warn'), error: capture('error') }

    // 深拷贝输入，隔离脚本对原数组的副作用
    const input: ProxyNode[] = structuredClone(nodes)

    const context = vm.createContext({
      nodes: input,
      utils: scriptUtils,
      console: sandboxConsole,
      params,
      structuredClone,
      // 常用只读全局
      JSON,
      Math,
      Object,
      Array,
      String,
      Number,
      Boolean,
      RegExp,
      Date,
      Map,
      Set,
    })

    try {
      // 包成 async 函数体，允许 await 与 return
      const wrapped = `(async () => {\n${code}\n})()`
      const script = new vm.Script(wrapped, { filename: 'user-script.js' })
      const resultPromise: Promise<unknown> = script.runInContext(context, { timeout: this.timeoutMs })

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`脚本执行超时（>${this.timeoutMs}ms）`)), this.timeoutMs),
      )
      const returned = await Promise.race([resultPromise, timeout])

      // 脚本可 return 新数组；未 return 则采用被就地修改的 input
      const out = Array.isArray(returned) ? (returned as ProxyNode[]) : input
      if (!Array.isArray(out)) throw new Error('脚本必须返回 ProxyNode 数组或不返回')

      return { ok: true, nodes: out, logs, durationMs: performance.now() - start }
    } catch (err) {
      return {
        ok: false,
        nodes,
        logs,
        error: err instanceof Error ? err.message : String(err),
        durationMs: performance.now() - start,
      }
    }
  }
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
