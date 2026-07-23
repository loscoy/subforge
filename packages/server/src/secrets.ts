/**
 * 设置里密钥字段的加解密。
 *
 * 密钥（OPENAI_API_KEY / MCP_TOKEN / TAVILY_API_KEY）存在数据库里，
 * 用 env 的 SETTINGS_KEY 作主密钥加密，避免 D1 导出 / 备份泄露即等于密钥泄露。
 *
 * 只用 WebCrypto（Node 22 与 Workers 都原生支持），边缘可移植。
 * 密文格式：enc:v1:<base64(iv)>:<base64(ciphertext)>，前缀留出换算法的余地。
 */

const PREFIX = 'enc:v1:'
const IV_BYTES = 12
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// tsconfig 的 lib 只到 ES2023（无 DOM），CryptoKey 不是全局类型名，从 subtle 的签名反推。
type SubtleKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>

/** 主密钥可以是任意长度的字符串，取 SHA-256 得到定长的 AES-256 key。 */
async function importKey(keyMaterial: string): Promise<SubtleKey> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(keyMaterial))
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

export async function encryptSecret(plain: string, keyMaterial: string): Promise<string> {
  const key = await importKey(keyMaterial)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain))
  return `${PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`
}

/**
 * 解密失败一律返回 undefined 而不是抛错——没配主密钥、主密钥换了、密文损坏，
 * 对调用方都是同一件事：「这个密钥不可用」，按未配置处理（失败关闭）。
 */
export async function decryptSecret(blob: string, keyMaterial: string | undefined): Promise<string | undefined> {
  if (!keyMaterial || !isEncrypted(blob)) return undefined
  const [ivPart, cipherPart] = blob.slice(PREFIX.length).split(':')
  if (!ivPart || !cipherPart) return undefined
  try {
    const key = await importKey(keyMaterial)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivPart) },
      key,
      fromBase64(cipherPart),
    )
    return decoder.decode(plain)
  } catch {
    return undefined
  }
}

/** 密钥的展示掩码：够长时留前 3 位（便于辨认 sk- 前缀）与后 4 位。 */
export function maskSecret(plain: string): string {
  if (plain.length >= 12) return `${plain.slice(0, 3)}…${plain.slice(-4)}`
  if (plain.length >= 4) return `…${plain.slice(-2)}`
  return '…'
}
