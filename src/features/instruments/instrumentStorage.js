import { DEFAULT_INSTRUMENT_ID, normalizeInstrumentId } from './instruments.js'

/**
 * Persisted instrument selection. Storage failures (private browsing, quota)
 * degrade to the in-memory default — never throw into UI code.
 */
const INSTRUMENT_KEY = 'corranzo-instrument-v1'

export function loadSelectedInstrumentId() {
  try {
    return normalizeInstrumentId(localStorage.getItem(INSTRUMENT_KEY))
  } catch {
    return DEFAULT_INSTRUMENT_ID
  }
}

export function saveSelectedInstrumentId(id) {
  try {
    localStorage.setItem(INSTRUMENT_KEY, normalizeInstrumentId(id))
    return true
  } catch {
    return false
  }
}
