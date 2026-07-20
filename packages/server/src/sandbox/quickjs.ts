import browserVariant from '@jitl/quickjs-singlefile-browser-release-sync'
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import { scriptUtils, type ProxyNode, type ScriptResult, type ScriptRunner } from '@subforge/core'

/**
 * 基于 QuickJS-wasm 的脚本执行器，用于无 node:vm 的运行时（Cloudflare Workers 等）。
 *
 * 通过 host 桥把真实的 `scriptUtils` 注入 isolate，避免逻辑重复。仅支持**同步**脚本。
 *
 * wasm 模块由 provider 注入，以适配不同运行时的 wasm 加载方式：
 * - Node（默认）：singlefile 变体，wasm 内联 base64，运行时实例化。
 * - Cloudflare workerd：必须由 Worker 侧 `import wasm from '...'`（编译期成 WebAssembly.Module）
 *   经 `newVariant({ wasmModule })` 注入——workerd 禁止运行时从字节编译 wasm。
 */
export type QuickJsModuleProvider = () => Promise<QuickJSWASMModule>

const defaultProvider: QuickJsModuleProvider = () => newQuickJSWASMModuleFromVariant(browserVariant)

export class QuickJsRunner implements ScriptRunner {
  private modulePromise?: Promise<QuickJSWASMModule>
  constructor(private readonly provider: QuickJsModuleProvider = defaultProvider) {}

  private getModule(): Promise<QuickJSWASMModule> {
    return (this.modulePromise ??= this.provider())
  }

  async run(code: string, nodes: ProxyNode[], params: Record<string, string> = {}): Promise<ScriptResult> {
    const start = Date.now()
    const logs: string[] = []
    const QuickJS = await this.getModule()
    const ctx = QuickJS.newContext()
    try {
      // host: __util(name, argsJson) → JSON(result)
      const utilFn = ctx.newFunction('__util', (nameH, argsH) => {
        const name = ctx.getString(nameH)
        const args = JSON.parse(ctx.getString(argsH)) as unknown[]
        const fn = (scriptUtils as Record<string, (...a: unknown[]) => unknown>)[name]
        if (!fn) throw new Error(`未知 utils.${name}`)
        const result = fn(...args)
        return ctx.newString(JSON.stringify(result ?? null))
      })
      ctx.setProp(ctx.global, '__util', utilFn)
      utilFn.dispose()

      // host: __log(level, argsJson)
      const logFn = ctx.newFunction('__log', (levelH, argsH) => {
        const level = ctx.getString(levelH)
        const args = JSON.parse(ctx.getString(argsH)) as unknown[]
        logs.push(`[${level}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`)
      })
      ctx.setProp(ctx.global, '__log', logFn)
      logFn.dispose()

      // 注入输入
      const setStr = (k: string, v: string) => {
        const h = ctx.newString(v)
        ctx.setProp(ctx.global, k, h)
        h.dispose()
      }
      setStr('__nodesJson', JSON.stringify(nodes))
      setStr('__paramsJson', JSON.stringify(params))

      const wrapped = `(function(){
  const nodes = JSON.parse(__nodesJson);
  const params = JSON.parse(__paramsJson);
  const console = {
    log: (...a) => __log('log', JSON.stringify(a)),
    warn: (...a) => __log('warn', JSON.stringify(a)),
    error: (...a) => __log('error', JSON.stringify(a)),
  };
  const utils = new Proxy({}, { get: (_t, p) => (...args) => JSON.parse(__util(String(p), JSON.stringify(args))) });
  const __run = () => { ${code}\n };
  const out = __run();
  return JSON.stringify(Array.isArray(out) ? out : nodes);
})()`

      const result = ctx.evalCode(wrapped)
      if (result.error) {
        const err = ctx.dump(result.error)
        result.error.dispose()
        return {
          ok: false,
          nodes,
          logs,
          error: typeof err === 'object' && err && 'message' in err ? String((err as any).message) : String(err),
          durationMs: Date.now() - start,
        }
      }
      const json = ctx.getString(result.value)
      result.value.dispose()
      const out = JSON.parse(json) as ProxyNode[]
      return { ok: true, nodes: out, logs, durationMs: Date.now() - start }
    } catch (err) {
      return { ok: false, nodes, logs, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
    } finally {
      ctx.dispose()
    }
  }
}
