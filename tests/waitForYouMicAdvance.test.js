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
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const settings = normalizeMatchSettings({})

/** Mirrors useWaitForYouMicInput.handleFrame for a single-note checkpoint. */
function runMicFrames(checkpoint, frames) {
  const confirmState = createMatchConfirmState()
  let advances = 0
  let correctLatched = false // = feedbackOutcomeRef === CORRECT (early-return)

  for (const frame of frames) {
    if (correctLatched) {
      continue
    }
    if (frame.midi == null || !frame.gateOpen) {
      resetMatchConfirmState(confirmState)
      continue
    }
    const detectedMidis = frame.v2DetectedMidis ?? []
    const preview = detectedMidis.length
      ? evaluateMicScoreInformedInput(checkpoint, detectedMidis, settings)
      : evaluateMicNoteInput(checkpoint, frame.midi, settings)
    if (preview.outcome === MATCH_OUTCOME.WRONG) {
      resetMatchConfirmState(confirmState)
      continue
    }
    if (preview.outcome === MATCH_OUTCOME.COMPLETE && detectedMidis.length) {
      const confident = frameConfidentForMatch(frame)
      if (confirmConfidentMatch(confirmState, `${checkpoint.id}:v2:${detectedMidis.join(',')}`, confident)) {
        resetMatchConfirmState(confirmState)
        advances += 1
        correctLatched = true
      }
    } else {
      resetMatchConfirmState(confirmState)
    }
  }
  return advances
}

const C4 = { id: 'cp-c4', expectedMidi: 60 }
const goodFrame = (midi) => ({ midi, v2DetectedMidis: [midi], gateOpen: true, clarity: 0.9 })
const monophonicOnlyFrame = (midi) => ({ midi, v2DetectedMidis: [], gateOpen: true, clarity: 0.9 })

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

  it('does not advance from monophonic-only diagnostic pitch without V2 detection', () => {
    const frames = Array.from({ length: MIC_MATCH_CONFIRM_FRAMES * 3 }, () =>
      monophonicOnlyFrame(60),
    )
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
