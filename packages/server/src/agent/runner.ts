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

/** agent 循环抽象。AI SDK 是其一个实现，后续可换 Mastra 等，业务层不动。 */
export interface AgentRunner {
  /** 在某会话线程内处理一条用户消息，返回最终回复与中间工具步骤。 */
  run(threadId: string, userMessage: string): Promise<AgentReply>
}

/** LLM 连接配置（OpenAI 兼容）。 */
export interface AgentModelConfig {
  baseURL: string
  apiKey: string
  model: string
}
