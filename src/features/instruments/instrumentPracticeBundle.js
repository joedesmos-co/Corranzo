/**
 * Instrument-scoped active practice state.
 *
 * Each instrument keeps its own bundle (PDF/MIDI/MusicXML/prefs). Switching
 * instruments saves the outgoing instrument's upload into that instrument's
 * library slot, clears the live practice session, and leaves the destination
 * instrument empty until the user explicitly opens a compatible score.
 *
 * Piano ↔ Guitar must never silently carry an incompatible live practice
 * session. Cross-instrument reuse requires an explicit future action.
 */

import { normalizeInstrumentId } from './instruments.js'

/** An empty bundle — the instrument's Practice starts from the empty state. */
export function createEmptyInstrumentBundle() {
  return {
    instrumentId: null,
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
    instrumentId: state.instrumentId ? normalizeInstrumentId(state.instrumentId) : null,
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
  return Boolean(bundle?.pdfFile && bundle?.pdfBuffer)
}

/**
 * Resolve which bundle to apply on an instrument switch.
 *
 * Default behavior clears the live session. Destination uploads remain in the
 * store for Library reopen, but are not auto-activated (avoids silently
 * converting Piano practice into Guitar practice or vice versa).
 */
export function resolveInstrumentSwitchBundle({
  outgoingBundle = null,
  incomingBundle = null,
  nextInstrumentId = null,
} = {}) {
  void outgoingBundle
  void incomingBundle
  return {
    bundle: {
      ...createEmptyInstrumentBundle(),
      instrumentId: normalizeInstrumentId(nextInstrumentId),
    },
    carried: false,
    clearedLiveSession: true,
  }
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
    bundles.set(key, {
      ...snapshotInstrumentBundle(bundle),
      instrumentId: key,
    })
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
