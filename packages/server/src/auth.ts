/**
 * 账号密码登录：密码哈希与会话管理。
 *
 * 只用 WebCrypto（Node 22 / Workers 都原生支持），边缘可移植——
 * 与 secrets.ts 同一策略，绝不 import node:crypto。
 *
 * 存储：kv 表 `auth` 键（Storage.getAuth/setAuth），存储层视为不透明 JSON。
 * 会话 token 只存 SHA-256 哈希，拖库拿不到可用会话。
 */
import { timingSafeEqual } from './security.js'
import type { Storage } from './storage/index.js'

/** Workers 对 PBKDF2 的迭代上限恰为 100000，取满。 */
const ITERATIONS = 100_000
const SALT_BYTES = 16
const TOKEN_BYTES = 32
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface AuthAccount {
  username: string
  salt: string
  hash: string
  /** 存下迭代数：将来上调时旧账号仍可校验 */
  iterations: number
}

export interface AuthSession {
  tokenHash: string
  createdAt: number
  expiresAt: number
}

export interface AuthState {
  account?: AuthAccount
  sessions: AuthSession[]
}

const encoder = new TextEncoder()

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

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<Pick<AuthAccount, 'salt' | 'hash' | 'iterations'>> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await deriveBits(password, salt, ITERATIONS)
  return { salt: toBase64(salt), hash: toBase64(hash), iterations: ITERATIONS }
}

export async function verifyPassword(password: string, account: AuthAccount): Promise<boolean> {
  const hash = await deriveBits(password, fromBase64(account.salt), account.iterations)
  return timingSafeEqual(toBase64(hash), account.hash)
}

async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return toBase64(new Uint8Array(digest))
}

async function hashToken(token: string): Promise<string> {
  return sha256Base64(token)
}

export async function loginThrottleKey(username: string, clientIp: string): Promise<string> {
  return (await sha256Base64(`${username}\0${clientIp.toLowerCase()}`))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return value === '::1' || value === 'localhost' || value.startsWith('127.') || value.startsWith('::ffff:127.')
}

export async function loadAuthState(storage: Storage): Promise<AuthState> {
  const raw = await storage.getAuth()
  if (!raw) return { sessions: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<AuthState>
    return { account: parsed.account, sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] }
  } catch {
    // 损坏一律按未初始化处理（与 secrets.ts 解密失败同款语义：失败关闭）
    return { sessions: [] }
  }
}

export async function saveAuthState(storage: Storage, state: AuthState): Promise<void> {
  await storage.setAuth(JSON.stringify(state))
}

/** 建立新会话并顺带清理过期会话，返回 token 本体。调用方负责 saveAuthState。 */
export async function addSession(state: AuthState, at: number): Promise<string> {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  state.sessions = state.sessions.filter((s) => s.expiresAt > at)
  state.sessions.push({ tokenHash: await hashToken(token), createdAt: at, expiresAt: at + SESSION_TTL_MS })
  return token
}

export async function hasValidSession(state: AuthState, token: string, at: number): Promise<boolean> {
  const target = await hashToken(token)
  for (const s of state.sessions) {
    if (s.expiresAt > at && (await timingSafeEqual(target, s.tokenHash))) return true
  }
  return false
}

/** 吊销单个会话（登出）。调用方负责 saveAuthState。 */
export async function revokeSession(state: AuthState, token: string): Promise<void> {
  const target = await hashToken(token)
  state.sessions = state.sessions.filter((s) => s.tokenHash !== target)
}
