import * as yaml from 'js-yaml'
import type { ConversionProfile } from './config.js'
import type { ProxyNode } from './model.js'
import { parseSubscription } from './parsers/index.js'
import { getRenderer } from './renderers/index.js'
import { nodeToMihomo } from './renderers/mihomo.js'
import { clashProxyToNode } from './parsers/clash.js'
import { filterSupported } from './renderers/support.js'
import { applyOperations, expandRegionGroups } from './preprocess.js'
import type { ScriptRunner } from './script/runner.js'
import { isOverrideScript } from './script/types.js'
import { sanitizeNodeNames, uniquifyNames } from './script/utils.js'
import { diffNodes, type PipelineStage } from './diagnostics.js'

export interface PipelineInput {
  /** 已抓取的订阅原文（每项一份订阅内容） */
  rawSubscriptions: string[]
  /** 与原文一一对应的来源 ID */
  sourceIds?: string[]
  /** 调试调用可收集失败之前已完成的阶段。 */
  onStage?: (stage: PipelineStage) => void
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
  /** 渲染期告警，如「目标格式不支持某协议，已跳过 N 个节点」 */
  warnings: string[]
  /** 各阶段计数，便于调试/预览 */
  stats: { parsed: number; afterScript: number }
  stages: PipelineStage[]
}

/**
 * 端到端转换：解析订阅 → 合并 → （可选）跑脚本 → 名称去重 → 渲染。
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const renderer = getRenderer(input.target)
  if (!renderer) throw new Error(`Unknown target format: ${input.target}`)
  const parsed: ProxyNode[] = []
  const warnings: string[] = []
  const stages: PipelineStage[] = []
  const record = (stage: string, reason: string, before: ProxyNode[], after: ProxyNode[]) => {
    const entry = { stage, reason, ...diffNodes(before, after) }
    stages.push(entry)
    input.onStage?.(entry)
  }
  for (const [index, raw] of input.rawSubscriptions.entries()) {
    const source = parseSubscription(raw, warnings).map((n) => ({ ...n, meta: { ...n.meta, source: input.sourceIds?.[index] } }))
    parsed.push(...source)
    record(`parse:${index + 1}`, '解析来源；无效或不支持的条目见告警', [], source)
  }

  // 先执行声明式节点操作（可视化编辑器产出）
  let nodes = parsed
  for (const [index, op] of (input.profile.operations || []).entries()) {
    const next = applyOperations(nodes, [op], warnings)
    record(`operation:${index + 1}`, JSON.stringify(op), nodes, next)
    nodes = next
  }
  // 先清洗（剥掉换行/控制字符，挡住渲染期的配置注入）再去重：
  // 清洗可能让原本不同的名字变得相同，顺序反了就会漏掉重名。
  const named = uniquifyNames(sanitizeNodeNames(nodes))
  record('names', '清洗控制字符并处理重名；字段变化显示为移除旧项、加入新项', nodes, named)
  nodes = named
  const logs: string[] = []
  const script = input.script?.trim()

  // ---- override（覆写）脚本：main(config) 返回完整配置，直接序列化 ----
  if (script && isOverrideScript(script)) {
    if (renderer.id !== 'mihomo') throw new Error('Clash override scripts require the mihomo target')
    if (!input.runner) throw new Error('提供了 script 但未注入 ScriptRunner')
    // 覆写脚本收到的是一份 Clash 配置，因此按 mihomo 的能力过滤
    const renderable = filterSupported(nodes, 'mihomo', warnings)
    record('target', '按 mihomo 协议能力过滤', nodes, renderable)
    const clashProxies = renderable.map(nodeToMihomo)
    const result = await input.runner.runOverride(script, { proxies: clashProxies }, input.scriptParams)
    logs.push(...result.logs)
    if (!result.ok) throw new Error(`覆写脚本执行失败: ${result.error}`)
    if (!result.config || typeof result.config !== 'object') throw new Error('覆写脚本 main(config) 未返回配置对象')
    if (!Array.isArray(result.config.proxies)) throw new Error('Override output must contain a proxies array')
    const overridden = result.config.proxies.map((p: Record<string, unknown>) => clashProxyToNode(p)).filter((n): n is ProxyNode => n !== null)
    if (overridden.length !== result.config.proxies.length) throw new Error('Override output contains invalid or unsupported proxies')
    record('override', '脚本返回完整配置；来源信息无法从任意覆写结果可靠还原', renderable, overridden)
    nodes = overridden
    const config = yaml.dump(result.config, { lineWidth: -1, noRefs: true, sortKeys: false })
    return { config, nodes, logs, warnings, stages, stats: { parsed: parsed.length, afterScript: nodes.length } }
  }

  // ---- transform（节点变换）脚本：return nodes ----
  if (script) {
    if (!input.runner) throw new Error('提供了 script 但未注入 ScriptRunner')
    const result = await input.runner.run(script, nodes, input.scriptParams)
    logs.push(...result.logs)
    if (!result.ok) throw new Error(`脚本执行失败: ${result.error}`)
    // 脚本可以任意改名，改完仍要再清洗一次——不可信输入也可能经脚本流回名称。
    const next = uniquifyNames(sanitizeNodeNames(result.nodes))
    record('script', '脚本结果与执行前对比；任意脚本的内部意图无法静态判定', nodes, next)
    nodes = next
  }

  const supported = filterSupported(nodes, renderer.id, warnings)
  record('target', `按 ${renderer.id} 协议能力过滤；客户端运行时连接未验证`, nodes, supported)
  nodes = supported
  // 展开「地区自动分组」
  const groups = expandRegionGroups(input.profile.groups, nodes)
  const config = renderer.render({ nodes, profile: { ...input.profile, groups }, warnings })

  return {
    config,
    nodes,
    logs,
    warnings,
    stages,
    stats: { parsed: parsed.length, afterScript: nodes.length },
  }
}
