import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetAutoPracticeSession,
  beginAutoPracticeSession,
  endAutoPracticeSession,
  recordAutoPracticeMeasure,
  recordAutoPracticeLoop,
  recordAutoPracticeTempo,
  recordWfyPracticeEvent,
  resolvePracticePieceId,
  snapshotActiveSession,
  tickAutoPracticeSession,
} from '../src/features/profile/autoPracticeTracker.js'
import { clearStats, loadStats } from '../src/features/profile/profileStorage.js'

afterEach(() => {
  __resetAutoPracticeSession()
  clearStats()
})

describe('autoPracticeTracker', () => {
  it('resolves a stable piece id from fingerprint', () => {
    expect(
      resolvePracticePieceId({
        pdfFingerprint: 'score.pdf::123::456',
      }),
    ).toBe('piece:score.pdf::123::456')
  })

  it('tracks live session metrics and flushes to storage', () => {
    beginAutoPracticeSession({ id: 'piece:test', title: 'Test Piece' })
    recordAutoPracticeMeasure(3)
    recordAutoPracticeMeasure(4)
    recordAutoPracticeLoop()
    recordAutoPracticeTempo(92)
    recordWfyPracticeEvent('missed')
    recordWfyPracticeEvent('correct')

    tickAutoPracticeSession()

    const live = snapshotActiveSession()
    expect(live.measuresPlayed).toBe(2)
    expect(live.loopsCompleted).toBe(1)
    expect(live.tempoBpm).toBe(92)
    expect(live.wfyMissed).toBe(1)
    expect(live.wfyCorrect).toBe(1)

    const next = endAutoPracticeSession()
    expect(next.pieces['piece:test'].autoPracticeSeconds).toBeGreaterThanOrEqual(0)
    expect(next.pieces['piece:test'].measuresPlayed).toBe(2)
    expect(next.pieces['piece:test'].loopsCompleted).toBe(1)
    expect(next.pieces['piece:test'].lastTempoBpm).toBe(92)
    expect(next.pieces['piece:test'].wfyMissed).toBe(1)
    expect(next.pieces['piece:test'].wfyCorrect).toBe(1)
    expect(loadStats().autoPracticeSeconds).toBe(next.autoPracticeSeconds)
  })
})
