import type { OverrideResult, ProxyNode, ScriptResult, ScriptRunner } from '@subforge/core'
import { QuickJsRunner } from './quickjs.js'

/**
 * 兼容旧导入名的 Node 脚本执行器。
 *
 * 实际执行统一委托给 QuickJS-WASM：脚本与宿主进程不共享 realm，且运行时有 CPU、
 * 内存和栈上限。保留类名是为了兼容现有调用方；新代码应直接使用 QuickJsRunner。
 */
export class NodeVmRunner implements ScriptRunner {
  private readonly runner: QuickJsRunner

  constructor(timeoutMs = 3000) {
    this.runner = new QuickJsRunner(undefined, { timeoutMs })
  }

  run(code: string, nodes: ProxyNode[], params: Record<string, string> = {}): Promise<ScriptResult> {
    return this.runner.run(code, nodes, params)
  }

  runOverride(
    code: string,
    config: Record<string, unknown>,
    params: Record<string, string> = {},
  ): Promise<OverrideResult> {
    return this.runner.runOverride(code, config, params)
  }
}
