import browserVariant from '@jitl/quickjs-singlefile-browser-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'
import { scriptUtils, type OverrideResult, type ProxyNode, type ScriptResult, type ScriptRunner } from '@subforge/core'

/**
 * 基于 QuickJS-wasm 的脚本执行器，供 Node 与 Cloudflare Workers 共用。
 *
 * 通过 host 桥把真实的 `scriptUtils` 注入 isolate，避免逻辑重复。仅支持**同步**脚本。
 *
 * wasm 模块由 provider 注入，以适配不同运行时的 wasm 加载方式：
 * - Node（默认）：singlefile 变体，wasm 内联 base64，运行时实例化。
 * - Cloudflare workerd：必须由 Worker 侧 `import wasm from '...'`（编译期成 WebAssembly.Module）
 *   经 `newVariant({ wasmModule })` 注入——workerd 禁止运行时从字节编译 wasm。
 */
export type QuickJsModuleProvider = () => Promise<QuickJSWASMModule>

export interface QuickJsRunnerOptions {
  timeoutMs?: number
  memoryLimitBytes?: number
}

const defaultProvider: QuickJsModuleProvider = () => newQuickJSWASMModuleFromVariant(browserVariant)
const DEFAULT_TIMEOUT_MS = 3000
const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024

export class QuickJsRunner implements ScriptRunner {
  private modulePromise?: Promise<QuickJSWASMModule>
  private readonly timeoutMs: number
  private readonly memoryLimitBytes: number

  constructor(
    private readonly provider: QuickJsModuleProvider = defaultProvider,
    options: QuickJsRunnerOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.memoryLimitBytes = options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES
  }

  private getModule(): Promise<QuickJSWASMModule> {
    return (this.modulePromise ??= this.provider())
  }

  private newContext(QuickJS: QuickJSWASMModule, timeoutMs: number): QuickJSContext {
    const ctx = QuickJS.newContext()
    ctx.runtime.setMemoryLimit(this.memoryLimitBytes)
    ctx.runtime.setMaxStackSize(1024 * 1024)
    ctx.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs))
    return ctx
  }

  async run(code: string, nodes: ProxyNode[], params: Record<string, string> = {}): Promise<ScriptResult> {
    const start = Date.now()
    const logs: string[] = []
    const QuickJS = await this.getModule()
    const ctx = this.newContext(QuickJS, this.timeoutMs)
    try {
      // host: __util(name, argsJson) → JSON(result)
      const utilFn = ctx.newFunction('__util', (nameH, argsH) => {
        const name = ctx.getString(nameH)
        const args = JSON.parse(ctx.getString(argsH)) as unknown[]
        const fn = Object.hasOwn(scriptUtils, name)
          ? (scriptUtils as Record<string, (...a: unknown[]) => unknown>)[name]
          : undefined
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
  if (out && typeof out.then === 'function') throw new Error('脚本仅支持同步执行');
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
          error: quickJsError(err, this.timeoutMs),
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

  async runOverride(
    code: string,
    config: Record<string, unknown>,
    params: Record<string, string> = {},
  ): Promise<OverrideResult> {
    const start = Date.now()
    const logs: string[] = []
    const QuickJS = await this.getModule()
    const timeoutMs = this.timeoutMs * 2
    const ctx = this.newContext(QuickJS, timeoutMs)
    try {
      const logFn = ctx.newFunction('__log', (levelH, argsH) => {
        const level = ctx.getString(levelH)
        const args = JSON.parse(ctx.getString(argsH)) as unknown[]
        logs.push(`[${level}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`)
      })
      ctx.setProp(ctx.global, '__log', logFn)
      logFn.dispose()

      const setStr = (k: string, v: string) => {
        const h = ctx.newString(v)
        ctx.setProp(ctx.global, k, h)
        h.dispose()
      }
      setStr('__configJson', JSON.stringify(config))
      setStr('__argsJson', JSON.stringify(params))

      const wrapped = `(function(){
  var __config = JSON.parse(__configJson);
  var $arguments = JSON.parse(__argsJson);
  var console = {
    log: (...a) => __log('log', JSON.stringify(a)),
    warn: (...a) => __log('warn', JSON.stringify(a)),
    error: (...a) => __log('error', JSON.stringify(a)),
  };
  ${code}
  var __out = (typeof main === 'function') ? main(__config) : undefined;
  if (__out && typeof __out.then === 'function') throw new Error('脚本仅支持同步执行');
  return JSON.stringify(__out === undefined ? null : __out);
})()`

      const result = ctx.evalCode(wrapped)
      if (result.error) {
        const err = ctx.dump(result.error)
        result.error.dispose()
        return {
          ok: false,
          logs,
          error: quickJsError(err, timeoutMs),
          durationMs: Date.now() - start,
        }
      }
      const json = ctx.getString(result.value)
      result.value.dispose()
      const cfg = JSON.parse(json)
      if (!cfg || typeof cfg !== 'object') {
        return { ok: false, logs, error: 'main(config) 未返回配置对象', durationMs: Date.now() - start }
      }
      return { ok: true, config: cfg as Record<string, unknown>, logs, durationMs: Date.now() - start }
    } catch (err) {
      return { ok: false, logs, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
    } finally {
      ctx.dispose()
    }
  }
}

function quickJsError(err: unknown, timeoutMs: number): string {
  const message = typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  if (message.toLowerCase().includes('interrupted')) return `脚本执行超时（>${timeoutMs}ms）`
  if (message.toLowerCase().includes('out of memory')) return '脚本内存超限'
  return message
}
