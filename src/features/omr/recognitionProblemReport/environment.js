/**
 * Environment / runtime snapshots for recognition reports (no PII).
 */

export function detectOsCategory(userAgent = '', platform = '') {
  const hay = `${platform} ${userAgent}`.toLowerCase()
  if (/android/.test(hay)) return 'android'
  if (/iphone|ipad|ipod|ios/.test(hay)) return 'ios'
  if (/mac os|macintosh|darwin/.test(hay)) return 'macos'
  if (/windows/.test(hay)) return 'windows'
  if (/linux|cros/.test(hay)) return 'linux'
  return 'unknown'
}

export function detectBrowserNameVersion(userAgent = '') {
  const ua = String(userAgent || '')
  const match =
    ua.match(/Edg\/([\d.]+)/) ||
    ua.match(/Chrome\/([\d.]+)/) ||
    ua.match(/Firefox\/([\d.]+)/) ||
    ua.match(/Version\/([\d.]+).*Safari/) ||
    ua.match(/Safari\/([\d.]+)/)
  let name = 'unknown'
  if (/Edg\//.test(ua)) name = 'edge'
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) name = 'chrome'
  else if (/Firefox\//.test(ua)) name = 'firefox'
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) name = 'safari'
  return {
    name,
    version: match?.[1] ?? null,
  }
}

export function collectRecognitionReportEnvironment({
  navigatorRef = typeof navigator !== 'undefined' ? navigator : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  audioContextState = null,
} = {}) {
  const userAgent = navigatorRef?.userAgent ?? ''
  const platform = navigatorRef?.platform ?? ''
  const browser = detectBrowserNameVersion(userAgent)
  const viewport =
    windowRef && Number.isFinite(windowRef.innerWidth) && Number.isFinite(windowRef.innerHeight)
      ? { width: windowRef.innerWidth, height: windowRef.innerHeight }
      : null
  const displayMode =
    typeof windowRef?.matchMedia === 'function' &&
    windowRef.matchMedia('(display-mode: standalone)').matches
      ? 'standalone'
      : 'browser'
  const standalone =
    displayMode === 'standalone' ||
    Boolean(navigatorRef?.standalone)

  return {
    browserName: browser.name,
    browserVersion: browser.version,
    osCategory: detectOsCategory(userAgent, platform),
    viewport,
    standalone,
    displayMode,
    audioContextState: audioContextState ?? null,
    // Never include full userAgent string in the export (can be identifying).
  }
}

export function getBuildCommitIdentifier() {
  try {
    const env = typeof import.meta !== 'undefined' ? import.meta.env : null
    return (
      env?.VITE_GIT_COMMIT ??
      env?.VITE_COMMIT_SHA ??
      env?.VITE_APP_COMMIT ??
      (typeof window !== 'undefined' ? window.__SCOREFLOW_BUILD__?.commit ?? null : null) ??
      null
    )
  } catch {
    return null
  }
}
