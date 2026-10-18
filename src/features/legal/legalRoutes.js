export const LEGAL_VIEWS = ['privacy', 'terms', 'contact']

export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  contact: '/contact',
}

const PATH_TO_VIEW = Object.fromEntries(
  Object.entries(LEGAL_PATHS).map(([view, path]) => [path, view]),
)

// App shell views live in the URL hash (e.g. /#library) rather than the path.
// A hash is never sent to the worker/CDN, so the server URL contract is
// unchanged, yet every view change still becomes a real browser history entry
// — which is what makes Back/Forward move between views instead of leaving the
// app. (When every app view shared the bare "/" path, no entry was ever pushed
// and the browser Back button dropped the user onto about:blank.)
const APP_VIEWS = new Set(['home', 'library', 'import', 'practice', 'profile', 'settings'])

export function isLegalView(view) {
  return LEGAL_VIEWS.includes(view)
}

export function isAppView(view) {
  return APP_VIEWS.has(view)
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

/** Browser path for a top-level view (legal pages have dedicated paths; app views use a hash). */
export function pathnameForView(view) {
  if (isLegalView(view)) {
    return pathForLegalView(view)
  }
  if (APP_VIEWS.has(view)) {
    return `/#${view}`
  }
  return '/'
}

/**
 * Resolve the current view from a location: a legal path always wins, then the
 * app-view hash, then Home. Used on load and on every popstate.
 */
export function getViewFromLocation(location = window.location) {
  const legalView = getViewFromPathname(location?.pathname)
  if (legalView) {
    return legalView
  }
  const hashView = String(location?.hash ?? '').replace(/^#\/?/, '')
  if (APP_VIEWS.has(hashView)) {
    return hashView
  }
  return 'home'
}

/** Current in-app path (path + hash) for pushState change detection. */
export function currentViewPath(location = window.location) {
  const path = location?.pathname ?? '/'
  const hash = String(location?.hash ?? '')
  return hash ? `${path}${hash}` : path
}
