import { expect, it } from 'vitest'
import { getRenderer, makeNode, parseSubscription, runPipeline } from '../index.js'

it('URI 导出保留 Unicode 名称、IPv6、转义凭据与 TLS/传输参数', async () => {
  const raw = 'vless://a-b-c@[2606:4700::1]:443?security=reality&pbk=pub&sid=abcd&type=ws&path=%2Fws&sni=cdn.example.com#香港%20A\n' +
    'trojan://p%40ss%3A%23@example.com:8443?sni=secure.example.com#B'
  const out = await runPipeline({ rawSubscriptions: [raw], target: 'uri', profile: { groups: [], rules: [] } })
  const parsed = parseSubscription(out.config)
  expect(parsed).toHaveLength(2)
  expect(parsed[0]).toMatchObject({ name: '香港 A', server: '[2606:4700::1]', port: 443, tls: { realityPublicKey: 'pub', realityShortId: 'abcd' }, transport: { network: 'ws', path: '/ws' } })
  expect(parsed[1]).toMatchObject({ name: 'B', password: 'p@ss:#', port: 8443 })
})

it('URI 不能表达的字段明确报错，JSON 仍完整导出', () => {
  const node = makeNode({ name: 'headers', type: 'trojan', server: 'example.com', port: 443, password: 'p', transport: { network: 'ws', path: '/', wsHeaders: { 'X-Key': 'value' } } })
  const ctx = { nodes: [node], profile: { groups: [], rules: [] } }
  expect(() => getRenderer('uri')!.render(ctx)).toThrow('transport.wsHeaders.X-Key')
  expect(JSON.parse(getRenderer('node-json')!.render(ctx))[0].transport.wsHeaders).toEqual({ 'X-Key': 'value' })
})
