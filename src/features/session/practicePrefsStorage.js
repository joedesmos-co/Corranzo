import { WFY_MATCH_DEFAULTS } from '../practice/waitForYouMatchSettings.js'

const PREFS_KEY = 'scoreflow-practice-prefs-v1'
const ONBOARDING_KEY = 'scoreflow-onboarding-v1'
const DEMO_CARD_KEY = 'scoreflow-demo-card-v1'

export function loadPracticePrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) {
      return null
    }
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function savePracticePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function loadMatchSettingsFromPrefs() {
  const prefs = loadPracticePrefs()
  return prefs?.matchSettings ?? WFY_MATCH_DEFAULTS
}

export function isOnboardingDismissed() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'dismissed'
  } catch {
    return false
  }
}

export function dismissOnboarding() {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'dismissed')
  } catch {
    // ignore
  }
}

/** True after the user tried the demo or uploaded their own files. */
export function isDemoCardHidden() {
  try {
    return localStorage.getItem(DEMO_CARD_KEY) === 'hidden'
  } catch {
    return false
  }
}

export function hideDemoCard() {
  try {
    localStorage.setItem(DEMO_CARD_KEY, 'hidden')
  } catch {
    // ignore
  }
}
