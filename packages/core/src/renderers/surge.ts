import type { RenderContext } from '../config.js'
import type { ProxyNode } from '../model.js'
import { resolveGroupMembers } from './mihomo.js'

/** 统一节点 → 一行 Surge proxy 定义；不支持的协议返回注释行。 */
export function nodeToSurge(n: ProxyNode): string {
  const tls = !!n.tls?.enabled
  const common: string[] = []
  if (tls) {
    if (n.tls?.sni) common.push(`sni=${n.tls.sni}`)
    if (n.tls?.skipCertVerify) common.push('skip-cert-verify=true')
  }
  const ws = n.transport?.network === 'ws'
  const wsParts: string[] = []
  if (ws) {
    wsParts.push('ws=true')
    if (n.transport?.path) wsParts.push(`ws-path=${n.transport.path}`)
    if (n.transport?.host) wsParts.push(`ws-headers=Host:${n.transport.host}`)
  }

  switch (n.type) {
    case 'ss':
      return `${n.name} = ss, ${n.server}, ${n.port}, encrypt-method=${n.cipher}, password=${n.password}`
    case 'vmess':
      return [
        `${n.name} = vmess, ${n.server}, ${n.port}, username=${n.uuid}`,
        tls ? 'tls=true' : '',
        ...wsParts,
        ...common,
      ]
        .filter(Boolean)
        .join(', ')
    case 'trojan':
      return [`${n.name} = trojan, ${n.server}, ${n.port}, password=${n.password}`, ...wsParts, ...common]
        .filter(Boolean)
        .join(', ')
    case 'hysteria2':
      return [`${n.name} = hysteria2, ${n.server}, ${n.port}, password=${n.password}`, ...common]
        .filter(Boolean)
        .join(', ')
    default:
      // vless / tuic：Surge 不支持
      return `#! ${n.name}（${n.type} 暂不被 Surge 支持，已跳过）`
  }
}

/** 渲染为 Surge 托管配置文本。 */
export function renderSurge(ctx: RenderContext): string {
  const { nodes, profile } = ctx
  const nodeNames = nodes.map((n) => n.name)

  const proxyLines = nodes.map(nodeToSurge)

  const groupLines = profile.groups.map((g) => {
    const members = resolveGroupMembers(g, nodeNames)
    const opts: string[] = []
    if (g.type === 'url-test' || g.type === 'fallback' || g.type === 'load-balance') {
      if (g.url) opts.push(`url=${g.url}`)
      if (g.interval) opts.push(`interval=${g.interval}`)
    }
    return `${g.name} = ${g.type}, ${[...members, ...opts].join(', ')}`
  })

  const ruleLines = profile.rules.map((r) => {
    const parts = r.split(',').map((s) => s.trim())
    if (parts[0]?.toUpperCase() === 'MATCH') return `FINAL,${parts[1]}`
    return r
  })

  return [
    '#!MANAGED-CONFIG interval=86400',
    '',
    '[General]',
    'loglevel = notify',
    '',
    '[Proxy]',
    'DIRECT = direct',
    ...proxyLines,
    '',
    '[Proxy Group]',
    ...groupLines,
    '',
    '[Rule]',
    ...ruleLines,
    '',
  ].join('\n')
}
