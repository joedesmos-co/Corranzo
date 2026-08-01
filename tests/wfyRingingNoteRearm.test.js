/**
 * WFY ringing-note rearm: a new attack must register while the previous note
 * still rings (piano sustain / guitar string resonance), without reintroducing
 * one sustained note consuming multiple checkpoints.
 */
import { describe, expect, it } from 'vitest'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  getMicAttackRearmReason,
  markMicAttackConsumed,
  MIC_ATTACK_REARM_RISE_RATIO,
  rearmMicAttackLatch,
  resetMicAttackLatch,
  shouldRearmMicAttack,
  updateMicAttackRelease,
} from '../src/features/practice/micAttackLatch.js'
import {
  renderSyntheticClip,
  synthHarmonicTone,
  synthSpeech,
  midiToFrequency,
} from '../src/features/microphone-input/micSyntheticClips.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import { createMicFrameAnalyzer } from '../src/features/microphone-input/micFrameAnalysis.js'
import { getMicInstrumentProfile } from '../src/features/microphone-input/micInstrumentProfiles.js'
import { isMusicalMicFrame } from '../src/features/practice/micMusicalAcceptance.js'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  frameConfidentForMatch,
  frameCorroboratesSingleNote,
  resetMatchConfirmState,
} from '../src/features/practice/micMatchConfirm.js'
import { evaluateMicScoreInformedInput, MATCH_OUTCOME } from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const SAMPLE_RATE = 44100
const FFT = 2048
const HOP = Math.round(SAMPLE_RATE / 60)
const settings = normalizeMatchSettings({})

function ringingFrame({ rms = 0.2, gateOpen = true, detected = [], midiFloat = null } = {}) {
  return {
    gateOpen,
    filteredRms: rms,
    v2DetectedMidis: detected,
    midiFloat,
    v2Active: true,
  }
}

describe('micAttackLatch attack-aware rearm (unit)', () => {
  it('keeps blocking a sustained same note (no rise, same pitch)', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [64] })
    // Ring decays: envelope follows the falling rms.
    updateMicAttackRelease(latch, true, { rms: 0.3 })
    updateMicAttackRelease(latch, true, { rms: 0.24 })
    updateMicAttackRelease(latch, true, { rms: 0.2 })
    expect(canAcceptMicAttackMatch(latch)).toBe(false)
    // Next checkpoint repeats the SAME note — sustained ring must not rearm.
    expect(
      shouldRearmMicAttack(latch, ringingFrame({ rms: 0.19, detected: [64], midiFloat: 64 }), {
        expectedMidis: [64],
      }),
    ).toBe(false)
  })

  it('rearms a repeated same note on a clear energy rise (fresh attack)', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [64] })
    updateMicAttackRelease(latch, true, { rms: 0.3 })
    updateMicAttackRelease(latch, true, { rms: 0.18 })
    const riseRms = 0.18 * (MIC_ATTACK_REARM_RISE_RATIO + 0.1)
    expect(
      shouldRearmMicAttack(latch, ringingFrame({ rms: riseRms, detected: [64], midiFloat: 64 }), {
        expectedMidis: [64],
      }),
    ).toBe(true)
  })

  it('rearms a repeated bass note from a hammer transient when RMS stays compressed', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [36] })
    for (let index = 0; index < 8; index += 1) {
      updateMicAttackRelease(latch, true, {
        rms: 0.09 - index * 0.002,
        spectralEnergy: 0.001 - index * 0.00002,
      })
    }
    const frame = ringingFrame({ rms: 0.08, detected: [36], midiFloat: 36.02 })
    frame.spectralEnergy = 0.00155
    frame.signalShape = 'sustained'
    frame.v2Notes = [{
      midi: 36,
      detected: true,
      confidence: 0.9,
      ratio: 5.2,
      harmonicSupport: 0.62,
    }]
    expect(getMicAttackRearmReason(latch, frame, { expectedMidis: [36] })).toBe(
      'low-note-transient',
    )
  })

  it('rearms when a different expected note becomes dominant while the old note rings', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [64] })
    updateMicAttackRelease(latch, true, { rms: 0.25 })
    updateMicAttackRelease(latch, true, { rms: 0.22 })
    expect(
      shouldRearmMicAttack(latch, ringingFrame({ rms: 0.22, detected: [57], midiFloat: 57.2 }), {
        expectedMidis: [57],
      }),
    ).toBe(true)
  })

  it('does not rearm from the ringing note leaking into an octave-related probe', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [40] })
    updateMicAttackRelease(latch, true, { rms: 0.25 })
    updateMicAttackRelease(latch, true, { rms: 0.22 })
    // Probe for the octave (52) fires off the old note's 2nd harmonic, but the
    // pitch tracker still sits on the ringing fundamental (40).
    expect(
      shouldRearmMicAttack(latch, ringingFrame({ rms: 0.2, detected: [52], midiFloat: 40.1 }), {
        expectedMidis: [52],
      }),
    ).toBe(false)
  })

  it('rearms a different expected note from strong V2 transition evidence when RMS rise is small', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [64] })
    updateMicAttackRelease(latch, true, { rms: 0.2 })
    updateMicAttackRelease(latch, true, { rms: 0.16 })

    const frame = ringingFrame({
      rms: 0.175,
      detected: [57],
      // The independent tracker is still pinned to the old ringing note.
      midiFloat: 64.05,
    })
    frame.v2Notes = [{ midi: 57, detected: true, confidence: 0.55, ratio: 2.6 }]

    expect(getMicAttackRearmReason(latch, frame, { expectedMidis: [57] })).toBe(
      'score-informed-transition',
    )
  })

  it('does not rearm when the gate is closed (normal release path handles it)', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [64] })
    expect(
      shouldRearmMicAttack(latch, ringingFrame({ gateOpen: false, rms: 0.4, detected: [57], midiFloat: 57 }), {
        expectedMidis: [57],
      }),
    ).toBe(false)
  })

  it('full release still rearms via gate-closed frames (legacy path unchanged)', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [64] })
    for (let index = 0; index < 4; index += 1) {
      updateMicAttackRelease(latch, false)
    }
    expect(canAcceptMicAttackMatch(latch)).toBe(true)
  })

  it('rearmMicAttackLatch clears the latch immediately', () => {
    const latch = createMicAttackLatchState()
    markMicAttackConsumed(latch, { consumedMidis: [64] })
    rearmMicAttackLatch(latch)
    expect(canAcceptMicAttackMatch(latch)).toBe(true)
    resetMicAttackLatch(latch)
    expect(canAcceptMicAttackMatch(latch)).toBe(true)
  })
})

/**
 * Live-loop harness: mirrors the useWaitForYouMicInput advance gate, including
 * the attack latch with rearm, walking a checkpoint sequence.
 */
function runCheckpointSequenceGate(samples, checkpointMidis) {
  const v2State = createMicEngineV2RuntimeState()
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile('guitar')
  const confirm = createMatchConfirmState()
  const latch = createMicAttackLatchState()
  let checkpointIndex = 0
  const advances = []

  for (let end = FFT; end <= samples.length; end += HOP) {
    if (checkpointIndex >= checkpointMidis.length) {
      break
    }
    const expectedMidi = checkpointMidis[checkpointIndex]
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FFT, end)),
      sampleRate: SAMPLE_RATE,
      expectedMidis: [expectedMidi],
      noiseFloor: analyzer.noiseFloor,
      state: v2State,
      centsTolerance: settings.micCentsTolerance,
      gateOptions: profile?.gate ?? null,
      timeMs: (end / SAMPLE_RATE) * 1000,
    })
    const frame = tick.frame
    if (!frame) {
      continue
    }
    updateMicAttackRelease(latch, Boolean(frame.gateOpen), {
      rms: frame.filteredRms ?? frame.rms ?? null,
    })
    if (!canAcceptMicAttackMatch(latch)) {
      if (shouldRearmMicAttack(latch, frame, { expectedMidis: [expectedMidi] })) {
        rearmMicAttackLatch(latch)
      } else {
        resetMatchConfirmState(confirm)
        continue
      }
    }
    if (!frame.gateOpen || !frame.v2DetectedMidis?.length) {
      resetMatchConfirmState(confirm)
      continue
    }
    const preview = evaluateMicScoreInformedInput(
      { id: `cp-${checkpointIndex}`, expectedMidi },
      frame.v2DetectedMidis,
      settings,
    )
    if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
      resetMatchConfirmState(confirm)
      continue
    }
    const confident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
    const corroborated = frameCorroboratesSingleNote(frame, expectedMidi, {
      centsTolerance: settings.micCentsTolerance,
    })
    if (
      confirmConfidentMatch(confirm, `cp-${checkpointIndex}:${expectedMidi}`, confident && corroborated, {
        pitchCents: frame.midiFloat != null ? frame.midiFloat * 100 : null,
      })
    ) {
      resetMatchConfirmState(confirm)
      markMicAttackConsumed(latch, { consumedMidis: [expectedMidi] })
      advances.push({ checkpointIndex, timeMs: (end / SAMPLE_RATE) * 1000 })
      checkpointIndex += 1
    }
  }
  return advances
}

function mixInto(target, source, offsetSamples) {
  for (let index = 0; index < source.length; index += 1) {
    const at = offsetSamples + index
    if (at >= target.length) {
      break
    }
    target[at] += source[index]
  }
}

function guitarTone(midi, seconds, amplitude) {
  return synthHarmonicTone(
    midiToFrequency(midi),
    [
      { multiple: 1, amplitude },
      { multiple: 2, amplitude: amplitude * 0.5 },
      { multiple: 3, amplitude: amplitude * 0.25 },
    ],
    SAMPLE_RATE,
    seconds,
  )
}

describe('WFY ringing note live gate', () => {
  it('advances note B while note A still rings, one advance per note', () => {
    const total = new Float32Array(Math.round(SAMPLE_RATE * 2.2))
    // A (E4) rings for the whole clip; B (A3) attacks at 1.1s much louder.
    mixInto(total, guitarTone(64, 2.2, 0.14), 0)
    mixInto(total, guitarTone(57, 1.1, 0.55), Math.round(SAMPLE_RATE * 1.1))

    const advances = runCheckpointSequenceGate(total, [64, 57])
    expect(advances).toHaveLength(2)
    expect(advances[1].timeMs).toBeGreaterThan(1100)
  })

  it('one sustained note cannot consume multiple checkpoints', () => {
    const sustained = guitarTone(64, 2.0, 0.3)
    const advances = runCheckpointSequenceGate(sustained, [64, 57])
    expect(advances).toHaveLength(1)
  })

  it('a sustained note does not advance a repeated same-note checkpoint', () => {
    const sustained = guitarTone(64, 2.0, 0.3)
    const advances = runCheckpointSequenceGate(sustained, [64, 64])
    expect(advances).toHaveLength(1)
  })

  it('a repeated same-note checkpoint advances on a fresh louder attack', () => {
    const total = new Float32Array(Math.round(SAMPLE_RATE * 2.2))
    mixInto(total, guitarTone(64, 1.05, 0.18), 0)
    mixInto(total, guitarTone(64, 1.1, 0.6), Math.round(SAMPLE_RATE * 1.1))

    const advances = runCheckpointSequenceGate(total, [64, 64])
    expect(advances).toHaveLength(2)
  })

  it('speech over a ringing note does not advance the next checkpoint', () => {
    const total = new Float32Array(Math.round(SAMPLE_RATE * 2.4))
    mixInto(total, guitarTone(64, 2.4, 0.14), 0)
    mixInto(
      total,
      synthSpeech(SAMPLE_RATE, 1.2, { f0: midiToFrequency(57), seed: 17, driftSemitones: 2.4 }),
      Math.round(SAMPLE_RATE * 1.1),
    )

    const advances = runCheckpointSequenceGate(total, [64, 57])
    expect(advances).toHaveLength(1)
  })

  it('noise does not advance', () => {
    const noise = renderSyntheticClip({ type: 'noise', seconds: 1.2, seed: 7 }, SAMPLE_RATE)
    const advances = runCheckpointSequenceGate(noise, [64])
    expect(advances).toHaveLength(0)
  })
})
