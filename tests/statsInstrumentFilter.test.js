/**
 * Stats instrument scoping: exactly three views — both instruments combined,
 * just piano, just guitar — projected from one canonical stats object.
 */
import { describe, expect, it } from 'vitest'
import {
  STATS_SCOPE_ALL,
  filterStatsByInstrument,
  listStatsScopes,
  normalizeStatsScope,
} from '../src/features/profile/statsInstrumentFilter.js'
import { normalizeStats } from '../src/features/profile/profileStatsSchema.js'

function buildMixedStats() {
  return normalizeStats({
    autoPracticeSeconds: 900,
    autoPracticeSecondsByInstrument: { piano: 600, guitar: 300 },
    lastAutoPracticedAtByInstrument: {
      piano: 1700000100000,
      guitar: 1700000200000,
    },
    pieces: {
      'piece:sonata': {
        id: 'piece:sonata',
        title: 'Sonata',
        autoPracticeSeconds: 600,
        lastInstrumentId: 'piano',
        lastPracticedAt: 1700000100000,
      },
      'piece:lagrima': {
        id: 'piece:lagrima',
        title: 'Lágrima',
        autoPracticeSeconds: 300,
        lastInstrumentId: 'guitar',
        lastPracticedAt: 1700000200000,
      },
    },
    recentSessions: [
      {
        id: 's-guitar',
        source: 'manual',
        pieceId: 'piece:lagrima',
        pieceTitle: 'Lágrima',
        instrumentId: 'guitar',
        endedAt: 1700000200000,
        durationSeconds: 300,
      },
      {
        id: 's-piano',
        source: 'manual',
        pieceId: 'piece:sonata',
        pieceTitle: 'Sonata',
        instrumentId: 'piano',
        endedAt: 1700000100000,
        durationSeconds: 500,
      },
      {
        id: 's-legacy',
        source: 'manual',
        pieceId: 'piece:sonata',
        pieceTitle: 'Sonata',
        // No instrumentId — pre-instrument record, must count as piano.
        endedAt: 1700000000000,
        durationSeconds: 200,
      },
    ],
  })
}

describe('stats scopes', () => {
  it('offers exactly three options: combined, piano, guitar', () => {
    expect(listStatsScopes()).toEqual([
      { id: 'all', label: 'All instruments' },
      { id: 'piano', label: 'Piano' },
      { id: 'guitar', label: 'Guitar' },
    ])
  })

  it('normalizes unknown scopes to the combined view', () => {
    expect(normalizeStatsScope('all')).toBe(STATS_SCOPE_ALL)
    expect(normalizeStatsScope('banjo')).toBe(STATS_SCOPE_ALL)
    expect(normalizeStatsScope(undefined)).toBe(STATS_SCOPE_ALL)
    expect(normalizeStatsScope('guitar')).toBe('guitar')
  })
})

describe('filterStatsByInstrument', () => {
  it('combined view returns the stats object untouched', () => {
    const stats = buildMixedStats()
    expect(filterStatsByInstrument(stats, STATS_SCOPE_ALL)).toBe(stats)
    expect(filterStatsByInstrument(stats, 'nonsense')).toBe(stats)
    expect(stats.totalPracticeSeconds).toBe(1000) // 300 + 500 + 200
  })

  it('piano view includes piano sessions AND legacy pre-instrument sessions', () => {
    const piano = filterStatsByInstrument(buildMixedStats(), 'piano')
    expect(piano.recentSessions.map((session) => session.id)).toEqual([
      's-piano',
      's-legacy',
    ])
    expect(piano.totalPracticeSeconds).toBe(700)
    expect(piano.manualSessionsCompleted).toBe(2)
    expect(piano.autoPracticeSeconds).toBe(600)
    expect(piano.lastAutoPracticedAt).toBe(1700000100000)
    expect(Object.keys(piano.pieces)).toEqual(['piece:sonata'])
    expect(piano.lastPracticedAt).toBe(1700000100000)
    expect(piano.statsScopeLabel).toBe('Piano')
  })

  it('guitar view includes only guitar activity', () => {
    const guitar = filterStatsByInstrument(buildMixedStats(), 'guitar')
    expect(guitar.recentSessions.map((session) => session.id)).toEqual(['s-guitar'])
    expect(guitar.totalPracticeSeconds).toBe(300)
    expect(guitar.manualSessionsCompleted).toBe(1)
    expect(guitar.autoPracticeSeconds).toBe(300)
    expect(guitar.lastAutoPracticedAt).toBe(1700000200000)
    expect(Object.keys(guitar.pieces)).toEqual(['piece:lagrima'])
    expect(guitar.statsScopeLabel).toBe('Guitar')
  })

  it('projects mixed-instrument piece activity to the selected instrument', () => {
    const stats = normalizeStats({
      autoPracticeSeconds: 900,
      autoPracticeSecondsByInstrument: { piano: 600, guitar: 300 },
      lastAutoPracticedAtByInstrument: {
        piano: 1700000100000,
        guitar: 1700000200000,
      },
      pieces: {
        'piece:shared': {
          id: 'piece:shared',
          title: 'Shared Piece',
          autoPracticeSeconds: 900,
          autoPracticeSecondsByInstrument: { piano: 600, guitar: 300 },
          lastPracticedAt: 1700000200000,
          lastPracticedAtByInstrument: {
            piano: 1700000100000,
            guitar: 1700000200000,
          },
          lastInstrumentId: 'guitar',
        },
      },
    })

    const piano = filterStatsByInstrument(stats, 'piano')
    const guitar = filterStatsByInstrument(stats, 'guitar')

    expect(piano.pieces['piece:shared'].autoPracticeSeconds).toBe(600)
    expect(piano.pieces['piece:shared'].lastPracticedAt).toBe(1700000100000)
    expect(guitar.pieces['piece:shared'].autoPracticeSeconds).toBe(300)
    expect(guitar.pieces['piece:shared'].lastPracticedAt).toBe(1700000200000)
  })

  it('scoped views never mutate the canonical stats', () => {
    const stats = buildMixedStats()
    const before = JSON.stringify(stats)
    filterStatsByInstrument(stats, 'piano')
    filterStatsByInstrument(stats, 'guitar')
    expect(JSON.stringify(stats)).toBe(before)
  })

  it('legacy stats (piano era, no instrument maps) put all auto time under piano', () => {
    const legacy = normalizeStats({
      autoPracticeSeconds: 450,
      lastAutoPracticedAt: 1690000000000,
      recentSessions: [],
    })
    const piano = filterStatsByInstrument(legacy, 'piano')
    const guitar = filterStatsByInstrument(legacy, 'guitar')
    expect(piano.autoPracticeSeconds).toBe(450)
    expect(piano.lastAutoPracticedAt).toBe(1690000000000)
    expect(guitar.autoPracticeSeconds).toBe(0)
    expect(guitar.lastAutoPracticedAt).toBeNull()
  })
})
