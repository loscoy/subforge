import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, isEncrypted, maskSecret } from './secrets.js'

describe('secrets', () => {
  const KEY = 'master-key'

  it('加解密往返', async () => {
    const blob = await encryptSecret('sk-abcdef123456', KEY)
    expect(isEncrypted(blob)).toBe(true)
    expect(blob).not.toContain('sk-abcdef123456')
    expect(await decryptSecret(blob, KEY)).toBe('sk-abcdef123456')
  })

  it('同一明文每次密文不同（随机 IV）', async () => {
    const a = await encryptSecret('same', KEY)
    const b = await encryptSecret('same', KEY)
    expect(a).not.toBe(b)
    expect(await decryptSecret(a, KEY)).toBe(await decryptSecret(b, KEY))
  })

  it('主密钥不对 / 缺失 / 密文损坏都返回 undefined 而不抛错', async () => {
    const blob = await encryptSecret('secret', KEY)
    expect(await decryptSecret(blob, 'wrong-key')).toBeUndefined()
    expect(await decryptSecret(blob, undefined)).toBeUndefined()
    expect(await decryptSecret('enc:v1:zzz:zzz', KEY)).toBeUndefined()
    expect(await decryptSecret('enc:v1:onlyonepart', KEY)).toBeUndefined()
  })

  it('非密文（历史明文残留）不当作密文解', async () => {
    expect(isEncrypted('plain-value')).toBe(false)
    expect(await decryptSecret('plain-value', KEY)).toBeUndefined()
  })

  it('掩码保留可辨认的头尾，不泄露中段', () => {
    expect(maskSecret('sk-abcdefghijkl')).toBe('sk-…ijkl')
    expect(maskSecret('short')).toBe('…rt')
    expect(maskSecret('ab')).toBe('…')
  })
})
