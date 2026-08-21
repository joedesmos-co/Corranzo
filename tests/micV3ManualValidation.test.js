import { describe, expect, it } from 'vitest'
import {
  MIC_V3_MANUAL_CONDITIONS,
  createMicV3ManualSessionTemplate,
  evaluateMicV3ManualSession,
} from '../src/features/microphone-input/v3/manualValidation.js'

function completedSession(overrides = {}) {
  const trials = MIC_V3_MANUAL_CONDITIONS.flatMap((condition) =>
    Array.from({ length: 3 }, (_, index) => ({
      condition: condition.id,
      liveCapture: true,
      naturalPerformance: condition.expectedOutcome === 'accept',
      attemptNumber: 1,
      observedAdvance: condition.expectedOutcome === 'accept',
      confirmationLatencyMs: condition.expectedOutcome === 'accept' ? 82 + index : null,
      missedMidis: [],
      notes: 'physical session observation',
    })),
  )
  return {
    schemaVersion: 3,
    status: 'complete',
    sessionId: 'manual-session-1',
    performedAt: '2026-07-16T20:00:00.000Z',
    performer: 'developer',
    appCommit: 'abc1234',
    browser: 'Chromium',
    operatingSystem: 'macOS',
    microphone: 'USB condenser',
    room: 'practice room',
    requiredTrialsPerCondition: 3,
    trials,
    ...overrides,
  }
}

describe('Mic V3 manual validation gate', () => {
  it('ships an explicitly pending template with no fabricated trials', () => {
    const template = createMicV3ManualSessionTemplate()
    expect(template.status).toBe('pending-physical-session')
    expect(template.trials).toEqual([])
    expect(template.requiredTrialsPerCondition).toBe(3)
  })

  it('summarizes a complete physical matrix and opens the release gate', () => {
    const result = evaluateMicV3ManualSession(completedSession())
    expect(result.valid).toBe(true)
    expect(result.coverageComplete).toBe(true)
    expect(result.releaseReady).toBe(true)
    expect(result.firstAttemptSuccessRate).toBe(1)
    expect(result.falseAdvanceCount).toBe(0)
    expect(result.falseRejectCount).toBe(0)
    expect(result.averageConfirmationLatencyMs).toBe(83)
  })

  it('rejects proxy evidence presented as a physical performance', () => {
    const session = completedSession()
    session.trials[0].naturalPerformance = false
    session.trials[0].liveCapture = false
    const result = evaluateMicV3ManualSession(session)
    expect(result.valid).toBe(false)
    expect(result.releaseReady).toBe(false)
    expect(result.errors.join(' ')).toMatch(/liveCapture=true/)
    expect(result.errors.join(' ')).toMatch(/natural physical-instrument/)
  })

  it('keeps false advances, misses, and difficult chord shapes visible', () => {
    const session = completedSession()
    const wrongChord = session.trials.find((trial) => trial.condition === 'wrong-chord-rejection')
    wrongChord.observedAdvance = true
    const pianoChord = session.trials.find((trial) => trial.condition === 'piano-four-note-chord')
    pianoChord.observedAdvance = false
    pianoChord.missedMidis = [64]
    pianoChord.difficultChordShape = 'close-position Cmaj7'

    const result = evaluateMicV3ManualSession(session)
    expect(result.releaseReady).toBe(false)
    expect(result.falseAdvanceCount).toBe(1)
    expect(result.falseRejectCount).toBe(1)
    expect(result.missedNoteCount).toBe(1)
    expect(result.difficultChordShapes).toEqual(['close-position Cmaj7'])
  })
})
