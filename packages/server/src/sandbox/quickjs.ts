import browserVariant from '@jitl/quickjs-singlefile-browser-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'
import { scriptUtils, type OverrideResult, type ProxyNode, type ScriptResult, type ScriptRunner } from '@subforge/core'

/**
 * 基于 QuickJS-wasm 的脚本执行器，供 Node 与 Cloudflare Workers 共用。
 *
 * 通过 host 桥把真实的 `scriptUtils` 注入 isolate，避免逻辑重复。
 *
 * **支持 async 脚本**（`ScriptMain` 的类型签名与 Sub-Store 生态的 `async function main(config)`
 * 都依赖这一点），且用的是同步 wasm 变体——见 `settleJson` 的说明。
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

      const wrapped = `(async function(){
  const nodes = JSON.parse(__nodesJson);
  const params = JSON.parse(__paramsJson);
  const console = {
    log: (...a) => __log('log', JSON.stringify(a)),
    warn: (...a) => __log('warn', JSON.stringify(a)),
    error: (...a) => __log('error', JSON.stringify(a)),
  };
  const utils = new Proxy({}, { get: (_t, p) => (...args) => JSON.parse(__util(String(p), JSON.stringify(args))) });
  const __run = async () => { ${code}\n };
  const out = await __run();
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
      try {
        const settled = settleJson(ctx, result.value)
        if (settled.kind !== 'ok') {
          return { ok: false, nodes, logs, error: settleError(settled, this.timeoutMs), durationMs: Date.now() - start }
        }
        const out = JSON.parse(settled.json) as ProxyNode[]
        return { ok: true, nodes: out, logs, durationMs: Date.now() - start }
      } finally {
        result.value.dispose()
      }
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

      const wrapped = `(async function(){
  var __config = JSON.parse(__configJson);
  var $arguments = JSON.parse(__argsJson);
  var console = {
    log: (...a) => __log('log', JSON.stringify(a)),
    warn: (...a) => __log('warn', JSON.stringify(a)),
    error: (...a) => __log('error', JSON.stringify(a)),
  };
  ${code}
  var __out = (typeof main === 'function') ? await main(__config) : undefined;
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
      try {
        const settled = settleJson(ctx, result.value)
        if (settled.kind !== 'ok') {
          return { ok: false, logs, error: settleError(settled, timeoutMs), durationMs: Date.now() - start }
        }
        const cfg = JSON.parse(settled.json)
        if (!cfg || typeof cfg !== 'object') {
          return { ok: false, logs, error: 'main(config) 未返回配置对象', durationMs: Date.now() - start }
        }
        return { ok: true, config: cfg as Record<string, unknown>, logs, durationMs: Date.now() - start }
      } finally {
        result.value.dispose()
      }
    } catch (err) {
      return { ok: false, logs, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
    } finally {
      ctx.dispose()
    }
  }
}

type SettleOutcome = { kind: 'ok'; json: string } | { kind: 'error'; error: unknown } | { kind: 'stuck' }

/**
 * 落定脚本返回值，取出那个 JSON 字符串。
 *
 * 我们用的是**同步** wasm 变体，却仍然支持 async 脚本——因为沙箱里没有任何异步 host 函数：
 * 不注入 fetch / timer，`__util` 与 `__log` 都是同步桥。于是脚本里的 promise 只可能被
 * 微任务推动，把 `executePendingJobs()` 抽干就一定能落定。
 *
 * 反过来说，「队列已空但仍 pending」= 这个 await 永远不会完成（例如 `new Promise(() => {})`），
 * 此时立即报错而不是挂住请求。这条判断正是同步变体能安全支持 async 的前提；换成 asyncify
 * 变体要多 0.5MB wasm（还得内联进 worker），而我们并不需要它提供的「异步 host 函数」能力。
 *
 * 句柄生命周期：`notAPromise` 时 `state.value` 就是传入的 handle 本身，不能重复释放。
 */
function settleJson(ctx: QuickJSContext, handle: QuickJSHandle): SettleOutcome {
  let state = ctx.getPromiseState(handle)
  if (state.type === 'fulfilled' && state.notAPromise) return { kind: 'ok', json: ctx.getString(handle) }

  while (state.type === 'pending') {
    const jobs = ctx.runtime.executePendingJobs()
    if (jobs.error) {
      const error = ctx.dump(jobs.error)
      jobs.error.dispose()
      return { kind: 'error', error }
    }
    const ran = typeof jobs.value === 'number' ? jobs.value : 0
    state = ctx.getPromiseState(handle)
    if (state.type === 'pending' && ran === 0) return { kind: 'stuck' }
  }

  if (state.type === 'rejected') {
    const error = ctx.dump(state.error)
    state.error.dispose()
    return { kind: 'error', error }
  }
  const json = ctx.getString(state.value)
  state.value.dispose()
  return { kind: 'ok', json }
}

function settleError(outcome: Exclude<SettleOutcome, { kind: 'ok' }>, timeoutMs: number): string {
  if (outcome.kind === 'stuck') return '脚本 await 了永远不会完成的操作（沙箱内不提供异步 I/O）'
  return quickJsError(outcome.error, timeoutMs)
}

function quickJsError(err: unknown, timeoutMs: number): string {
  const message = typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  if (message.toLowerCase().includes('interrupted')) return `脚本执行超时（>${timeoutMs}ms）`
  if (message.toLowerCase().includes('out of memory')) return '脚本内存超限'
  return message
}
