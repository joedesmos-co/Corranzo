import { getViewFromPathname, isLegalPathname } from '../legal/legalRoutes.js'

/** Session restore must not run while the user is on a legal/compliance page. */
export function shouldDeferSessionRestore(pathname) {
  return isLegalPathname(pathname)
}

/**
 * Pick the view after file restore. Legal URL always wins over saved practice state.
 */
export function resolveRestoredActiveView({ pathname, savedActiveView, hasMusicXml }) {
  const legalView = getViewFromPathname(pathname)
  if (legalView) {
    return legalView
  }
  if (!hasMusicXml) {
    return 'library'
  }
  return savedActiveView ?? 'library'
}
