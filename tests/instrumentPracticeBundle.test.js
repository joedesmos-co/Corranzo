/**
 * Instrument-scoped practice state separation.
 *
 * Piano and Guitar must keep independent active file bundles (PDF/MIDI/MXL/OMR
 * timing, page, practice prefs holding loop + Wait For You + scrub). Switching
 * instruments saves the current bundle and restores the selected one; legacy
 * (pre-instrument) sessions resolve to Piano. These tests exercise the bundle
 * store and a faithful simulation of the App switch/upload flow.
 */
import { describe, expect, it } from 'vitest'
import {
  bundleHasActiveFile,
  createEmptyInstrumentBundle,
  createInstrumentBundleStore,
  snapshotInstrumentBundle,
} from '../src/features/instruments/instrumentPracticeBundle.js'
import { DEFAULT_INSTRUMENT_ID } from '../src/features/instruments/instruments.js'

function makeBundle(overrides = {}) {
  return snapshotInstrumentBundle({
    pdfFile: 'blob:pdf',
    pdfBuffer: new ArrayBuffer(8),
    pdfMeta: { fileName: 'score.pdf', size: 8, lastModified: 1 },
    fileName: 'score.pdf',
    pageNumber: 3,
    numPages: 12,
    midiSource: { fileName: 'score.mid', data: new ArrayBuffer(4) },
    musicXmlSource: { fileName: 'score.musicxml', data: new ArrayBuffer(6) },
    practicePrefs: { practiceTime: 42, loopRegion: { start: 1, end: 2 }, matchSettings: { tolerance: 0.5 } },
    pdfSoftWarning: null,
    demoPieceActive: false,
    ...overrides,
  })
}

/**
 * Minimal, faithful model of App.jsx instrument-switch handling: the live
 * (currently selected) bundle plus a store for the others. On switch we save
 * the outgoing bundle and load the incoming one (empty when none exists).
 */
function makeSwitchHarness(startInstrument = DEFAULT_INSTRUMENT_ID) {
  const store = createInstrumentBundleStore()
  let active = startInstrument
  let live = createEmptyInstrumentBundle()

  return {
    get instrument() {
      return active
    },
    get live() {
      return live
    },
    load(bundle) {
      live = snapshotInstrumentBundle(bundle)
    },
    switchTo(nextInstrument) {
      if (nextInstrument === active) return
      store.set(active, live)
      active = nextInstrument
      live = snapshotInstrumentBundle(store.get(nextInstrument) ?? createEmptyInstrumentBundle())
    },
  }
}

describe('instrument practice bundle', () => {
  it('empty bundle has no active file', () => {
    const empty = createEmptyInstrumentBundle()
    expect(bundleHasActiveFile(empty)).toBe(false)
    expect(empty.pageNumber).toBe(1)
    expect(empty.midiSource).toBeNull()
    expect(empty.musicXmlSource).toBeNull()
    expect(empty.practicePrefs).toBeNull()
  })

  it('snapshot preserves the full active file bundle', () => {
    const bundle = makeBundle()
    expect(bundleHasActiveFile(bundle)).toBe(true)
    expect(bundle.fileName).toBe('score.pdf')
    expect(bundle.pageNumber).toBe(3)
    expect(bundle.midiSource.fileName).toBe('score.mid')
    expect(bundle.musicXmlSource.fileName).toBe('score.musicxml')
    expect(bundle.practicePrefs.loopRegion).toEqual({ start: 1, end: 2 })
  })

  it('store keys legacy/unknown instrument ids to Piano', () => {
    const store = createInstrumentBundleStore()
    store.set('legacy-unknown', makeBundle({ fileName: 'legacy.pdf' }))
    expect(store.get(DEFAULT_INSTRUMENT_ID)?.fileName).toBe('legacy.pdf')
    expect(store.get('piano')?.fileName).toBe('legacy.pdf')
  })

  it('store exposes saved bundles for unmount cleanup', () => {
    const store = createInstrumentBundleStore()
    store.set('piano', makeBundle({ fileName: 'piano.pdf' }))
    store.set('guitar', makeBundle({ fileName: 'guitar.pdf' }))

    expect(store.values().map((bundle) => bundle.fileName).sort()).toEqual([
      'guitar.pdf',
      'piano.pdf',
    ])
    expect(store.entries().map(([instrumentId]) => instrumentId).sort()).toEqual([
      'guitar',
      'piano',
    ])
  })
})

describe('instrument switch state separation', () => {
  it('load Piano files → switch to Guitar → Guitar shows empty state', () => {
    const harness = makeSwitchHarness('piano')
    harness.load(makeBundle({ fileName: 'piano-piece.pdf' }))

    harness.switchTo('guitar')

    expect(harness.instrument).toBe('guitar')
    expect(bundleHasActiveFile(harness.live)).toBe(false)
    expect(harness.live.fileName).toBe('')
  })

  it('load Guitar file → switch to Piano → Piano file restored → switch back → Guitar restored', () => {
    const harness = makeSwitchHarness('piano')
    harness.load(makeBundle({ fileName: 'piano-piece.pdf', pdfFile: 'blob:piano' }))

    harness.switchTo('guitar')
    harness.load(makeBundle({ fileName: 'guitar-piece.pdf', pdfFile: 'blob:guitar' }))

    harness.switchTo('piano')
    expect(harness.live.fileName).toBe('piano-piece.pdf')
    expect(harness.live.pdfFile).toBe('blob:piano')

    harness.switchTo('guitar')
    expect(harness.live.fileName).toBe('guitar-piece.pdf')
    expect(harness.live.pdfFile).toBe('blob:guitar')
  })

  it('uploading a new Piano PDF does not touch the stored Guitar bundle', () => {
    const harness = makeSwitchHarness('piano')
    harness.load(makeBundle({ fileName: 'piano-old.pdf' }))
    harness.switchTo('guitar')
    harness.load(makeBundle({ fileName: 'guitar-piece.pdf', midiSource: { fileName: 'guitar.mid', data: new ArrayBuffer(2) } }))
    harness.switchTo('piano')

    // Simulate a fresh Piano PDF upload clearing companion timing/sound.
    harness.load(snapshotInstrumentBundle({
      pdfFile: 'blob:piano-new',
      fileName: 'piano-new.pdf',
      midiSource: null,
      musicXmlSource: null,
    }))

    harness.switchTo('guitar')
    expect(harness.live.fileName).toBe('guitar-piece.pdf')
    expect(harness.live.midiSource.fileName).toBe('guitar.mid')

    harness.switchTo('piano')
    expect(harness.live.fileName).toBe('piano-new.pdf')
    expect(harness.live.midiSource).toBeNull()
    expect(harness.live.musicXmlSource).toBeNull()
  })

  it('practice prefs (loop / Wait For You / scrub) stay per-instrument', () => {
    const harness = makeSwitchHarness('piano')
    harness.load(makeBundle({ practicePrefs: { practiceTime: 10, loopRegion: { start: 0, end: 4 } } }))
    harness.switchTo('guitar')
    harness.load(makeBundle({ practicePrefs: { practiceTime: 99, loopRegion: { start: 8, end: 16 } } }))

    harness.switchTo('piano')
    expect(harness.live.practicePrefs.practiceTime).toBe(10)
    expect(harness.live.practicePrefs.loopRegion).toEqual({ start: 0, end: 4 })

    harness.switchTo('guitar')
    expect(harness.live.practicePrefs.practiceTime).toBe(99)
    expect(harness.live.practicePrefs.loopRegion).toEqual({ start: 8, end: 16 })
  })

  it('legacy session (no instrumentId) restores onto Piano', () => {
    // Restore path assigns the bundle to the normalized restored instrument.
    const store = createInstrumentBundleStore()
    const restoredInstrument = DEFAULT_INSTRUMENT_ID // legacy → piano
    store.clear(restoredInstrument)
    const restoredLive = snapshotInstrumentBundle(makeBundle({ fileName: 'legacy-session.pdf' }))

    expect(restoredInstrument).toBe('piano')
    expect(restoredLive.fileName).toBe('legacy-session.pdf')
    // Guitar remains empty after a legacy restore.
    expect(store.get('guitar')).toBeNull()
  })
})
