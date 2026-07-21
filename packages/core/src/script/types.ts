import type { ProxyNode } from '../model.js'
import type { ScriptUtils } from './utils.js'

/** 传给用户脚本的上下文。 */
export interface ScriptContext {
  /** 当前节点列表（上一步的产物） */
  nodes: ProxyNode[]
  /** 内置工具集：regionOf / dedupe / keep / drop / tagRegions … */
  utils: ScriptUtils
  /** 受限 console，输出会回传到预览面板 */
  console: Pick<Console, 'log' | 'warn' | 'error'>
  /** 调用方传入的参数（如 ?param=value） */
  params: Record<string, string>
}

/**
 * 用户转换脚本的主函数签名。
 * 脚本可 `return` 处理后的节点数组；返回 undefined 视为不修改。
 */
export type ScriptMain = (ctx: ScriptContext) => ProxyNode[] | void | Promise<ProxyNode[] | void>

/** 脚本执行结果。 */
export interface ScriptResult {
  ok: boolean
  nodes: ProxyNode[]
  /** console 输出行 */
  logs: string[]
  /** 出错信息（ok=false 时） */
  error?: string
  /** 执行耗时 ms */
  durationMs: number
}

/**
 * override（覆写）脚本执行结果。
 * 覆写脚本（Sub-Store/mihomo 风格）定义 `main(config)`，接收完整 Clash 配置、返回完整 Clash 配置。
 */
export interface OverrideResult {
  ok: boolean
  /** main(config) 返回的完整配置对象 */
  config?: Record<string, unknown>
  logs: string[]
  error?: string
  durationMs: number
}

/**
 * 判断是否为 override 覆写脚本：脚本内定义了 `main` 函数（Sub-Store/mihomo 约定）。
 */
export function isOverrideScript(code: string): boolean {
  return (
    /\bfunction\s+main\s*\(/.test(code) ||
    /\b(?:const|let|var)\s+main\s*=\s*(?:async\s*)?(?:function|\()/.test(code)
  )
}
