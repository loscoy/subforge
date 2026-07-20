/** 机场在响应头 `subscription-userinfo` 里给出的流量/到期信息。 */
export interface UserInfo {
  upload?: number
  download?: number
  total?: number
  /** 到期时间（epoch 秒） */
  expire?: number
}

/**
 * 解析 `subscription-userinfo` 头，形如：
 *   upload=1234; download=2345; total=100000000; expire=1700000000
 * 全部为空返回 undefined。
 */
export function parseUserInfo(header: string | null | undefined): UserInfo | undefined {
  if (!header) return undefined
  const info: UserInfo = {}
  for (const seg of header.split(';')) {
    const [k, v] = seg.split('=').map((s) => s.trim())
    if (!k || v === undefined) continue
    const num = Number(v)
    if (!Number.isFinite(num)) continue
    if (k === 'upload') info.upload = num
    else if (k === 'download') info.download = num
    else if (k === 'total') info.total = num
    else if (k === 'expire') info.expire = num
  }
  return Object.keys(info).length ? info : undefined
}

/** 剩余流量（字节），无法计算返回 undefined。 */
export function remainingBytes(info: UserInfo): number | undefined {
  if (info.total === undefined) return undefined
  const used = (info.upload ?? 0) + (info.download ?? 0)
  return Math.max(0, info.total - used)
}
