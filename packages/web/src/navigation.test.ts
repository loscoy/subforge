import { MantineProvider } from '@mantine/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { readView, writeView } from './navigation'

describe('top-level navigation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a supported view and falls back for invalid values', () => {
    expect(readView('?view=mcp')).toBe('mcp')
    expect(readView('?view=unknown')).toBe('profiles')
    // Agent 已从独立页改为抽屉，旧链接回落到配置页
    expect(readView('?view=agent')).toBe('profiles')
    expect(readView('')).toBe('profiles')
  })

  it('updates the view while preserving unrelated query parameters', () => {
    expect(writeView('?foo=1', 'subs')).toBe('?foo=1&view=subs')
    expect(writeView('?view=mcp&foo=1', 'profiles')).toBe('?view=profiles&foo=1')
  })

  it('renders focusable links with URL-backed destinations', () => {
    vi.stubGlobal('localStorage', { getItem: () => '', setItem: () => {} })
    vi.stubGlobal('window', {
      location: { pathname: '/', search: '?foo=1&view=profiles', hash: '#content' },
      history: { pushState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    })

    const html = renderToStaticMarkup(createElement(MantineProvider, null, createElement(App)))

    expect(html).toContain('href="/?foo=1&amp;view=subs#content"')
    expect(html).toContain('href="/?foo=1&amp;view=profiles#content"')
    expect(html).toContain('href="/?foo=1&amp;view=mcp#content"')
  })
})
