import { describe, expect, it } from 'vitest'
import { timingSafeEqual } from './security.js'

describe('timingSafeEqual', () => {
  it('仅接受完全相同的 secret', async () => {
    await expect(timingSafeEqual('mcp-secret', 'mcp-secret')).resolves.toBe(true)
    await expect(timingSafeEqual('mcp-secreu', 'mcp-secret')).resolves.toBe(false)
  })

  it('安全处理不同长度和空 secret', async () => {
    await expect(timingSafeEqual('mcp-secret-extra', 'mcp-secret')).resolves.toBe(false)
    await expect(timingSafeEqual('mcp', 'mcp-secret')).resolves.toBe(false)
    await expect(timingSafeEqual('', 'mcp-secret')).resolves.toBe(false)
  })
})
