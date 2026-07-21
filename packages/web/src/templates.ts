import { TEMPLATES as BUILTIN } from '@subforge/core'
import type { ConversionProfile } from './types'

/** 前端统一的模板结构（内置 + 用户自存）。 */
export interface UITemplate {
  key: string
  label: string
  description: string
  profile: ConversionProfile
  script?: string
  /** 用户自存的模板标记（可删除） */
  user?: boolean
}

const LS_KEY = 'subforge_user_templates'

export function getUserTemplates(): UITemplate[] {
  try {
    return (JSON.parse(localStorage.getItem(LS_KEY) || '[]') as UITemplate[]).map((t) => ({ ...t, user: true }))
  } catch {
    return []
  }
}

export function saveUserTemplate(t: Omit<UITemplate, 'user'>): void {
  const list = getUserTemplates().filter((x) => x.key !== t.key)
  list.push({ ...t, user: true })
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

export function deleteUserTemplate(key: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify(getUserTemplates().filter((t) => t.key !== key)))
}

/** 内置 + 用户模板合并列表。 */
export function allTemplates(): UITemplate[] {
  const builtin: UITemplate[] = (BUILTIN as UITemplate[]).map((t) => ({
    key: t.key, label: t.label, description: t.description, profile: t.profile as ConversionProfile, script: t.script,
  }))
  return [...builtin, ...getUserTemplates()]
}
