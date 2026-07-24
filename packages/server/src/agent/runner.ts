import type { AgentToolStep } from '../storage/types.js'

/**
 * 一次 agent 运行中的一个工具调用步骤（用于回显中间过程）。
 * 与落库的形状同一个，落库与回显不需要来回转换。
 */
export type AgentStep = AgentToolStep

export interface AgentReply {
  text: string
  steps: AgentStep[]
}

/**
 * 流式事件。工具调用带上 id 是为了让前端把「调用」与稍后到达的「结果」配对——
 * 同名工具一轮里可能被调用多次，只靠名字对不上。
 */
export type AgentEvent =
  | { type: 'text'; delta: string }
  /** 思考（reasoning）增量。只有支持 reasoning_content 的模型才会有。 */
  | { type: 'reasoning'; delta: string }
  | { type: 'tool-call'; id: string; tool: string; args?: unknown }
  | { type: 'tool-result'; id: string; tool: string; result?: unknown; error?: string }
  | { type: 'error'; error: string }
  | { type: 'done'; text: string }

/** agent 循环抽象。AI SDK 是其一个实现，后续可换 Mastra 等，业务层不动。 */
export interface AgentRunner {
  /**
   * 在某会话线程内处理一条用户消息，返回最终回复与中间工具步骤。
   * @param context 可选的即时上下文（如「当前正在编辑的转换档 id/name」），并入系统提示。
   */
  run(threadId: string, userMessage: string, context?: string): Promise<AgentReply>

  /**
   * 流式版本：逐步产出文本增量、工具调用/结果、最终完成事件。
   * @param signal 传入并 abort 时中止本轮生成（用户点「停止」），已产出的部分照常保留。
   */
  runStream(threadId: string, userMessage: string, context?: string, signal?: AbortSignal): AsyncIterable<AgentEvent>
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
