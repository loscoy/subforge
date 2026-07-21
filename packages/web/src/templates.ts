import { TEMPLATES as BUILTIN } from '@subforge/core'
import type { ConversionProfile } from './types'
import type { ServerTemplate } from './api'

/** 前端统一的模板结构（内置 + 服务端保存）。 */
export interface UITemplate {
  key: string
  label: string
  description: string
  profile: ConversionProfile
  script?: string
  /** 服务端模板才有（可删除） */
  serverId?: string
}

export function builtinTemplates(): UITemplate[] {
  return (BUILTIN as any[]).map((t) => ({
    key: 'builtin:' + t.key, label: t.label, description: t.description,
    profile: t.profile as ConversionProfile, script: t.script,
  }))
}

export function serverToUI(list: ServerTemplate[]): UITemplate[] {
  return list.map((t) => ({
    key: 'server:' + t.id, label: t.name, description: t.description || '（我的模板）',
    profile: t.profile, script: t.script, serverId: t.id,
  }))
}
