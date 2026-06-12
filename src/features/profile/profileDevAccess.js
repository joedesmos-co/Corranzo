import { isDemoSampleEnabled } from '../demo/demoSampleAccess.js'

/** Dev/demo-only Profile helpers (seed stats for screenshots). */
export function isProfileDevToolsEnabled() {
  return isDemoSampleEnabled()
}
