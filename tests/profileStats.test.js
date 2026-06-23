import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STATS_STORAGE_KEY,
  clearStats,
  loadStats,
  saveStats,
} from '../src/features/profile/profileStorage.js'
import {
  beginSession,
  endSession,
} from '../src/features/profile/practiceStats.js'
import { createEmptyStats } from '../src/features/profile/profileStatsSchema.js'

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
  }
}

describe('local practice stats storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    })
  })

  it('loads, saves, and clears stats', () => {
    const stats = {
      ...createEmptyStats(),
      totalPracticeSeconds: 90,
      totalSessions: 1,
    }

    expect(saveStats(stats)).toBe(true)
    expect(loadStats()).toMatchObject({
      totalPracticeSeconds: 90,
      totalSessions: 1,
    })

    expect(clearStats()).toBe(true)
    expect(localStorage.removeItem).toHaveBeenCalledWith(STATS_STORAGE_KEY)
    expect(loadStats()).toEqual(createEmptyStats())
  })

  it('falls back safely when stored data is corrupt', () => {
    localStorage.setItem(STATS_STORAGE_KEY, '{not valid json')
    expect(loadStats()).toEqual(createEmptyStats())
  })

  it('migrates older session data without undercounting sessions', () => {
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
      totalPracticeSeconds: 90,
      totalSessions: 2,
    })
  })
})

describe('practice session updates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    })
  })

  it('updates total time, total sessions, and piece stats', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(121_000)

    beginSession({ id: 'bach-prelude', title: 'Bach Prelude' })
    const stats = endSession(120)

    expect(stats.totalPracticeSeconds).toBe(120)
    expect(stats.totalSessions).toBe(1)
    expect(stats.lastPracticedAt).toBe(121_000)
    expect(stats.pieces['bach-prelude']).toMatchObject({
      title: 'Bach Prelude',
      totalPracticeSeconds: 120,
      totalSessions: 1,
      lastPracticedAt: 121_000,
    })
  })

  it('keeps the newest sessions first in the recent sessions list', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(61_000)
      .mockReturnValueOnce(62_000)
      .mockReturnValueOnce(92_000)

    beginSession({ id: 'piece-a', title: 'Piece A' })
    endSession(60)
    beginSession({ id: 'piece-b', title: 'Piece B' })
    const stats = endSession(30)

    expect(stats.recentSessions).toHaveLength(2)
    expect(stats.recentSessions.map((session) => session.pieceId)).toEqual([
      'piece-b',
      'piece-a',
    ])
    expect(stats.recentSessions.map((session) => session.durationSeconds)).toEqual([
      30,
      60,
    ])
  })
})
