/**
 * Instrument-scoped active practice state.
 *
 * Each instrument (piano, guitar) keeps its own "active file bundle": the
 * loaded PDF, MIDI, timing (MusicXML/MXL/OMR), page position, practice prefs
 * (loop region, Wait For You settings, scrub time), and demo flag. The bundle
 * lets the app save the current instrument's state and restore another
 * instrument's state when the user switches, so nothing bleeds between the two.
 *
 * These are plain snapshots of App-level React state — no timing, playback, or
 * Wait For You matching logic lives here. Legacy (pre-instrument) sessions have
 * no instrument key and always resolve to Piano via normalizeInstrumentId.
 */

import { normalizeInstrumentId } from './instruments.js'

/** An empty bundle — the instrument's Practice starts from the empty state. */
export function createEmptyInstrumentBundle() {
  return {
    pdfFile: null,
    pdfBuffer: null,
    pdfMeta: null,
    fileName: '',
    pageNumber: 1,
    numPages: null,
    midiSource: null,
    musicXmlSource: null,
    practicePrefs: null,
    pdfSoftWarning: null,
    demoPieceActive: false,
  }
}

/**
 * Capture the current App-level active practice state into a plain bundle.
 * `pdfFile` (blob URL) and `pdfBuffer` are referenced, not cloned — ownership
 * stays with the instrument that created them until it is replaced/cleared.
 */
export function snapshotInstrumentBundle(state = {}) {
  return {
    pdfFile: state.pdfFile ?? null,
    pdfBuffer: state.pdfBuffer ?? null,
    pdfMeta: state.pdfMeta ?? null,
    fileName: state.fileName ?? '',
    pageNumber: state.pageNumber ?? 1,
    numPages: state.numPages ?? null,
    midiSource: state.midiSource ?? null,
    musicXmlSource: state.musicXmlSource ?? null,
    practicePrefs: state.practicePrefs ?? null,
    pdfSoftWarning: state.pdfSoftWarning ?? null,
    demoPieceActive: Boolean(state.demoPieceActive),
  }
}

/** True when the bundle has at least a loaded PDF to open in Practice. */
export function bundleHasActiveFile(bundle) {
  return Boolean(bundle?.pdfFile)
}

/**
 * Per-instrument bundle store. Bundles are kept in a Map keyed by the
 * normalized instrument id so lookups tolerate legacy/unknown ids (→ piano).
 */
export function createInstrumentBundleStore() {
  const bundles = new Map()

  function get(instrumentId) {
    const key = normalizeInstrumentId(instrumentId)
    return bundles.get(key) ?? null
  }

  function set(instrumentId, bundle) {
    const key = normalizeInstrumentId(instrumentId)
    bundles.set(key, snapshotInstrumentBundle(bundle))
  }

  function clear(instrumentId) {
    const key = normalizeInstrumentId(instrumentId)
    bundles.delete(key)
  }

  function values() {
    return Array.from(bundles.values())
  }

  function entries() {
    return Array.from(bundles.entries())
  }

  return { get, set, clear, values, entries }
}
