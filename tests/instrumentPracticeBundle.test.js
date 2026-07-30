/**
 * Instrument-scoped practice state separation.
 *
 * Piano and Guitar keep independent library uploads. Switching instruments
 * saves the outgoing live bundle into that instrument's store, clears the live
 * practice session, and does not silently carry Piano practice into Guitar
 * (or vice versa).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bundleHasActiveFile,
  createEmptyInstrumentBundle,
  createInstrumentBundleStore,
  snapshotInstrumentBundle,
  resolveInstrumentSwitchBundle,
} from '../src/features/instruments/instrumentPracticeBundle.js'
import { DEFAULT_INSTRUMENT_ID } from '../src/features/instruments/instruments.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

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
 * Faithful model of App.jsx instrument-switch handling: save non-empty outgoing
 * bundles for Library reopen, clear live session, do not carry into destination.
 */
function makeSwitchHarness(startInstrument = DEFAULT_INSTRUMENT_ID) {
  const store = createInstrumentBundleStore()
  let active = startInstrument
  let live = createEmptyInstrumentBundle()
  let view = 'practice'

  return {
    get instrument() {
      return active
    },
    get live() {
      return live
    },
    get view() {
      return view
    },
    getStored(instrumentId) {
      return store.get(instrumentId)
    },
    load(bundle) {
      live = snapshotInstrumentBundle(bundle)
    },
    switchTo(nextInstrument) {
      if (nextInstrument === active) return
      if (bundleHasActiveFile(live)) {
        store.set(active, live)
      }
      const { bundle: nextBundle, carried } = resolveInstrumentSwitchBundle({
        outgoingBundle: live,
        incomingBundle: store.get(nextInstrument),
        nextInstrumentId: nextInstrument,
      })
      expect(carried).toBe(false)
      active = nextInstrument
      live = snapshotInstrumentBundle({
        ...nextBundle,
        practicePrefs: store.get(nextInstrument)?.practicePrefs ?? null,
      })
      view = 'library'
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
    expect(store.get('guitar')?.instrumentId).toBe('guitar')
    expect(store.get('piano')?.instrumentId).toBe('piano')
    expect(store.entries().map(([instrumentId]) => instrumentId).sort()).toEqual([
      'guitar',
      'piano',
    ])
  })

  it('clearing one uploaded instrument bundle leaves the other bundle intact', () => {
    const store = createInstrumentBundleStore()
    store.set('piano', makeBundle({ fileName: 'piano-upload.pdf' }))
    store.set('guitar', makeBundle({ fileName: 'guitar-upload.pdf' }))

    store.clear('guitar')

    expect(store.get('guitar')).toBeNull()
    expect(store.get('piano')?.fileName).toBe('piano-upload.pdf')
  })
})

describe('instrument switch state separation', () => {
  it('load Piano files → switch to Guitar → clears live session and keeps Piano upload', () => {
    const harness = makeSwitchHarness('piano')
    harness.load(makeBundle({ fileName: 'piano-piece.pdf', pdfFile: 'blob:piano', pdfBuffer: new ArrayBuffer(8) }))

    harness.switchTo('guitar')

    expect(harness.instrument).toBe('guitar')
    expect(harness.view).toBe('library')
    expect(bundleHasActiveFile(harness.live)).toBe(false)
    expect(harness.getStored('piano')?.fileName).toBe('piano-piece.pdf')
    expect(harness.getStored('guitar')).toBeNull()
  })

  it('load Guitar file → switch to Piano → Piano upload restored in store → reopen clears live again', () => {
    const harness = makeSwitchHarness('piano')
    harness.load(makeBundle({ fileName: 'piano-piece.pdf', pdfFile: 'blob:piano', pdfBuffer: new ArrayBuffer(4) }))

    harness.switchTo('guitar')
    harness.load(makeBundle({ fileName: 'guitar-piece.pdf', pdfFile: 'blob:guitar', pdfBuffer: new ArrayBuffer(4) }))

    harness.switchTo('piano')
    expect(bundleHasActiveFile(harness.live)).toBe(false)
    expect(harness.view).toBe('library')
    expect(harness.getStored('piano')?.fileName).toBe('piano-piece.pdf')
    expect(harness.getStored('guitar')?.fileName).toBe('guitar-piece.pdf')

    harness.switchTo('guitar')
    expect(bundleHasActiveFile(harness.live)).toBe(false)
    expect(harness.getStored('guitar')?.fileName).toBe('guitar-piece.pdf')
  })

  it('uploading a new Piano PDF does not touch the stored Guitar bundle', () => {
    const harness = makeSwitchHarness('piano')
    harness.load(makeBundle({ fileName: 'piano-old.pdf' }))
    harness.switchTo('guitar')
    harness.load(makeBundle({ fileName: 'guitar-piece.pdf', midiSource: { fileName: 'guitar.mid', data: new ArrayBuffer(2) } }))
    harness.switchTo('piano')

    // Simulate opening Piano from Library then uploading a replacement.
    harness.load(snapshotInstrumentBundle({
      pdfFile: 'blob:piano-new',
      pdfBuffer: new ArrayBuffer(8),
      fileName: 'piano-new.pdf',
      midiSource: null,
      musicXmlSource: null,
    }))

    harness.switchTo('guitar')
    expect(bundleHasActiveFile(harness.live)).toBe(false)
    expect(harness.getStored('guitar')?.fileName).toBe('guitar-piece.pdf')
    expect(harness.getStored('guitar')?.midiSource.fileName).toBe('guitar.mid')
    expect(harness.getStored('piano')?.fileName).toBe('piano-new.pdf')
  })

  it('practice prefs (loop / Wait For You / scrub) stay per-instrument in the store', () => {
    const harness = makeSwitchHarness('piano')
    harness.load(makeBundle({ practicePrefs: { practiceTime: 10, loopRegion: { start: 0, end: 4 } } }))
    harness.switchTo('guitar')
    harness.load(makeBundle({ practicePrefs: { practiceTime: 99, loopRegion: { start: 8, end: 16 } } }))

    harness.switchTo('piano')
    expect(harness.live.practicePrefs.practiceTime).toBe(10)
    expect(harness.live.practicePrefs.loopRegion).toEqual({ start: 0, end: 4 })
    expect(harness.getStored('piano')?.practicePrefs.practiceTime).toBe(10)

    harness.switchTo('guitar')
    expect(harness.live.practicePrefs.practiceTime).toBe(99)
    expect(harness.live.practicePrefs.loopRegion).toEqual({ start: 8, end: 16 })
  })

  it('applying a cleared switch remounts practice and navigates to Library', () => {
    // practiceMode / checkpointMode / wfyInputSource / loop / scrub time are
    // mount-time state inside usePracticeSession. Without a remount keyed on
    // the bundle epoch, switching instruments leaked the previous instrument's
    // WFY mode and input source into the incoming one.
    const app = readSrc('App.jsx')
    expect(app).toContain('setPracticeRemountKey')
    expect(app).toContain('instrument-switch-session-cleared')
    expect(app).toContain("navigateToView('library')")
    expect(app).toMatch(/key=\{`\$\{practiceSessionEpoch\}:\$\{practiceRemountKey\}`\}/)
    expect(app).not.toContain('instrument-switch-score-retained')
  })

  it('legacy session (no instrumentId) restores onto Piano', () => {
    const store = createInstrumentBundleStore()
    const restoredInstrument = DEFAULT_INSTRUMENT_ID // legacy → piano
    store.clear(restoredInstrument)
    const restoredLive = snapshotInstrumentBundle(makeBundle({ fileName: 'legacy-session.pdf' }))

    expect(restoredInstrument).toBe('piano')
    expect(restoredLive.fileName).toBe('legacy-session.pdf')
    expect(store.get('guitar')).toBeNull()
  })

  it('resolveInstrumentSwitchBundle never carries incompatible live scores', () => {
    const result = resolveInstrumentSwitchBundle({
      outgoingBundle: makeBundle({ fileName: 'piano.pdf' }),
      incomingBundle: null,
      nextInstrumentId: 'guitar',
    })
    expect(result.carried).toBe(false)
    expect(result.clearedLiveSession).toBe(true)
    expect(bundleHasActiveFile(result.bundle)).toBe(false)
    expect(result.bundle.instrumentId).toBe('guitar')
  })
})
