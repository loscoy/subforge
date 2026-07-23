export const VIEWS = ['subs', 'profiles', 'mcp', 'settings'] as const

export type View = (typeof VIEWS)[number]

export function isView(value: string | null): value is View {
  return VIEWS.includes(value as View)
}

export function readView(search: string): View {
  const view = new URLSearchParams(search).get('view')
  return isView(view) ? view : 'profiles'
}

export function writeView(search: string, view: View): string {
  const params = new URLSearchParams(search)
  params.set('view', view)
  return `?${params.toString()}`
}
