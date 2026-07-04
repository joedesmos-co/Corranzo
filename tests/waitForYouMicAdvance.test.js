/**
 * A correct microphone note must advance Wait For You on its own — the exact
 * regression from the field ("mic panel says Correct — C4 but WFY never
 * advances"). These tests drive the same per-frame decision the mic hook makes:
 * real match evaluation (`evaluateMicNoteInput`) gated by the confidence
 * confirmer, with the post-advance "correct" latch that blocks double-advance.
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateMicNoteInput,
  evaluateMicScoreInformedInput,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  frameConfidentForMatch,
  resetMatchConfirmState,
  MIC_MATCH_CONFIRM_FRAMES,
} from '../src/features/practice/micMatchConfirm.js'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  markMicAttackConsumed,
  updateMicAttackRelease,
} from '../src/features/practice/micAttackLatch.js'
import { isMusicalMicFrame } from '../src/features/practice/micMusicalAcceptance.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const settings = normalizeMatchSettings({})

/** Mirrors useWaitForYouMicInput.handleFrame for a single-note checkpoint. */
function runMicFrames(checkpoint, frames) {
  const confirmState = createMatchConfirmState()
  const attackLatch = createMicAttackLatchState()
  let advances = 0
  let correctLatched = false // = feedbackOutcomeRef === CORRECT (early-return)

  for (const frame of frames) {
    if (correctLatched) {
      continue
    }
    updateMicAttackRelease(attackLatch, Boolean(frame.gateOpen))
    if (frame.midi == null || !frame.gateOpen) {
      resetMatchConfirmState(confirmState)
      continue
    }
    if (!canAcceptMicAttackMatch(attackLatch)) {
      resetMatchConfirmState(confirmState)
      continue
    }
    const frameConfident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
    const detectedMidis = frame.v2DetectedMidis ?? []
    const preview = detectedMidis.length
      ? evaluateMicScoreInformedInput(checkpoint, detectedMidis, settings)
      : evaluateMicNoteInput(checkpoint, frame.midi, settings)
    if (preview.outcome === MATCH_OUTCOME.WRONG) {
      resetMatchConfirmState(confirmState)
      continue
    }
    if (preview.outcome === MATCH_OUTCOME.COMPLETE && detectedMidis.length) {
      if (confirmConfidentMatch(confirmState, `${checkpoint.id}:v2:${detectedMidis.join(',')}`, frameConfident)) {
        resetMatchConfirmState(confirmState)
        markMicAttackConsumed(attackLatch)
        advances += 1
        correctLatched = true
      }
    } else {
      resetMatchConfirmState(confirmState)
    }
  }
  return advances
}

function runMicFramesAcrossCheckpoints(checkpoints, frames) {
  const confirmState = createMatchConfirmState()
  const attackLatch = createMicAttackLatchState()
  let advances = 0
  let checkpointIndex = 0

  for (const frame of frames) {
    const checkpoint = checkpoints[checkpointIndex]
    if (!checkpoint) {
      break
    }
    updateMicAttackRelease(attackLatch, Boolean(frame.gateOpen))
    if (frame.midi == null || !frame.gateOpen || !canAcceptMicAttackMatch(attackLatch)) {
      resetMatchConfirmState(confirmState)
      continue
    }
    const frameConfident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
    const preview = evaluateMicScoreInformedInput(checkpoint, frame.v2DetectedMidis ?? [frame.midi], settings)
    if (preview.outcome !== MATCH_OUTCOME.COMPLETE || !frameConfident) {
      resetMatchConfirmState(confirmState)
      continue
    }
    const key = `${checkpoint.id}:v2:${(frame.v2DetectedMidis ?? [frame.midi]).join(',')}`
    if (confirmConfidentMatch(confirmState, key, frameConfident)) {
      resetMatchConfirmState(confirmState)
      markMicAttackConsumed(attackLatch)
      advances += 1
      checkpointIndex += 1
    }
  }
  return advances
}

const C4 = { id: 'cp-c4', expectedMidi: 60 }
const goodFrame = (midi) => ({
  midi,
  v2DetectedMidis: [midi],
  v2Active: true,
  v2Notes: [{ midi, detected: true, harmonicMagnitudes: [0.08, 0.0001, 0.00005] }],
  gateOpen: true,
  clarity: 0.9,
  signalShape: 'sustained',
  zeroCrossingRate: 0.02,
  spectralEnergy: 0.01,
  crestFactor: 1.8,
})

describe('microphone correct note advances Wait For You', () => {
  it('advances once the correct note is heard confidently for enough frames', () => {
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES }, () => goodFrame(60))
    expect(runMicFrames(C4, frames)).toBe(1)
  })

  it('does not advance before the confidence window is met', () => {
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES - 1 }, () => goodFrame(60))
    expect(runMicFrames(C4, frames)).toBe(0)
  })

  it('does not require pressing Continue — no manual input in this path', () => {
    // Held well past the threshold, still exactly one advance (no Continue).
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES * 4 }, () => goodFrame(60))
    expect(runMicFrames(C4, frames)).toBe(1)
  })

  it('never advances on a wrong note', () => {
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES * 3 }, () => goodFrame(62))
    expect(runMicFrames(C4, frames)).toBe(0)
  })

  it('does not advance on a correct pitch that is too unclear (below confidence)', () => {
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES * 3 }, () => ({
      midi: 60,
      gateOpen: true,
      clarity: 0.2,
    }))
    expect(runMicFrames(C4, frames)).toBe(0)
  })

  it('does not double-advance from a continuously held correct note', () => {
    const frames = Array.from({ length: 40 }, () => goodFrame(60))
    expect(runMicFrames(C4, frames)).toBe(1)
  })

  it('does not advance multiple checkpoints from one held note without release', () => {
    const checkpoints = Array.from({ length: 10 }, (_, index) => ({
      id: `cp-${index}`,
      expectedMidi: 60,
    }))
    const frames = Array.from({ length: 40 }, () => goodFrame(60))
    expect(runMicFramesAcrossCheckpoints(checkpoints, frames)).toBe(1)
  })

  it('allows the next checkpoint after a release gap', () => {
    const checkpoints = [
      { id: 'cp-1', expectedMidi: 60 },
      { id: 'cp-2', expectedMidi: 60 },
    ]
    const frames = [
      ...Array.from({ length: MIC_MATCH_CONFIRM_FRAMES }, () => goodFrame(60)),
      ...Array.from({ length: 4 }, () => ({ gateOpen: false })),
      ...Array.from({ length: MIC_MATCH_CONFIRM_FRAMES }, () => goodFrame(60)),
    ]
    expect(runMicFramesAcrossCheckpoints(checkpoints, frames)).toBe(2)
  })

  it('does not advance from monophonic-only diagnostic pitch without V2 detection', () => {
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES * 3 }, () => ({
      midi: 60,
      v2DetectedMidis: [],
      gateOpen: true,
      clarity: 0.9,
      signalShape: 'sustained',
      zeroCrossingRate: 0.02,
      spectralEnergy: 0.01,
      crestFactor: 1.8,
    }))
    expect(runMicFrames(C4, frames)).toBe(0)
  })

  it('resets confidence if a wrong note interrupts before the window completes', () => {
    // two good, one wrong, then two good → never three in a row → no advance.
    const frames = [goodFrame(60), goodFrame(60), goodFrame(62), goodFrame(60), goodFrame(60)]
    expect(runMicFrames(C4, frames)).toBe(0)
  })

  it('advances after re-establishing a clean run following an interruption', () => {
    const frames = [
      goodFrame(60),
      goodFrame(62), // wrong — reset
      ...Array.from({ length: MIC_MATCH_CONFIRM_FRAMES }, () => goodFrame(60)),
    ]
    expect(runMicFrames(C4, frames)).toBe(1)
  })
})
