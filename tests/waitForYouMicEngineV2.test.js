/**
 * Mic Engine V2 Phase 3 — Wait For You runtime integration (flagged).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthSimultaneousChord } from '../src/features/microphone-input/micSyntheticChordClips.js'
import { midiToFrequency, synthSine } from '../src/features/microphone-input/micSyntheticClips.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
  resetMicEngineV2RuntimeState,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import {
  evaluateMicScoreInformedInput,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { MIC_CHORD_MODES } from '../src/features/practice/waitForYouMatchSettings.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')
const SAMPLE_RATE = 44100
const settings = normalizeMatchSettings({ micChordMode: MIC_CHORD_MODES.ANY_TONE })

function synthAttackWindow(midis, seconds = 1.2) {
  const samples = synthSimultaneousChord(midis, SAMPLE_RATE, { seconds, amplitude: 0.35 })
  return samples.subarray(Math.floor(SAMPLE_RATE * 0.35), Math.floor(SAMPLE_RATE * 0.35) + 2048)
}

describe('Wait For You mic engine V2 wiring', () => {
  it('uses V2 as the only live WFY mic detector', () => {
    const mic = readSrc('features', 'practice', 'useWaitForYouMicInput.js')
    expect(mic).toContain('enabled: useV2Detector')
    expect(mic).toMatch(/useV2Detector = detectEnabled && micEngineV2Active/)
    expect(mic).not.toContain('onStableMidi')
    expect(mic).toContain('micAttackLatch')
    expect(mic).toContain('isMusicalMicFrame')
    expect(mic).not.toContain('usePitchDetector({')
    expect(mic).not.toContain('useV1Detector')
    expect(mic).not.toContain('onStableChord:')
    expect(mic).toContain('handleV2RuntimeError')
    expect(mic).not.toContain('v2SessionFallback')
  })

  it('routes chord checkpoints to V2 polyphonic mode when flag is on', () => {
    const mic = readSrc('features', 'practice', 'useWaitForYouMicInput.js')
    expect(mic).toContain('isMicV2Polyphonic')
    expect(mic).toContain('evaluateMicScoreInformedInput')
    expect(mic).toMatch(/isMicChordCollection =[\s\S]*!isMicV2Polyphonic/)
  })

  it('clears V2 runtime state when the detector disables', () => {
    const hook = readSrc('features', 'microphone-input', 'useMicEngineV2Detector.js')
    expect(hook).toMatch(/if \(!enabled\)[\s\S]*resetMicEngineV2RuntimeState/)
    expect(hook).toMatch(/return \(\) => \{[\s\S]*resetMicEngineV2RuntimeState/)
    expect(hook).toContain('onV2RuntimeError')
  })

  it('resets V2 note tracks when the checkpoint analysis key changes', () => {
    const hook = readSrc('features', 'microphone-input', 'useMicEngineV2Detector.js')
    const mic = readSrc('features', 'practice', 'useWaitForYouMicInput.js')
    expect(hook).toContain('analysisKey')
    expect(hook).toMatch(/analysisKey[\s\S]*expectedMidisKey[\s\S]*stableFrameThreshold/)
    expect(mic).toContain("analysisKey: currentCheckpoint?.id ?? ''")
  })

  it('resets WFY mic feedback when leaving active mode', () => {
    const mic = readSrc('features', 'practice', 'useWaitForYouMicInput.js')
    expect(mic).toMatch(/if \(!active\) \{[\s\S]*resetFeedback\(\)/)
    expect(mic).toContain('lastStableChordKeyRef.current = \'\'')
  })

  it('latches complete mic matches synchronously before advancing', () => {
    const mic = readSrc('features', 'practice', 'useWaitForYouMicInput.js')
    const latchIndex = mic.indexOf('feedbackOutcomeRef.current = feedback.outcome')
    const advanceIndex = mic.indexOf('onPlayerInputMatched()')
    expect(latchIndex).toBeGreaterThan(-1)
    expect(advanceIndex).toBeGreaterThan(latchIndex)
    expect(mic).toMatch(/feedbackOutcomeRef\.current === WFY_INPUT_OUTCOME\.CORRECT[\s\S]*return/)
  })
})

describe('evaluateMicScoreInformedInput', () => {
  const triadCheckpoint = {
    expectedMidis: [60, 64, 67],
    isChord: true,
  }

  it('completes when all expected chord tones are heard simultaneously', () => {
    const result = evaluateMicScoreInformedInput(triadCheckpoint, [60, 64, 67], settings)
    expect(result.outcome).toBe(MATCH_OUTCOME.COMPLETE)
    expect(result.isChord).toBe(true)
    expect(result.matchedIndices.size).toBe(3)
    expect(result.micEngineMode).toBe('v2-score-informed')
  })

  it('reports chord progress for partial simultaneous detection', () => {
    const result = evaluateMicScoreInformedInput(triadCheckpoint, [60, 64], settings)
    expect(result.outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(result.matchedCount).toBe(2)
    expect(result.totalExpected).toBe(3)
  })

  it('marks wrong when no expected tones match', () => {
    const result = evaluateMicScoreInformedInput(triadCheckpoint, [72], settings)
    expect(result.outcome).toBe(MATCH_OUTCOME.WRONG)
  })
})

describe('processMicEngineV2Tick', () => {
  it('emits multiple stable notes for a chord checkpoint', () => {
    const buffer = synthAttackWindow([60, 64, 67])
    const state = createMicEngineV2RuntimeState()
    let last = null

    for (let frame = 0; frame < 6; frame += 1) {
      last = processMicEngineV2Tick({
        buffer,
        sampleRate: SAMPLE_RATE,
        expectedMidis: [60, 64, 67],
        state,
        centsTolerance: 35,
        timeMs: frame * 20,
        stableFrameThreshold: 2,
      })
    }

    expect(last.usedV2).toBe(true)
    expect(last.frame?.v2DetectedMidis?.length).toBeGreaterThanOrEqual(2)
    expect(last.stableMidis).toEqual(expect.arrayContaining([60, 64, 67]))
    expect(last.stableMidis.length).toBe(3)
  })

  it('does not fall back to monophonic advancement when the V2 track is not stable', () => {
    const buffer = synthAttackWindow([60])
    const state = createMicEngineV2RuntimeState()
    const result = processMicEngineV2Tick({
      buffer,
      sampleRate: SAMPLE_RATE,
      expectedMidis: [60],
      state,
      centsTolerance: 35,
      stableFrameThreshold: 99,
      peakConfidenceThreshold: 0.99,
    })

    expect(result.usedV2).toBe(true)
    expect(result.signalFrame?.midi).toBe(60)
    expect(result.stableMidi).toBeNull()
    expect(result).not.toHaveProperty('usedV1Fallback')
  })

  it('threads instrument gate options into V2 signal diagnostics', () => {
    const buffer = synthSine(261.63, SAMPLE_RATE, 2048 / SAMPLE_RATE, 0.045)
    const state = createMicEngineV2RuntimeState()

    const strict = processMicEngineV2Tick({
      buffer,
      sampleRate: SAMPLE_RATE,
      expectedMidis: [60],
      state,
      gateOptions: { absoluteMin: 0.05, floorMultiplier: 2.8 },
    })
    resetMicEngineV2RuntimeState(state)
    const forgiving = processMicEngineV2Tick({
      buffer,
      sampleRate: SAMPLE_RATE,
      expectedMidis: [60],
      state,
      gateOptions: { absoluteMin: 0.005, floorMultiplier: 1 },
    })

    expect(strict.frame?.gateOpen).toBe(false)
    expect(forgiving.frame?.gateOpen).toBe(true)
  })

  it('does not advance a wrong note near the target', () => {
    const samples = synthSine(midiToFrequency(62), SAMPLE_RATE, 0.5, 0.35)
    const state = createMicEngineV2RuntimeState()
    let stableMidi = null
    const detectedMidis = new Set()

    for (let end = 2048; end <= samples.length; end += Math.round(SAMPLE_RATE / 60)) {
      const buffer = new Float32Array(samples.subarray(end - 2048, end))
      const result = processMicEngineV2Tick({
        buffer,
        sampleRate: SAMPLE_RATE,
        expectedMidis: [60],
        state,
        timeMs: end / SAMPLE_RATE * 1000,
        stableFrameThreshold: 2,
      })
      for (const midi of result.frame?.v2DetectedMidis ?? []) {
        detectedMidis.add(midi)
      }
      if (result.stableMidi != null) {
        stableMidi = result.stableMidi
      }
    }

    expect(stableMidi).toBeNull()
    expect([...detectedMidis]).toEqual([])
  })

  it('marks V2 unavailable on missing buffer and skips detection', () => {
    const state = createMicEngineV2RuntimeState()
    const result = processMicEngineV2Tick({
      buffer: null,
      sampleRate: SAMPLE_RATE,
      expectedMidis: [60],
      state,
    })

    expect(result.state.v2Unavailable).toBe(true)
    expect(result.usedV2).toBe(false)
    expect(result.frame).toBeNull()
  })

  it('clears per-note tracks when runtime state resets', () => {
    const buffer = synthAttackWindow([60, 64])
    const state = createMicEngineV2RuntimeState()

    processMicEngineV2Tick({
      buffer,
      sampleRate: SAMPLE_RATE,
      expectedMidis: [60, 64],
      state,
      timeMs: 0,
    })
    expect(state.perNoteTracks.size).toBeGreaterThan(0)

    resetMicEngineV2RuntimeState(state)
    expect(state.perNoteTracks.size).toBe(0)
    expect(state.lastDetectedMidis).toEqual([])
    expect(state.v2Unavailable).toBe(false)
  })

  it('requires fresh V2 frames after a checkpoint reset for repeated same-note targets', () => {
    const buffer = synthAttackWindow([60])
    const state = createMicEngineV2RuntimeState()
    let firstCheckpoint = null

    for (let frame = 0; frame < 3; frame += 1) {
      firstCheckpoint = processMicEngineV2Tick({
        buffer,
        sampleRate: SAMPLE_RATE,
        expectedMidis: [60],
        state,
        timeMs: frame * 20,
        stableFrameThreshold: 2,
        peakConfidenceThreshold: 0.99,
      })
    }
    expect(firstCheckpoint.stableMidi).toBe(60)

    resetMicEngineV2RuntimeState(state)
    const nextCheckpointFirstFrame = processMicEngineV2Tick({
      buffer,
      sampleRate: SAMPLE_RATE,
      expectedMidis: [60],
      state,
      timeMs: 100,
      stableFrameThreshold: 2,
      peakConfidenceThreshold: 0.99,
    })

    expect(nextCheckpointFirstFrame.stableMidi).toBeNull()
  })
})
