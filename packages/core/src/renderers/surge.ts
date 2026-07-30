import type { RenderContext } from '../config.js'
import type { ProxyNode } from '../model.js'
import { resolveGroupMembers } from './mihomo.js'

/**
 * Surge 是 INI 风格的「按行 + 逗号分隔」格式，名称里的分隔符会破坏结构，
 * 因此要在本渲染器内消歧义。换行与控制字符已由流水线的 `sanitizeNodeName`
 * 统一剥除（那是所有格式的共同要求）；这里只处理 Surge 专属的元字符：
 * - `,` `=` 是字段分隔符，出现在名字里会被当成新字段；
 * - 行首的 `[` `#` `;` 会让该行变成新的段落或注释。
 *
 * 注：替换后理论上可能与另一个节点名撞车（如 `A,B` 与 `A=B`），流水线已按
 * 真实名字去重，这里不再二次编号——撞车只会让两者共用一个 Surge 条目名，
 * 不影响配置结构的正确性。
 */
export function surgeSafeName(name: string): string {
  const replaced = name.replace(/[,=]/g, '-')
  return /^[[#;]/.test(replaced) ? `_${replaced}` : replaced
}

/** 统一节点 → 一行 Surge proxy 定义；不支持的协议返回注释行。 */
export function nodeToSurge(n: ProxyNode): string {
  const name = surgeSafeName(n.name)
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
      return `${name} = ss, ${n.server}, ${n.port}, encrypt-method=${n.cipher}, password=${n.password}`
    case 'vmess':
      return [
        `${name} = vmess, ${n.server}, ${n.port}, username=${n.uuid}`,
        tls ? 'tls=true' : '',
        ...wsParts,
        ...common,
      ]
        .filter(Boolean)
        .join(', ')
    case 'trojan':
      return [`${name} = trojan, ${n.server}, ${n.port}, password=${n.password}`, ...wsParts, ...common]
        .filter(Boolean)
        .join(', ')
    case 'hysteria2':
      return [`${name} = hysteria2, ${n.server}, ${n.port}, password=${n.password}`, ...common]
        .filter(Boolean)
        .join(', ')
    default:
      // vless / tuic：Surge 不支持
      return `#! ${name}（${n.type} 暂不被 Surge 支持，已跳过）`
  }
}

/** 渲染为 Surge 托管配置文本。 */
export function renderSurge(ctx: RenderContext): string {
  const { nodes, profile } = ctx
  const nodeNames = nodes.map((n) => n.name)

  const proxyLines = nodes.map(nodeToSurge)

  const groupLines = profile.groups.map((g) => {
    // 先用真实名字跑 filter（正则语义不受 Surge 转义影响），再把成员名换成 Surge 安全名，
    // 保证组成员引用与上面 [Proxy] 段里的条目名一致。
    const members = resolveGroupMembers(g, nodeNames).map(surgeSafeName)
    const opts: string[] = []
    if (g.type === 'url-test' || g.type === 'fallback' || g.type === 'load-balance') {
      if (g.url) opts.push(`url=${g.url}`)
      if (g.interval) opts.push(`interval=${g.interval}`)
    }
    return `${surgeSafeName(g.name)} = ${g.type}, ${[...members, ...opts].join(', ')}`
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
