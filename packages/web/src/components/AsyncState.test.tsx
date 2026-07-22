import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListSkeleton, LoadError, PageSkeleton } from './AsyncState'

const render = (children: React.ReactNode) => renderToStaticMarkup(<MantineProvider>{children}</MantineProvider>)

describe('async presentation states', () => {
  it('announces page loading without rendering empty-state content', () => {
    const html = render(<PageSkeleton />)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="正在加载"')
  })

  it('renders the requested number of stable list rows', () => {
    const html = render(<ListSkeleton rows={3} />)

    expect(html.match(/data-skeleton-row=/g)).toHaveLength(3)
  })

  it('renders a local error with a semantic retry action', () => {
    const html = render(<LoadError message="订阅加载失败" onRetry={() => undefined} />)

    expect(html).toContain('role="alert"')
    expect(html).toContain('订阅加载失败')
    expect(html).toMatch(/<button[^>]*>.*重试.*<\/button>/)
  })
})
