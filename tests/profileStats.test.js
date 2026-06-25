import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STATS_STORAGE_KEY,
  clearStats,
  loadStats,
  saveStats,
} from '../src/features/profile/profileStorage.js'
import {
  AUTOMATIC_PRACTICE_TRACKING_ENABLED,
  beginSession,
  endSession,
} from '../src/features/profile/practiceStats.js'
import { saveManualSession } from '../src/features/profile/manualPracticeLog.js'
import { createEmptyStats } from '../src/features/profile/profileStatsSchema.js'

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
  }
}

describe('automatic practice tracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    })
    saveStats(createEmptyStats())
  })

  it('is disabled in the app', () => {
    expect(AUTOMATIC_PRACTICE_TRACKING_ENABLED).toBe(false)
  })

  it('does not create a profile session when automatic endSession is called', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(121_000)

    beginSession({ id: 'bach-prelude', title: 'Bach Prelude' })
    const stats = endSession(120)

    expect(stats).toEqual(createEmptyStats())
    expect(loadStats()).toEqual(createEmptyStats())
  })

  it('does not count playback or practice-view time after restore-style auto calls', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(61_000)
      .mockReturnValueOnce(62_000)
      .mockReturnValueOnce(92_000)

    beginSession({ id: 'piece-a', title: 'Piece A' })
    endSession(60)
    beginSession({ id: 'piece-b', title: 'Piece B' })
    endSession(30)

    expect(loadStats()).toEqual(createEmptyStats())
  })

  it('only updates totals after a manual timer save', () => {
    beginSession({ id: 'piece-a', title: 'Piece A' })
    endSession(300)

    const stats = saveManualSession({
      pieceTitle: 'Scales',
      exerciseType: 'scales',
      durationSeconds: 45,
      startedAt: 1_000,
      endedAt: 46_000,
    })

    expect(stats.totalPracticeSeconds).toBe(45)
    expect(stats.totalSessions).toBe(1)
    expect(stats.manualSessionsCompleted).toBe(1)
    expect(stats.legacyAutoPracticeSeconds).toBe(0)
    expect(loadStats()).toMatchObject({
      totalPracticeSeconds: 45,
      totalSessions: 1,
    })
  })
})

describe('local practice stats storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    })
  })

  it('loads, saves, and clears manual stats', () => {
    const stats = {
      ...createEmptyStats(),
      totalPracticeSeconds: 90,
      totalSessions: 1,
      manualSessionsCompleted: 1,
      recentSessions: [
        {
          id: 'manual-1',
          source: 'manual',
          pieceId: 'manual:scales',
          pieceTitle: 'Scales',
          exerciseType: 'scales',
          notes: '',
          startedAt: 1_000,
          endedAt: 91_000,
          durationSeconds: 90,
        },
      ],
    }

    expect(saveStats(stats)).toBe(true)
    expect(loadStats()).toMatchObject({
      totalPracticeSeconds: 90,
      totalSessions: 1,
      manualSessionsCompleted: 1,
    })

    expect(clearStats()).toBe(true)
    expect(localStorage.removeItem).toHaveBeenCalledWith(STATS_STORAGE_KEY)
    expect(loadStats()).toEqual(createEmptyStats())
  })

  it('falls back safely when stored data is corrupt', () => {
    localStorage.setItem(STATS_STORAGE_KEY, '{not valid json')
    expect(loadStats()).toEqual(createEmptyStats())
  })

  it('keeps legacy automatic sessions separate from manual totals', () => {
    localStorage.setItem(
      STATS_STORAGE_KEY,
      JSON.stringify({
        totals: {
          practiceSecondsActive: 90,
          sessionsCompleted: 1,
        },
        sessions: [
          {
            id: 'old-2',
            pieceId: 'piece',
            pieceTitle: 'Piece',
            endedAt: 2_000,
            practiceSecondsActive: 30,
          },
          {
            id: 'old-1',
            pieceId: 'piece',
            pieceTitle: 'Piece',
            endedAt: 1_000,
            practiceSecondsActive: 60,
          },
        ],
      }),
    )

    expect(loadStats()).toMatchObject({
      totalPracticeSeconds: 0,
      totalSessions: 0,
      manualSessionsCompleted: 0,
      legacyAutoPracticeSeconds: 90,
      legacyAutoSessionsCompleted: 2,
      recentSessions: [
        expect.objectContaining({ source: 'auto', durationSeconds: 30 }),
        expect.objectContaining({ source: 'auto', durationSeconds: 60 }),
      ],
    })
  })

  it('does not crash profile when only legacy automatic sessions exist', () => {
    localStorage.setItem(
      STATS_STORAGE_KEY,
      JSON.stringify({
        totalPracticeSeconds: 120,
        totalSessions: 1,
        recentSessions: [
          {
            id: 'legacy-1',
            pieceId: 'piece-a',
            pieceTitle: 'Piece A',
            endedAt: 1_000,
            durationSeconds: 120,
          },
        ],
      }),
    )

    expect(loadStats()).toMatchObject({
      totalPracticeSeconds: 0,
      legacyAutoPracticeSeconds: 120,
      legacyAutoSessionsCompleted: 1,
      recentSessions: [
        expect.objectContaining({
          source: 'auto',
          pieceTitle: 'Piece A',
        }),
      ],
    })
  })
})
