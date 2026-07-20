import type { RenderContext } from '../config.js'
import { renderMihomo } from './mihomo.js'
import { renderSingbox } from './singbox.js'
import { renderSurge } from './surge.js'

/**
 * 渲染器接口：把统一节点 + 配置档产出目标客户端格式文本。
 * 加输出格式 = 新增一个实现并在此注册。
 */
export interface Renderer {
  /** 唯一 id，用于选择渲染器（?target=mihomo） */
  id: string
  /** 输出 MIME/后缀提示 */
  contentType: string
  render(ctx: RenderContext): string
}

const mihomo: Renderer = {
  id: 'mihomo',
  contentType: 'text/yaml; charset=utf-8',
  render: renderMihomo,
}

const singbox: Renderer = {
  id: 'singbox',
  contentType: 'application/json; charset=utf-8',
  render: renderSingbox,
}

const surge: Renderer = {
  id: 'surge',
  contentType: 'text/plain; charset=utf-8',
  render: renderSurge,
}

const registry = new Map<string, Renderer>([
  [mihomo.id, mihomo],
  ['clash', mihomo], // 别名
  [singbox.id, singbox],
  ['sing-box', singbox], // 别名
  [surge.id, surge],
])

export function getRenderer(id: string): Renderer | undefined {
  return registry.get(id.toLowerCase())
}

export function registerRenderer(r: Renderer): void {
  registry.set(r.id.toLowerCase(), r)
}

export function listRenderers(): string[] {
  return [...new Set([...registry.values()].map((r) => r.id))]
}

export { renderMihomo, renderSingbox, renderSurge }
