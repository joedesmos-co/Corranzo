/**
 * PRIORITY 3 — per-recording tempo correction persistence.
 *
 * A reviewer who corrects a tempo for one recording should not have to correct
 * it again on the next visit. Corrections are keyed by a stable source
 * fingerprint (name + size + lastModified — the same scheme annotations use),
 * so a correction can never be applied to an unrelated recording.
 *
 * The store is intentionally tiny and mirrors the existing annotationStorage /
 * scoreFollowStorage shape (safe-JSON, quota-tolerant, null on any failure).
 */

const STORAGE_PREFIX = 'scoreflow-audio-tempo-'

export function getAudioFingerprint(file) {
  if (!file) return null
  return `${file.name}::${file.size}::${file.lastModified ?? 0}`
}

export function getTempoStorageKey(fingerprint) {
  return `${STORAGE_PREFIX}${fingerprint}`
}

/**
 * Load a previously approved correction. Returns { bpm, updatedAt } or null.
 * Invalid/out-of-range payloads are dropped so a stale entry never overrides a
 * newer estimate.
 */
export function loadTempoCorrection(fingerprint) {
  if (!fingerprint || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(getTempoStorageKey(fingerprint))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const bpm = Number(parsed?.bpm)
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) return null
    return { bpm: Math.round(bpm), updatedAt: parsed.updatedAt ?? null }
  } catch {
    return null
  }
}

/** Persist a correction. Returns true when it was stored. */
export function saveTempoCorrection(fingerprint, bpm) {
  if (!fingerprint || typeof localStorage === 'undefined') return false
  const value = Number(bpm)
  if (!Number.isFinite(value) || value < 30 || value > 300) return false
  try {
    localStorage.setItem(
      getTempoStorageKey(fingerprint),
      JSON.stringify({ bpm: Math.round(value), updatedAt: Date.now() }),
    )
    return true
  } catch {
    return false
  }
}

export function clearTempoCorrection(fingerprint) {
  if (!fingerprint || typeof localStorage === 'undefined') return false
  try {
    localStorage.removeItem(getTempoStorageKey(fingerprint))
    return true
  } catch {
    return false
  }
}
