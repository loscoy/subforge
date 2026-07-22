interface TimingSafeSubtleCrypto {
  timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean
}

const encoder = new TextEncoder()

async function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value))
}

/** 跨 Node 与 Workers 的固定长度 secret 比较。 */
export async function timingSafeEqual(actual: string, expected: string): Promise<boolean> {
  const [actualHash, expectedHash] = await Promise.all([digest(actual), digest(expected)])
  const subtle = crypto.subtle as typeof crypto.subtle & TimingSafeSubtleCrypto
  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(actualHash, expectedHash)
  }

  const actualBytes = new Uint8Array(actualHash)
  const expectedBytes = new Uint8Array(expectedHash)
  let difference = 0
  for (let i = 0; i < actualBytes.length; i += 1) {
    difference |= actualBytes[i]! ^ expectedBytes[i]!
  }
  return difference === 0
}
