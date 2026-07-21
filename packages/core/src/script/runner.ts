import type { ProxyNode } from '../model.js'
import type { OverrideResult, ScriptResult } from './types.js'

/**
 * 脚本执行器接口（实现放在 server：Node 用 node:vm，serverless 用 QuickJS-wasm）。
 * core 只依赖接口，保证运行时无关。
 */
export interface ScriptRunner {
  /**
   * 执行「节点变换」脚本，返回处理后的节点。
   * @param code   用户脚本体（可用全局 nodes/utils/console/params，`return nodes`）
   */
  run(code: string, nodes: ProxyNode[], params?: Record<string, string>): Promise<ScriptResult>

  /**
   * 执行「override 覆写」脚本：脚本定义 `main(config)`，接收完整 Clash 配置并返回完整配置。
   * @param code   覆写脚本（含 main 函数，可用 $arguments/console）
   * @param config 传给 main 的配置对象（至少含 proxies）
   * @param params $arguments 参数
   */
  runOverride(code: string, config: Record<string, unknown>, params?: Record<string, string>): Promise<OverrideResult>
}
