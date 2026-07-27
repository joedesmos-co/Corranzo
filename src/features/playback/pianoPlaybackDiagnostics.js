/**
 * DEV / opt-in Piano audio-engine diagnostics (Audio Rendering Sprint 1).
 *
 * Enable in production: localStorage['corranzo-piano-perf'] = '1'
 */

const PERF_STORAGE_KEY = 'corranzo-piano-perf'

export function isPianoPerfEnabled() {
  const mode = import.meta?.env?.MODE
  const isDev = Boolean(import.meta?.env?.DEV)
  // Keep unit-test / Node harness output clean unless explicitly opted in.
  if (mode === 'test' || typeof window === 'undefined') {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(PERF_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  }
  if (isDev) {
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

/** Snapshot of the piano audio engine (required Sprint 1 DEV report). */
export function logPianoAudioEngine(detail = {}) {
  if (!isPianoPerfEnabled()) {
    return
  }
  console.info('PIANO AUDIO ENGINE:', {
    engineType: detail.engineType ?? null,
    sampleSet: detail.sampleSet ?? null,
    sampleLoadState: detail.sampleLoadState ?? null,
    loadedSampleCount: detail.loadedSampleCount ?? 0,
    missingSampleCount: detail.missingSampleCount ?? 0,
    velocityLayers: detail.velocityLayers ?? 1,
    audioContextState: detail.audioContextState ?? null,
    sampleBaseUrl: detail.sampleBaseUrl ?? null,
    loadError: detail.loadError ?? null,
    ts: performance.now(),
  })
}

/** Per-note trigger diagnostics (required Sprint 1 DEV report). */
export function logPianoTrigger(detail = {}) {
  if (!isPianoPerfEnabled()) {
    return
  }
  console.debug('PIANO TRIGGER:', {
    midi: detail.midi ?? null,
    velocity: detail.velocity ?? null,
    performedOnset: detail.performedOnset ?? null,
    performedDuration: detail.performedDuration ?? null,
    sampleSelected: detail.sampleSelected ?? null,
    velocityLayer: detail.velocityLayer ?? 0,
    gain: detail.gain ?? null,
    attack: detail.attack ?? null,
    release: detail.release ?? null,
    tieChainId: detail.tieChainId ?? null,
    voiceId: detail.voiceId ?? null,
    engineType: detail.engineType ?? null,
    ts: performance.now(),
  })
}

export function logPianoSampleFallback(reason, detail = {}) {
  if (!isPianoPerfEnabled()) {
    return
  }
  console.warn('PIANO SAMPLE FALLBACK:', reason, {
    ...detail,
    ts: performance.now(),
  })
}
