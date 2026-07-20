import net from 'node:net'
import type { ProxyNode } from '@subforge/core'

/** TCP 连接测活：返回握手耗时 ms，失败/超时返回 null。 */
export function tcpPing(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const start = performance.now()
    let done = false
    const socket = new net.Socket()
    const finish = (v: number | null) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(v)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(Math.round(performance.now() - start)))
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
    socket.connect(port, host)
  })
}

export interface NodeHealth {
  name: string
  server: string
  port: number
  latency: number | null
}

/** 并发测活一批节点（限并发，避免打爆本机）。 */
export async function checkNodes(nodes: ProxyNode[], concurrency = 16, timeoutMs = 3000): Promise<NodeHealth[]> {
  const results: NodeHealth[] = new Array(nodes.length)
  let idx = 0
  async function worker() {
    while (idx < nodes.length) {
      const i = idx++
      const n = nodes[i]!
      const latency = await tcpPing(n.server, n.port, timeoutMs)
      results[i] = { name: n.name, server: n.server, port: n.port, latency }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, nodes.length) }, () => worker()))
  return results
}
