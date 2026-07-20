// 模型
export * from './model.js'
export * from './config.js'

// 解析 / 渲染 / 管线
export { parseUri, parseSubscription } from './parsers/index.js'
export { b64decode, looksLikeBase64 } from './parsers/util.js'
export { getRenderer, registerRenderer, listRenderers, renderMihomo, renderSingbox, renderSurge } from './renderers/index.js'
export type { Renderer } from './renderers/index.js'
export { nodeToMihomo, resolveGroupMembers } from './renderers/mihomo.js'
export { nodeToSingbox, clashRuleToSingbox } from './renderers/singbox.js'
export { nodeToSurge } from './renderers/surge.js'
export { runPipeline } from './pipeline.js'
export type { PipelineInput, PipelineOutput } from './pipeline.js'

// 脚本 API
export { scriptUtils, regionOf, emojiOf, multiplierOf, dedupe, keep, drop, uniquifyNames, tagRegions } from './script/utils.js'
export type { ScriptUtils } from './script/utils.js'
export type { ScriptContext, ScriptMain, ScriptResult } from './script/types.js'
export type { ScriptRunner } from './script/runner.js'
export { SCRIPT_DTS } from './script/dts.js'
