import type { ConversionProfile } from './config.js'
import type { ProxyNode } from './model.js'
import { parseSubscription } from './parsers/index.js'
import { getRenderer } from './renderers/index.js'
import type { ScriptRunner } from './script/runner.js'
import { uniquifyNames } from './script/utils.js'

export interface PipelineInput {
  /** 已抓取的订阅原文（每项一份订阅内容） */
  rawSubscriptions: string[]
  /** 目标格式 id，如 'mihomo' */
  target: string
  /** 转换配置档 */
  profile: ConversionProfile
  /** 可选转换脚本体 */
  script?: string
  scriptParams?: Record<string, string>
  /** 脚本执行器（提供 script 时必填） */
  runner?: ScriptRunner
}

export interface PipelineOutput {
  /** 渲染后的配置文本 */
  config: string
  /** 最终参与渲染的节点 */
  nodes: ProxyNode[]
  /** 脚本 console 输出 */
  logs: string[]
  /** 各阶段计数，便于调试/预览 */
  stats: { parsed: number; afterScript: number }
}

/**
 * 端到端转换：解析订阅 → 合并 → （可选）跑脚本 → 名称去重 → 渲染。
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const parsed: ProxyNode[] = []
  for (const raw of input.rawSubscriptions) {
    parsed.push(...parseSubscription(raw))
  }

  let nodes = parsed
  const logs: string[] = []

  if (input.script && input.script.trim()) {
    if (!input.runner) throw new Error('提供了 script 但未注入 ScriptRunner')
    const result = await input.runner.run(input.script, nodes, input.scriptParams)
    logs.push(...result.logs)
    if (!result.ok) throw new Error(`脚本执行失败: ${result.error}`)
    nodes = result.nodes
  }

  // 渲染前保证名称唯一，否则客户端会因重名报错
  nodes = uniquifyNames(nodes)

  const renderer = getRenderer(input.target)
  if (!renderer) throw new Error(`未知的目标格式: ${input.target}`)
  const config = renderer.render({ nodes, profile: input.profile })

  return {
    config,
    nodes,
    logs,
    stats: { parsed: parsed.length, afterScript: nodes.length },
  }
}
