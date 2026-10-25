/**
 * Experimental recognition flag.
 *
 * Default: off. The flag is intentionally explicit and local (URL or
 * localStorage); the standard image/vector OMR path stays the default for
 * every existing user. The flag only selects an experimental client; it never
 * silently replaces the standard path.
 */
const STORAGE_KEY = 'corranzo-experimental-vision-engine-v1'

export const EXPERIMENTAL_VISION_MODES = Object.freeze({
  PIANO: 'piano-vector',
  GUITAR: 'guitar-vector',
})

function normalize(value) {
  if (value === EXPERIMENTAL_VISION_MODES.PIANO || value === 'piano') return EXPERIMENTAL_VISION_MODES.PIANO
  if (value === EXPERIMENTAL_VISION_MODES.GUITAR || value === 'guitar') return EXPERIMENTAL_VISION_MODES.GUITAR
  return null
}

/** Read the opt-in mode. URL wins so a test/link can be explicit. */
export function getExperimentalVisionMode() {
  try {
    const fromUrl = normalize(new URLSearchParams(globalThis.location?.search ?? '').get('experimentalVision'))
    if (fromUrl) return fromUrl
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return normalize(stored)
  } catch {
    return null
  }
}

export function setExperimentalVisionMode(mode) {
  try {
    const normalized = normalize(mode)
    if (normalized) globalThis.localStorage?.setItem(STORAGE_KEY, normalized)
    else globalThis.localStorage?.removeItem(STORAGE_KEY)
    return normalized
  } catch {
    return null
  }
}

export function clearExperimentalVisionMode() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // ignore private-mode/storage failures
  }
}

export function experimentalVisionLabel(mode = getExperimentalVisionMode()) {
  if (mode === EXPERIMENTAL_VISION_MODES.PIANO) return 'Experimental piano vector recognition'
  if (mode === EXPERIMENTAL_VISION_MODES.GUITAR) return 'Experimental guitar TAB recognition'
  return null
}
