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
