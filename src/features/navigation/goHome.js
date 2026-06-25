import { pathnameForView } from '../legal/legalRoutes.js'

export const HOME_VIEW = 'library'

/** Logo/home navigation always returns to the welcome landing, not only library workspace. */
export function getHomeNavigationTarget() {
  return {
    view: HOME_VIEW,
    pathname: pathnameForView(HOME_VIEW),
    showWelcome: true,
  }
}
