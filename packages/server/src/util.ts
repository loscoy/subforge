import { randomBytes, randomUUID } from 'node:crypto'

export function newId(): string {
  return randomUUID()
}

/** 生成分享 token（URL 安全短串）。 */
export function newToken(len = 12): string {
  return randomBytes(len).toString('base64url').slice(0, len)
}

export function now(): number {
  return Date.now()
}

/**
 * 内容指纹：给「整份替换」类写操作做「读过才准写」的校验（乐观并发）。
 *
 * 读工具返回它，写工具要求把它当 baseRev 传回来——拿不出指纹说明根本没读过当前内容，
 * 指纹对不上说明读完之后内容又变了（用户在界面上改了、或自己上一步刚写过）。
 * 两种情况下的整份覆盖都会静默吃掉别人的改动，一律拒绝。
 *
 * 用 FNV-1a 而非 SHA：这里防的是「拿旧副本覆盖」的失误，不是攻击，
 * 不需要抗碰撞，而且同步实现在 Node 与边缘都能直接跑。带上长度进一步降低碰撞概率。
 */
export function contentRev(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${text.length.toString(36)}-${h.toString(36)}`
}
