import { describe, expect, it } from 'vitest'
import { readView, writeView } from './navigation'

describe('top-level navigation', () => {
  it('reads a supported view and falls back for invalid values', () => {
    expect(readView('?view=mcp')).toBe('mcp')
    expect(readView('?view=unknown')).toBe('profiles')
    expect(readView('')).toBe('profiles')
  })

  it('updates the view while preserving unrelated query parameters', () => {
    expect(writeView('?foo=1', 'subs')).toBe('?foo=1&view=subs')
    expect(writeView('?view=mcp&foo=1', 'agent')).toBe('?view=agent&foo=1')
  })
})
