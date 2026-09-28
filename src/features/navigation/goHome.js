import { pathnameForView } from '../legal/legalRoutes.js'

export const HOME_VIEW = 'home'

/** Logo navigation returns to the dedicated Home; legacy welcome stays retired. */
export function getHomeNavigationTarget() {
  return {
    view: HOME_VIEW,
    pathname: pathnameForView(HOME_VIEW),
    showWelcome: false,
  }
}
