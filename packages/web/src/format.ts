export function fmtBytes(n?: number): string {
  if (n === undefined) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function fmtExpire(epochSec?: number): string {
  if (!epochSec) return '-'
  const d = new Date(epochSec * 1000)
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000)
  return `${d.toLocaleDateString()}（剩 ${days} 天）`
}

export interface UserInfo {
  upload?: number
  download?: number
  total?: number
  expire?: number
}

export function usedBytes(u?: UserInfo): number | undefined {
  if (!u || u.total === undefined) return undefined
  return (u.upload ?? 0) + (u.download ?? 0)
}
