/**
 * Dev / opt-in diagnostics for piano playback voice load.
 */

const PERF_STORAGE_KEY = 'corranzo-piano-perf'

export function isPianoPerfEnabled() {
  if (import.meta.env.DEV) {
    return true
  }
  try {
    return localStorage.getItem(PERF_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function logPianoDiagnostics(label, detail = {}) {
  if (!isPianoPerfEnabled()) {
    return
  }
  console.debug(`[piano-perf] ${label}`, { ...detail, ts: performance.now() })
}

export function warnDensePlayback(detail = {}) {
  if (!isPianoPerfEnabled()) {
    return
  }
  if ((detail.maxSimultaneous ?? 0) >= 8 || (detail.densityReduced ?? 0) > 0) {
    console.debug('[piano-perf] dense passage', detail)
  }
}
