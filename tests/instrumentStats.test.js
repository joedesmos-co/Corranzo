/**
 * Instrument-aware stats: sessions and piece aggregates record the instrument;
 * legacy records normalize to piano; no parallel stats implementations.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEmptyStats,
  normalizeStats,
} from '../src/features/profile/profileStatsSchema.js'
import { saveManualSession } from '../src/features/profile/manualPracticeLog.js'
import {
  beginAutoPracticeSession,
  endAutoPracticeSession,
  tickAutoPracticeSession,
  __resetAutoPracticeSession,
} from '../src/features/profile/autoPracticeTracker.js'
import {
  buildSessionMeta,
  validateRestoredInstrumentBundles,
} from '../src/features/session/sessionPersistence.js'

function installFakeStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
}

describe('profile stats schema — instrument fields', () => {
  it('normalizes legacy sessions (no instrument) to piano', () => {
    const stats = normalizeStats({
      recentSessions: [
        {
          pieceId: 'piece:a',
          pieceTitle: 'Old Piece',
          source: 'manual',
          endedAt: 1700000000000,
          durationSeconds: 300,
        },
      ],
    })
    expect(stats.recentSessions[0].instrumentId).toBe('piano')
  })

  it('keeps guitar sessions as guitar and sanitizes junk values', () => {
    const stats = normalizeStats({
      recentSessions: [
        {
          pieceId: 'piece:a',
          pieceTitle: 'Guitar Piece',
          source: 'manual',
          endedAt: 1700000000000,
          durationSeconds: 60,
          instrumentId: 'guitar',
        },
        {
          pieceId: 'piece:b',
          pieceTitle: 'Junk Piece',
          source: 'manual',
          endedAt: 1700000000001,
          durationSeconds: 60,
          instrumentId: 'banjo',
        },
      ],
    })
    const byPiece = Object.fromEntries(
      stats.recentSessions.map((session) => [session.pieceId, session]),
    )
    expect(byPiece['piece:a'].instrumentId).toBe('guitar')
    expect(byPiece['piece:b'].instrumentId).toBe('piano')
  })

  it('normalizes piece aggregates with a lastInstrumentId', () => {
    const stats = normalizeStats({
      pieces: {
        'piece:a': { id: 'piece:a', title: 'A', totalPracticeSeconds: 10 },
        'piece:b': {
          id: 'piece:b',
          title: 'B',
          totalPracticeSeconds: 10,
          lastInstrumentId: 'guitar',
        },
      },
    })
    expect(stats.pieces['piece:a'].lastInstrumentId).toBe('piano')
    expect(stats.pieces['piece:b'].lastInstrumentId).toBe('guitar')
  })

  it('empty stats stay shaped as before (single implementation)', () => {
    const empty = createEmptyStats()
    expect(empty.totalPracticeSeconds).toBe(0)
    expect(empty.recentSessions).toEqual([])
  })
})

describe('manual practice log — instrument recording', () => {
  beforeEach(installFakeStorage)

  it('stores the instrument on the session and the piece', () => {
    const stats = saveManualSession({
      pieceTitle: 'Lágrima',
      exerciseType: 'repertoire',
      durationSeconds: 240,
      instrumentId: 'guitar',
    })
    expect(stats.recentSessions[0].instrumentId).toBe('guitar')
    const piece = Object.values(stats.pieces)[0]
    expect(piece.lastInstrumentId).toBe('guitar')
  })

  it('defaults to piano when no instrument is supplied (legacy callers)', () => {
    const stats = saveManualSession({
      pieceTitle: 'Nocturne',
      exerciseType: 'repertoire',
      durationSeconds: 120,
    })
    expect(stats.recentSessions[0].instrumentId).toBe('piano')
  })
})

describe('auto practice tracker — instrument recording', () => {
  beforeEach(() => {
    installFakeStorage()
    __resetAutoPracticeSession()
  })

  it('tags piece aggregates with the practicing instrument', () => {
    beginAutoPracticeSession({ id: 'piece:x', title: 'X' }, { instrumentId: 'guitar' })
    tickAutoPracticeSession()
    const stats = endAutoPracticeSession()
    expect(stats.pieces['piece:x'].lastInstrumentId).toBe('guitar')
  })

  it('defaults to piano for legacy call signature', () => {
    beginAutoPracticeSession({ id: 'piece:y', title: 'Y' })
    const stats = endAutoPracticeSession()
    expect(stats.pieces['piece:y'].lastInstrumentId).toBe('piano')
  })
})

describe('session persistence meta — instrument recording', () => {
  it('includes the instrument in saved session meta', () => {
    const meta = buildSessionMeta({
      pdfMeta: { fileName: 'score.pdf', size: 10 },
      midiSource: null,
      musicXmlSource: null,
      activeView: 'practice',
      pageNumber: 1,
      practicePrefs: null,
      instrumentId: 'guitar',
    })
    expect(meta.instrumentId).toBe('guitar')
  })

  it('legacy meta (without instrument) yields null for restore to normalize as piano', () => {
    const meta = buildSessionMeta({
      pdfMeta: { fileName: 'score.pdf', size: 10 },
      midiSource: null,
      musicXmlSource: null,
      activeView: 'practice',
      pageNumber: 1,
      practicePrefs: null,
    })
    expect(meta.instrumentId).toBeNull()
  })

  it('persists inactive instrument bundles for reload separation', () => {
    const meta = buildSessionMeta({
      pdfMeta: { fileName: 'guitar.pdf', size: 8 },
      midiSource: { fileName: 'guitar.mid', data: new ArrayBuffer(4) },
      musicXmlSource: { fileName: 'guitar.musicxml', data: new ArrayBuffer(6) },
      activeView: 'practice',
      pageNumber: 2,
      practicePrefs: { practiceTime: 12 },
      instrumentId: 'guitar',
      instrumentBundles: {
        piano: {
          pdfMeta: { fileName: 'piano.pdf', size: 10 },
          pdfBuffer: new ArrayBuffer(10),
          midiSource: { fileName: 'piano.mid', data: new ArrayBuffer(3) },
          musicXmlSource: { fileName: 'piano.musicxml', data: new ArrayBuffer(5) },
          pageNumber: 4,
          practicePrefs: { practiceTime: 99 },
        },
        guitar: {
          pdfMeta: { fileName: 'guitar.pdf', size: 8 },
          pdfBuffer: new ArrayBuffer(8),
          midiSource: { fileName: 'guitar.mid', data: new ArrayBuffer(4) },
          musicXmlSource: { fileName: 'guitar.musicxml', data: new ArrayBuffer(6) },
          pageNumber: 2,
          practicePrefs: { practiceTime: 12 },
        },
      },
    })

    expect(meta.instrumentBundles.piano.pdfMeta.fileName).toBe('piano.pdf')
    expect(meta.instrumentBundles.piano.midiFileName).toBe('piano.mid')
    expect(meta.instrumentBundles.piano.musicXmlFileName).toBe('piano.musicxml')
    expect(meta.instrumentBundles.piano.pageNumber).toBe(4)
    expect(meta.instrumentBundles.guitar.practicePrefs).toEqual({ practiceTime: 12 })
  })

  it('restores instrument bundle files by instrument key', () => {
    const meta = buildSessionMeta({
      pdfMeta: { fileName: 'guitar.pdf', size: 8 },
      midiSource: null,
      musicXmlSource: null,
      activeView: 'practice',
      pageNumber: 1,
      practicePrefs: null,
      instrumentId: 'guitar',
      instrumentBundles: {
        guitar: {
          pdfMeta: { fileName: 'guitar.pdf', size: 8 },
          pdfBuffer: new ArrayBuffer(8),
          midiSource: { fileName: 'guitar.mid', data: new ArrayBuffer(4) },
          musicXmlSource: { fileName: 'guitar.musicxml', data: new ArrayBuffer(6) },
          pageNumber: 3,
          practicePrefs: { practiceTime: 7 },
        },
      },
    })

    const restored = validateRestoredInstrumentBundles(meta, {
      instrumentFiles: {
        guitar: {
          pdf: new ArrayBuffer(8),
          midi: new ArrayBuffer(4),
          musicXml: new ArrayBuffer(6),
        },
      },
    })

    expect(restored.guitar.pdfMeta.fileName).toBe('guitar.pdf')
    expect(restored.guitar.midiSource.fileName).toBe('guitar.mid')
    expect(restored.guitar.musicXmlSource.fileName).toBe('guitar.musicxml')
    expect(restored.guitar.pageNumber).toBe(3)
    expect(restored.guitar.practicePrefs).toEqual({ practiceTime: 7 })
  })
})
