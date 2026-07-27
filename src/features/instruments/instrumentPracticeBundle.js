/**
 * Instrument-scoped active practice state.
 *
 * Each instrument keeps its own bundle (PDF/MIDI/MusicXML/prefs). Switching
 * instruments restores that instrument's saved bundle when one exists.
 *
 * When the destination instrument has no score yet, the active score is
 * carried forward so Piano↔Guitar keep the same score identity. Instrument-
 * specific derived state (fret maps, WFY prefs) is still reset via the App
 * epoch/remount path.
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
 * Carry an active score into an empty instrument slot.
 * Clones PDF blob URL + ArrayBuffers so each instrument can clear independently.
 * Practice prefs are not carried — those stay instrument-specific.
 */
export function carryScoreBundleToInstrument(sourceBundle, nextInstrumentId) {
  if (!bundleHasActiveFile(sourceBundle)) {
    return createEmptyInstrumentBundle()
  }
  const pdfBuffer = sourceBundle.pdfBuffer.slice(0)
  let pdfFile = sourceBundle.pdfFile
  if (typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
    pdfFile = URL.createObjectURL(new Blob([pdfBuffer], { type: 'application/pdf' }))
  }
  const cloneCompanion = (companion) => {
    if (!companion?.data) {
      return companion ?? null
    }
    return {
      ...companion,
      data: companion.data.slice(0),
    }
  }
  return snapshotInstrumentBundle({
    ...sourceBundle,
    instrumentId: normalizeInstrumentId(nextInstrumentId),
    pdfFile,
    pdfBuffer,
    midiSource: cloneCompanion(sourceBundle.midiSource),
    musicXmlSource: cloneCompanion(sourceBundle.musicXmlSource),
    practicePrefs: null,
  })
}

/**
 * Resolve which bundle to apply on an instrument switch.
 * - Destination has its own score → use it
 * - Destination empty + source has score → carry source score
 * - Otherwise → empty
 */
export function resolveInstrumentSwitchBundle({
  outgoingBundle = null,
  incomingBundle = null,
  nextInstrumentId = null,
} = {}) {
  if (bundleHasActiveFile(incomingBundle)) {
    return {
      bundle: snapshotInstrumentBundle({
        ...incomingBundle,
        instrumentId: normalizeInstrumentId(nextInstrumentId),
      }),
      carried: false,
    }
  }
  if (bundleHasActiveFile(outgoingBundle)) {
    return {
      bundle: carryScoreBundleToInstrument(outgoingBundle, nextInstrumentId),
      carried: true,
    }
  }
  return {
    bundle: createEmptyInstrumentBundle(),
    carried: false,
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
