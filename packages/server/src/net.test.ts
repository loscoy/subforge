import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl, isPrivateIpv4, isPrivateIpv6 } from './net.js'

describe('SSRF 防护 assertPublicHttpUrl', () => {
  it('放行正常公网 http(s) URL', () => {
    expect(assertPublicHttpUrl('https://sub.example.com/clash?token=1').hostname).toBe('sub.example.com')
    expect(() => assertPublicHttpUrl('http://1.1.1.1/sub')).not.toThrow()
  })

  it('拒绝非 http(s) 协议', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow()
    expect(() => assertPublicHttpUrl('ftp://x/y')).toThrow()
    expect(() => assertPublicHttpUrl('gopher://x')).toThrow()
  })

  it('拒绝 localhost 与本机', () => {
    expect(() => assertPublicHttpUrl('http://localhost/sub')).toThrow()
    expect(() => assertPublicHttpUrl('http://foo.localhost/sub')).toThrow()
    expect(() => assertPublicHttpUrl('http://127.0.0.1:8787/x')).toThrow()
    expect(() => assertPublicHttpUrl('http://[::1]/x')).toThrow()
  })

  it('拒绝私网与云元数据地址', () => {
    expect(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toThrow()
    expect(() => assertPublicHttpUrl('http://10.0.0.5/x')).toThrow()
    expect(() => assertPublicHttpUrl('http://172.16.3.4/x')).toThrow()
    expect(() => assertPublicHttpUrl('http://192.168.1.1/x')).toThrow()
    expect(() => assertPublicHttpUrl('http://0.0.0.0/x')).toThrow()
  })

  it('拒绝非法 URL', () => {
    expect(() => assertPublicHttpUrl('not a url')).toThrow()
  })

  it('IPv4/IPv6 私网判断', () => {
    expect(isPrivateIpv4('172.15.0.1')).toBe(false) // 172.16-31 才是私网
    expect(isPrivateIpv4('172.20.0.1')).toBe(true)
    expect(isPrivateIpv4('8.8.8.8')).toBe(false)
    expect(isPrivateIpv6('fd00::1')).toBe(true)
    expect(isPrivateIpv6('fe80::1')).toBe(true)
    expect(isPrivateIpv6('2606:4700::1')).toBe(false)
  })
})
