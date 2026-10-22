import { getViewFromPathname, isLegalPathname, isAppView } from '../legal/legalRoutes.js'
import { normalizeAppView } from '../navigation/appViewDebug.js'

/** Session restore must not run while the user is on a legal/compliance page. */
export function shouldDeferSessionRestore(pathname) {
  return isLegalPathname(pathname)
}

/**
 * Pick the view after file restore. A legal URL or app-view hash always wins
 * over saved practice state.
 */
export function resolveRestoredActiveView({ location, savedActiveView, hasMusicXml }) {
  const legalView = getViewFromPathname(location?.pathname)
  if (legalView) {
    return legalView
  }
  const hashView = String(location?.hash ?? '').replace(/^#\/?/, '')
  if (isAppView(hashView)) {
    return hashView
  }
  if (!hasMusicXml) {
    return 'library'
  }
  return normalizeAppView(savedActiveView ?? 'library')
}
