/** 一次 agent 运行中的一个工具调用步骤（用于回显中间过程）。 */
export interface AgentStep {
  tool: string
  args: unknown
  result: unknown
}

export interface AgentReply {
  text: string
  steps: AgentStep[]
}

/** 流式事件。 */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; tool: string }
  | { type: 'tool-result'; tool: string }
  | { type: 'error'; error: string }
  | { type: 'done'; text: string }

/** agent 循环抽象。AI SDK 是其一个实现，后续可换 Mastra 等，业务层不动。 */
export interface AgentRunner {
  /**
   * 在某会话线程内处理一条用户消息，返回最终回复与中间工具步骤。
   * @param context 可选的即时上下文（如「当前正在编辑的转换档 id/name」），并入系统提示。
   */
  run(threadId: string, userMessage: string, context?: string): Promise<AgentReply>

  /** 流式版本：逐步产出文本增量、工具调用/结果、最终完成事件。 */
  runStream(threadId: string, userMessage: string, context?: string): AsyncIterable<AgentEvent>
}

import type { WebToolsConfig } from './webTools.js'

/** LLM 连接配置（OpenAI 兼容）。 */
export interface AgentModelConfig {
  baseURL: string
  apiKey: string
  model: string
  /** 联网工具（web_search / web_fetch），未配置则 Agent 不联网 */
  webTools?: WebToolsConfig
}
