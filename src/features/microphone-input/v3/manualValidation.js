export const MIC_V3_MANUAL_CONDITIONS = Object.freeze([
  { id: 'piano-single-note', instrument: 'piano', expectedOutcome: 'accept' },
  { id: 'piano-dyad', instrument: 'piano', expectedOutcome: 'accept' },
  { id: 'piano-triad', instrument: 'piano', expectedOutcome: 'accept' },
  { id: 'piano-four-note-chord', instrument: 'piano', expectedOutcome: 'accept' },
  { id: 'piano-quiet-note', instrument: 'piano', expectedOutcome: 'accept' },
  { id: 'piano-repeated-note', instrument: 'piano', expectedOutcome: 'accept' },
  { id: 'piano-sustain-pedal', instrument: 'piano', expectedOutcome: 'accept' },
  { id: 'piano-rolled-chord', instrument: 'piano', expectedOutcome: 'accept' },
  { id: 'guitar-acoustic', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'guitar-clean-electric', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'guitar-distorted-electric', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'guitar-double-stop', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'guitar-full-chord', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'guitar-quiet-playing', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'guitar-ringing-transition', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'guitar-staggered-strum', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'guitar-muted-strings', instrument: 'guitar', expectedOutcome: 'accept' },
  { id: 'speech-rejection', instrument: 'safety', expectedOutcome: 'reject' },
  { id: 'room-noise-rejection', instrument: 'safety', expectedOutcome: 'reject' },
  { id: 'wrong-chord-rejection', instrument: 'safety', expectedOutcome: 'reject' },
])

const CONDITION_BY_ID = new Map(
  MIC_V3_MANUAL_CONDITIONS.map((condition) => [condition.id, condition]),
)

function mean(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}

function rate(entries, predicate) {
  return entries.length ? entries.filter(predicate).length / entries.length : null
}

function trialResult(trial, condition) {
  const observedAdvance = Boolean(trial.observedAdvance)
  const expectedAccept = condition.expectedOutcome === 'accept'
  return {
    success: expectedAccept ? observedAdvance : !observedAdvance,
    falseAdvance: !expectedAccept && observedAdvance,
    falseReject: expectedAccept && !observedAdvance,
    firstAttemptSuccess: expectedAccept && observedAdvance && trial.attemptNumber === 1,
  }
}

export function createMicV3ManualSessionTemplate() {
  return {
    schemaVersion: 3,
    status: 'pending-physical-session',
    sessionId: null,
    performedAt: null,
    performer: null,
    appCommit: null,
    browser: null,
    operatingSystem: null,
    microphone: null,
    room: null,
    requiredTrialsPerCondition: 3,
    notes: 'Complete on a developer machine with physical piano and guitar setups.',
    trials: [],
  }
}

/** Validate provenance and summarize a physical-instrument session. */
export function evaluateMicV3ManualSession(session = {}) {
  const errors = []
  const trials = Array.isArray(session.trials) ? session.trials : []
  const requiredTrials = Math.max(1, Math.round(Number(session.requiredTrialsPerCondition) || 3))
  if (session.schemaVersion !== 3) errors.push('schemaVersion must be 3')
  if (session.status !== 'complete') errors.push('status must be complete')
  if (!session.sessionId) errors.push('sessionId is required')
  if (!session.performedAt) errors.push('performedAt is required')
  if (!session.performer) errors.push('performer is required')
  if (!session.appCommit) errors.push('appCommit is required')
  if (!session.microphone) errors.push('microphone is required')

  const evaluated = []
  for (const [index, trial] of trials.entries()) {
    const condition = CONDITION_BY_ID.get(trial.condition)
    if (!condition) {
      errors.push(`trials[${index}].condition is unsupported`)
      continue
    }
    if (trial.liveCapture !== true) {
      errors.push(`trials[${index}] must set liveCapture=true`)
    }
    if (condition.expectedOutcome === 'accept' && trial.naturalPerformance !== true) {
      errors.push(`trials[${index}] must be a natural physical-instrument performance`)
    }
    if (!Number.isInteger(trial.attemptNumber) || trial.attemptNumber < 1) {
      errors.push(`trials[${index}].attemptNumber must be a positive integer`)
    }
    if (typeof trial.observedAdvance !== 'boolean') {
      errors.push(`trials[${index}].observedAdvance must be boolean`)
    }
    if (
      condition.expectedOutcome === 'accept' &&
      trial.observedAdvance &&
      (!Number.isFinite(trial.confirmationLatencyMs) || trial.confirmationLatencyMs < 0)
    ) {
      errors.push(`trials[${index}].confirmationLatencyMs is required for an accepted performance`)
    }
    evaluated.push({
      ...trial,
      instrument: condition.instrument,
      expectedOutcome: condition.expectedOutcome,
      ...trialResult(trial, condition),
    })
  }

  const coverage = MIC_V3_MANUAL_CONDITIONS.map((condition) => {
    const conditionTrials = evaluated.filter((trial) => trial.condition === condition.id)
    return {
      ...condition,
      count: conditionTrials.length,
      required: requiredTrials,
      complete: conditionTrials.length >= requiredTrials,
      successRate: rate(conditionTrials, (trial) => trial.success),
    }
  })
  const positive = evaluated.filter((trial) => trial.expectedOutcome === 'accept')
  const safety = evaluated.filter((trial) => trial.expectedOutcome === 'reject')
  const falseAdvances = evaluated.filter((trial) => trial.falseAdvance)
  const falseRejects = evaluated.filter((trial) => trial.falseReject)
  const difficultChordShapes = [...new Set(
    evaluated.map((trial) => trial.difficultChordShape).filter(Boolean),
  )]
  const coverageComplete = coverage.every((entry) => entry.complete)
  const firstAttemptSuccessRate = rate(positive, (trial) => trial.firstAttemptSuccess)
  const releaseReady = Boolean(
    errors.length === 0 &&
    coverageComplete &&
    firstAttemptSuccessRate === 1 &&
    falseAdvances.length === 0 &&
    falseRejects.length === 0,
  )

  return {
    schemaVersion: 3,
    sessionId: session.sessionId ?? null,
    valid: errors.length === 0,
    releaseReady,
    errors,
    requiredTrialsPerCondition: requiredTrials,
    coverageComplete,
    missingCoverage: coverage.filter((entry) => !entry.complete),
    trialCount: evaluated.length,
    positiveTrialCount: positive.length,
    safetyTrialCount: safety.length,
    firstAttemptSuccessRate,
    averageConfirmationLatencyMs: mean(
      positive.filter((trial) => trial.success).map((trial) => trial.confirmationLatencyMs),
    ),
    missedNoteCount: positive.reduce(
      (sum, trial) => sum + (trial.missedMidis?.length ?? 0),
      0,
    ),
    falseAdvanceCount: falseAdvances.length,
    falseRejectCount: falseRejects.length,
    difficultChordShapes,
    byInstrument: Object.fromEntries(
      ['piano', 'guitar', 'safety'].map((instrument) => {
        const instrumentTrials = evaluated.filter((trial) => trial.instrument === instrument)
        return [instrument, {
          count: instrumentTrials.length,
          successRate: rate(instrumentTrials, (trial) => trial.success),
        }]
      }),
    ),
    coverage,
    trials: evaluated,
  }
}
