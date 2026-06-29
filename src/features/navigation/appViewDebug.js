export function isAppViewDebugEnabled() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.PROD) {
      return false
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('scoreflow:view-debug') === '0') {
      return false
    }
  } catch {
    // ignore
  }
  return true
}

export function logAppViewDebug(label, detail = null) {
  if (!isAppViewDebugEnabled()) {
    return
  }
  if (detail == null) {
    console.log(`[AppView] ${label}`)
    return
  }
  console.log(`[AppView] ${label}`, detail)
}

export const APP_SHELL_VIEWS = new Set(['library', 'practice', 'profile', 'privacy', 'terms', 'contact'])

export function normalizeAppView(view) {
  if (typeof view === 'string' && APP_SHELL_VIEWS.has(view)) {
    return view
  }
  return 'library'
}
