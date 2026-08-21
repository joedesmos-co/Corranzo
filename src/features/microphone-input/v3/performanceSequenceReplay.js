import { buildPerformanceExpectation, PERFORMANCE_MODE } from './performanceExpectation.js'
import {
  createGuitarRecognitionState,
  evaluateGuitarRecognition,
} from './guitarRecognition.js'
import {
  createPianoRecognitionState,
  evaluatePianoRecognition,
} from './pianoRecognition.js'
import {
  applyRecognitionTiming,
  createMusicalTimingState,
  markMusicalTimingConsumed,
  updateMusicalTiming,
} from './musicalTiming.js'
import { RECOGNITION_OUTCOME } from './micRecognitionIr.js'

function checkpointModel(scenario, checkpoint, index) {
  return {
    id: `${scenario.id}-checkpoint-${index}`,
    expectedMidis: checkpoint.expectedMidis,
    expectedStringFrets: checkpoint.expectedStringFrets ?? [],
    minimumRequiredTones: checkpoint.minimumRequiredTones ?? null,
    rollingWindowMs: checkpoint.rollingWindowMs ??
      (scenario.instrument === 'guitar' ? 900 : 720),
    isChord: checkpoint.expectedMidis.length > 1,
    timeSeconds: checkpoint.timeMs / 1000,
    measureNumber: 1,
    beat: index + 1,
  }
}

function recognitionFrame(source, expectedMidis, sequence) {
  const detectedMidis = source.detectedMidis ?? []
  return {
    sequence,
    timeMs: source.timeMs,
    gateOpen: Boolean(source.gateOpen),
    musical: Boolean(source.musical),
    freshAttack: Boolean(source.freshAttack),
    ringingMidis: source.ringingMidis ?? [],
    unexpectedMidis: source.unexpectedMidis ?? [],
    v2Notes: expectedMidis.map((midi) => ({
      midi,
      detected: detectedMidis.includes(midi),
      confidence: detectedMidis.includes(midi) ? 0.92 : 0.08,
      ratio: detectedMidis.includes(midi) ? 4.2 : 0.7,
    })),
  }
}

/** Replay a deterministic musical sequence through shared timing state. */
export function replayMicV3PerformanceSequence(scenario) {
  const checkpoints = scenario.checkpoints.map((checkpoint, index) =>
    checkpointModel(scenario, checkpoint, index),
  )
  let timingState = null
  let recognitionState = null
  const checkpointResults = []

  for (const [checkpointIndex, sourceCheckpoint] of scenario.checkpoints.entries()) {
    const checkpoint = checkpoints[checkpointIndex]
    const expectation = buildPerformanceExpectation({
      checkpoint,
      checkpointIndex,
      checkpoints,
      instrument: scenario.instrument,
      mode: PERFORMANCE_MODE.WAIT_FOR_YOU,
    })
    timingState ??= createMusicalTimingState(expectation)
    recognitionState ??= expectation.instrument === 'guitar'
      ? createGuitarRecognitionState(expectation)
      : createPianoRecognitionState(expectation)
    let advancedAtFrame = null
    let finalDecision = null
    const decisions = []

    for (const [frameIndex, sourceFrame] of sourceCheckpoint.frames.entries()) {
      const frame = recognitionFrame(sourceFrame, checkpoint.expectedMidis, frameIndex)
      const timing = updateMusicalTiming({
        expectation,
        frame,
        state: timingState,
        timeMs: frame.timeMs,
        musical: frame.musical,
        explicitAttack: frame.freshAttack
          ? { fresh: true, confidence: 0.95, kind: 'fixture-attack' }
          : null,
      })
      timingState = timing.state
      const args = {
        expectation,
        frame,
        state: recognitionState,
        timeMs: frame.timeMs,
        musical: frame.musical,
        attack: timing.attack
          ? {
              id: timing.attack.id,
              fresh: timing.fresh,
              confidence: timing.attack.confidence.overall,
            }
          : { fresh: false },
      }
      const recognition = expectation.instrument === 'guitar'
        ? evaluateGuitarRecognition(args)
        : evaluatePianoRecognition(args)
      recognitionState = recognition.state
      finalDecision = applyRecognitionTiming(recognition.decision, timing)
      decisions.push(finalDecision)
      if (
        finalDecision.advance &&
        finalDecision.outcome === RECOGNITION_OUTCOME.ACCEPTED
      ) {
        advancedAtFrame = frameIndex
        timingState = markMusicalTimingConsumed(timingState, {
          matchedMidis: finalDecision.matchedMidis,
        })
        break
      }
    }

    const advanced = advancedAtFrame != null
    const expectedAdvance = Boolean(sourceCheckpoint.expectedAdvance)
    const earlyAdvance = advanced && sourceCheckpoint.mustNotAdvanceBeforeFrame != null &&
      advancedAtFrame < sourceCheckpoint.mustNotAdvanceBeforeFrame
    checkpointResults.push({
      checkpointId: checkpoint.id,
      expectedAdvance,
      advanced,
      advancedAtFrame,
      earlyAdvance,
      passed: advanced === expectedAdvance && !earlyAdvance,
      finalDecision,
      decisions,
    })
  }

  return {
    scenarioId: scenario.id,
    provenance: scenario.provenance,
    passed: checkpointResults.every((result) => result.passed),
    checkpointResults,
  }
}

export function summarizeMicV3PerformanceSequences(results) {
  const checkpoints = results.flatMap((result) => result.checkpointResults)
  const ringing = results.filter((result) => result.scenarioId.includes('ringing'))
  return {
    scenarioCount: results.length,
    passedScenarios: results.filter((result) => result.passed).length,
    checkpointCount: checkpoints.length,
    passedCheckpoints: checkpoints.filter((result) => result.passed).length,
    falseAdvanceCount: checkpoints.filter((result) => result.earlyAdvance).length +
      checkpoints.filter((result) => result.advanced && !result.expectedAdvance).length,
    ringingTransitionSuccess: {
      count: ringing.length,
      successes: ringing.filter((result) => result.passed).length,
      successRate: ringing.length
        ? ringing.filter((result) => result.passed).length / ringing.length
        : null,
    },
    results,
  }
}
