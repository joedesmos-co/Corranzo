export const LEGAL_VIEWS = ['privacy', 'terms', 'contact']

export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  contact: '/contact',
}

const PATH_TO_VIEW = Object.fromEntries(
  Object.entries(LEGAL_PATHS).map(([view, path]) => [path, view]),
)

export function isLegalView(view) {
  return LEGAL_VIEWS.includes(view)
}

export function getViewFromPathname(pathname) {
  return PATH_TO_VIEW[pathname] ?? null
}

export function pathForLegalView(view) {
  return LEGAL_PATHS[view] ?? '/'
}

export function isLegalPathname(pathname) {
  return getViewFromPathname(pathname) != null
}
