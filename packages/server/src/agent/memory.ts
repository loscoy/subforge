import type { Storage } from '../storage/index.js'
import { newId, now } from '../util.js'

export interface LoadedContext {
  /** 系统提示（含工作记忆） */
  system: string
  /** 历史对话（user/assistant 交替） */
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

const BASE_SYSTEM = `你是 SubForge 的内置助手，帮助用户管理代理订阅转换：编写/修改转换脚本、增删代理组与规则。
工作方式：
- 修改脚本前，先用 run_preview 对真实节点验证，确认无误再用 write_script 保存。
- 所有写操作都会自动生成版本快照，可回滚。
- 当你了解到用户的长期偏好（命名习惯、常用分组方式、偏好规则等），调用 update_working_memory 记下来。
- 用简体中文与用户交流。`

/** 框架无关的记忆管理：会话历史 + 工作记忆，落 Storage。 */
export class MemoryManager {
  private readonly maxHistory: number
  constructor(private readonly storage: Storage, maxHistory = 20) {
    this.maxHistory = maxHistory
  }

  loadContext(threadId: string): LoadedContext {
    const wm = this.storage.getWorkingMemory().trim()
    const system = wm ? `${BASE_SYSTEM}\n\n# 已知的用户长期偏好（工作记忆）\n${wm}` : BASE_SYSTEM
    const msgs = this.storage
      .listMessages(threadId)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-this.maxHistory)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    return { system, history: msgs }
  }

  record(threadId: string, role: 'user' | 'assistant', content: string): void {
    this.storage.addMessage({ id: newId(), threadId, role, content, createdAt: now() })
  }
}
