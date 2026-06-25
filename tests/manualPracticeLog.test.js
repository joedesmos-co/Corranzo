import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STATS_STORAGE_KEY,
  loadStats,
  saveStats,
} from '../src/features/profile/profileStorage.js'
import { saveManualSession } from '../src/features/profile/manualPracticeLog.js'
import {
  createManualTimerState,
  getManualTimerElapsedMs,
  pauseManualTimer,
  resumeManualTimer,
  startManualTimer,
  stopManualTimer,
} from '../src/features/profile/manualPracticeTimer.js'
import { createEmptyStats } from '../src/features/profile/profileStatsSchema.js'

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
  }
}

describe('manual practice timer', () => {
  it('starts, pauses, resumes, and stops with elapsed seconds', () => {
    let state = createManualTimerState()
    state = startManualTimer(state, 1_000)
    expect(state.status).toBe('running')
    expect(getManualTimerElapsedMs(state, 31_000)).toBe(30_000)

    state = pauseManualTimer(state, 31_000)
    expect(state.status).toBe('paused')
    expect(getManualTimerElapsedMs(state, 60_000)).toBe(30_000)

    state = resumeManualTimer(state, 60_000)
    expect(getManualTimerElapsedMs(state, 90_000)).toBe(60_000)

    const stopped = stopManualTimer(state, 91_000)
    expect(stopped.elapsedSeconds).toBe(61)
    expect(stopped.nextState.status).toBe('idle')
  })

  it('ignores invalid pause and resume transitions', () => {
    let state = createManualTimerState()
    expect(pauseManualTimer(state, 1_000)).toEqual(state)
    expect(resumeManualTimer(state, 1_000)).toEqual(state)
    state = startManualTimer(state, 1_000)
    expect(startManualTimer(state, 2_000)).toEqual(state)
  })
})

describe('manual practice log storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    })
    saveStats(createEmptyStats())
  })

  it('saves a manual session to profile stats', () => {
    const stats = saveManualSession({
      pieceTitle: 'C major scale',
      exerciseType: 'scales',
      notes: 'Left hand needs work',
      durationSeconds: 120,
      startedAt: 1_000,
      endedAt: 121_000,
    })

    expect(stats.totalPracticeSeconds).toBe(120)
    expect(stats.totalSessions).toBe(1)
    expect(stats.manualSessionsCompleted).toBe(1)
    expect(stats.recentSessions[0]).toMatchObject({
      source: 'manual',
      pieceTitle: 'C major scale',
      exerciseType: 'scales',
      notes: 'Left hand needs work',
      durationSeconds: 120,
    })
  })

  it('updates manual totals without mixing in legacy automatic sessions', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(61_000)

    localStorage.setItem(
      STATS_STORAGE_KEY,
      JSON.stringify({
        recentSessions: [
          {
            id: 'legacy-1',
            pieceId: 'piece-a',
            pieceTitle: 'Piece A',
            endedAt: 61_000,
            durationSeconds: 60,
            source: 'auto',
          },
        ],
      }),
    )

    const stats = saveManualSession({
      pieceTitle: 'Chord drills',
      exerciseType: 'chords',
      durationSeconds: 45,
      startedAt: 70_000,
      endedAt: 115_000,
    })

    expect(stats.totalPracticeSeconds).toBe(45)
    expect(stats.totalSessions).toBe(1)
    expect(stats.manualSessionsCompleted).toBe(1)
    expect(stats.legacyAutoPracticeSeconds).toBe(60)
    expect(stats.legacyAutoSessionsCompleted).toBe(1)
    expect(stats.recentSessions[0].source).toBe('manual')
    expect(stats.recentSessions[1].source).toBe('auto')
  })

  it('persists manual sessions after reload', () => {
    saveManualSession({
      pieceTitle: 'Sight reading',
      exerciseType: 'sight-reading',
      durationSeconds: 30,
      startedAt: 1_000,
      endedAt: 31_000,
    })

    expect(loadStats()).toMatchObject({
      totalPracticeSeconds: 30,
      totalSessions: 1,
      manualSessionsCompleted: 1,
      recentSessions: [
        expect.objectContaining({
          pieceTitle: 'Sight reading',
          source: 'manual',
        }),
      ],
    })
    expect(localStorage.getItem).toHaveBeenCalledWith(STATS_STORAGE_KEY)
  })

  it('keeps empty stats when duration is too short', () => {
    const stats = saveManualSession({
      pieceTitle: 'Too short',
      exerciseType: 'other',
      durationSeconds: 0,
      startedAt: 1_000,
      endedAt: 1_000,
    })

    expect(stats).toEqual(createEmptyStats())
    expect(loadStats()).toEqual(createEmptyStats())
  })

  it('normalizes unknown exercise types to other', () => {
    const stats = saveManualSession({
      pieceTitle: 'Warm up',
      exerciseType: 'unknown-type',
      durationSeconds: 10,
      startedAt: 1_000,
      endedAt: 11_000,
    })

    expect(stats.recentSessions[0].exerciseType).toBe('other')
  })
})

describe('profile empty state compatibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    })
  })

  it('loads empty stats when nothing has been saved', () => {
    expect(loadStats()).toEqual(createEmptyStats())
  })

  it('keeps legacy auto session data without manual fields', () => {
    localStorage.setItem(
      STATS_STORAGE_KEY,
      JSON.stringify({
        totalPracticeSeconds: 60,
        totalSessions: 1,
        recentSessions: [
          {
            id: 'legacy-1',
            pieceId: 'piece-a',
            pieceTitle: 'Piece A',
            endedAt: 1_000,
            durationSeconds: 60,
          },
        ],
      }),
    )

    expect(loadStats()).toMatchObject({
      totalPracticeSeconds: 0,
      totalSessions: 0,
      manualSessionsCompleted: 0,
      legacyAutoPracticeSeconds: 60,
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
