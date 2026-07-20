import type { ProxyNode } from '../model.js'
import type { ScriptResult } from './types.js'

/**
 * 脚本执行器接口（实现放在 server：Node 用 node:vm，serverless 后续换 QuickJS-wasm）。
 * core 只依赖接口，保证运行时无关。
 */
export interface ScriptRunner {
  /**
   * 执行用户脚本，返回处理后的节点。
   * @param code   用户脚本体（可用全局 nodes/utils/console/params，`return nodes`）
   * @param nodes  输入节点
   * @param params 调用方参数
   */
  run(code: string, nodes: ProxyNode[], params?: Record<string, string>): Promise<ScriptResult>
}
