import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMicPolyphonyManifest, sliceClipSamples } from '../src/features/microphone-input/micPolyphonyManifest.js'
import { renderSyntheticChordClip } from '../src/features/microphone-input/micSyntheticChordClips.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'
import {
  createGuitarRecognitionState,
  evaluateGuitarRecognition,
} from '../src/features/microphone-input/v3/guitarRecognition.js'
import {
  PERFORMANCE_MODE,
  buildPerformanceExpectation,
} from '../src/features/microphone-input/v3/performanceExpectation.js'
import { RECOGNITION_OUTCOME } from '../src/features/microphone-input/v3/micRecognitionIr.js'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const manifestPath = join(root, 'benchmarks/mic-polyphony/manifest.json')
const SAMPLE_RATE = 44100

function expectation(midis, extra = {}) {
  const checkpoint = {
    id: extra.id ?? `guitar-${midis.join('-')}`,
    index: 0,
    timeSeconds: extra.timeSeconds ?? 1,
    expectedMidis: midis,
    expectedMidi: midis[0],
    isChord: midis.length > 1,
    rollingWindowMs: extra.rollingWindowMs ?? 900,
    minimumRequiredTones: extra.minimumRequiredTones,
    expectedStringFrets: extra.expectedStringFrets ?? midis.map((midi, index) => ({
      midi,
      string: Math.max(1, 6 - index),
      fret: index,
    })),
    notes: midis.map((midi, index) => ({
      id: `n${index}`,
      midi,
      string: extra.expectedStringFrets?.[index]?.string ?? Math.max(1, 6 - index),
      fret: extra.expectedStringFrets?.[index]?.fret ?? index,
      guitarTechniques: extra.techniques?.[index] ?? [],
    })),
  }
  return buildPerformanceExpectation({
    checkpoint,
    checkpointIndex: 0,
    checkpoints: [checkpoint],
    instrument: 'guitar',
    mode: PERFORMANCE_MODE.WAIT_FOR_YOU,
  })
}

function frame(midis, extra = {}) {
  return {
    timeMs: extra.timeMs ?? 1000,
    sampleRate: 44100,
    windowMs: 46.4,
    gateOpen: extra.gateOpen ?? true,
    musical: extra.musical ?? true,
    clarity: extra.clarity ?? 0.8,
    midiFloat: extra.midiFloat ?? midis[0] ?? null,
    ringingMidis: extra.ringingMidis ?? [],
    unexpectedMidis: extra.unexpectedMidis ?? [],
    legatoTransition: extra.legatoTransition ?? false,
    v2Notes: midis.map((midi, index) => ({
      midi,
      detected: true,
      confidence: extra.confidences?.[index] ?? 0.65,
      ratio: extra.ratios?.[index] ?? 2.2,
      harmonicSupport: 1.4,
    })),
  }
}

function evaluateOnce(target, heard, extra = {}) {
  return evaluateGuitarRecognition({
    expectation: target,
    frame: frame(heard, extra.frame),
    state: createGuitarRecognitionState(target),
    timeMs: extra.timeMs ?? 1000,
    attack: extra.attack ?? { id: 'attack-1', fresh: true, confidence: 0.9 },
    musical: extra.musical,
  })
}

describe('Mic V3 Guitar recognition', () => {
  it('requires both tones of a double-stop', () => {
    const target = expectation([45, 57])
    const one = evaluateOnce(target, [45])
    const both = evaluateOnce(target, [45, 57])

    expect(one.decision.outcome).toBe(RECOGNITION_OUTCOME.PROGRESS)
    expect(one.decision.advance).toBe(false)
    expect(both.decision.outcome).toBe(RECOGNITION_OUTCOME.ACCEPTED)
    expect(both.decision.matchedMidis).toEqual([45, 57])
  })

  it('uses a bass-anchored quorum for 3–6 note chords', () => {
    const target = expectation([40, 45, 50, 55, 59, 64], { minimumRequiredTones: 3 })
    const upperOnly = evaluateOnce(target, [55, 59, 64])
    const anchored = evaluateOnce(target, [40, 55, 59])

    expect(upperOnly.decision.advance).toBe(false)
    expect(upperOnly.decision.reason).toBe('guitar-chord-progress')
    expect(anchored.decision.advance).toBe(true)
    expect(anchored.decision.progress.bassAnchorPresent).toBe(true)

    const triad = expectation([40, 47, 52], { minimumRequiredTones: 2 })
    expect(evaluateOnce(triad, [40, 47]).decision.advance).toBe(true)
  })

  it('rejects a wrong chord even when it contains an expected tone', () => {
    const target = expectation([40, 47])
    const result = evaluateOnce(target, [40], {
      frame: { unexpectedMidis: [48], midiFloat: 48, clarity: 0.9 },
    })

    expect(result.decision.outcome).toBe(RECOGNITION_OUTCOME.REJECTED)
    expect(result.decision.reason).toBe('unexpected-tone')
    expect(result.decision.advance).toBe(false)
    expect(result.decision.unexpectedMidis).toContain(48)
  })

  it('rejects speech/noise and accepts quiet or distorted evidence only after the detector marks it musical', () => {
    const target = expectation([52])
    const speech = evaluateOnce(target, [52], { musical: false })
    const noise = evaluateOnce(target, [], { musical: false, frame: { gateOpen: false } })
    const quiet = evaluateOnce(target, [52], {
      frame: { confidences: [0.34], ratios: [1.4], gateOpen: true },
      musical: true,
    })
    const distorted = evaluateOnce(target, [52], {
      frame: { confidences: [0.5], ratios: [1.7], gateOpen: true },
      musical: true,
    })

    expect(speech.decision.advance).toBe(false)
    expect(speech.decision.reason).toBe('non-musical-input')
    expect(noise.decision.advance).toBe(false)
    expect(quiet.decision.advance).toBe(true)
    expect(distorted.decision.advance).toBe(true)
  })

  it('does not let a ringing note consume the next checkpoint without a new attack', () => {
    const target = expectation([55], { id: 'next-note' })
    const result = evaluateGuitarRecognition({
      expectation: target,
      frame: frame([55], { ringingMidis: [55] }),
      state: createGuitarRecognitionState(target),
      timeMs: 1200,
      attack: { fresh: false },
      musical: true,
    })

    expect(result.decision.outcome).toBe(RECOGNITION_OUTCOME.HOLD)
    expect(result.decision.reason).toBe('ringing-without-new-attack')
    expect(result.decision.advance).toBe(false)
  })

  it('accepts score-marked hammer-ons and pull-offs as legato attacks', () => {
    for (const kind of ['hammer-on', 'pull-off']) {
      const target = expectation([57], {
        id: kind,
        techniques: [[{ kind, type: 'stop', number: '1' }]],
      })
      const result = evaluateGuitarRecognition({
        expectation: target,
        frame: frame([57], { legatoTransition: true }),
        state: createGuitarRecognitionState(target),
        timeMs: 1300,
        attack: { fresh: false },
        musical: true,
      })
      expect(result.decision.advance, kind).toBe(true)
      expect(result.decision.reason).toBe('expected-legato-transition')
    }
  })

  it('accepts short muted-string evidence from one fresh attack and never advances from empty evidence', () => {
    const muted = expectation([45, 52], {
      id: 'muted-double-stop',
      techniques: [
        [{ kind: 'muted' }],
        [{ kind: 'muted' }],
      ],
    })
    expect(muted.event.expectedNotes.every((note) => note.muted)).toBe(true)
    expect(evaluateOnce(muted, [45, 52]).decision.advance).toBe(true)
    expect(evaluateOnce(muted, []).decision.advance).toBe(false)
  })

  it('accumulates staggered strum tones inside the score window', () => {
    const target = expectation([40, 47], { rollingWindowMs: 400 })
    let state = createGuitarRecognitionState(target)
    const first = evaluateGuitarRecognition({
      expectation: target,
      frame: frame([40], { timeMs: 1000 }),
      state,
      timeMs: 1000,
      attack: { id: 'strum', fresh: true, confidence: 0.9 },
      musical: true,
    })
    state = first.state
    const second = evaluateGuitarRecognition({
      expectation: target,
      frame: frame([47], { timeMs: 1120 }),
      state,
      timeMs: 1120,
      attack: { id: 'strum', fresh: false, confidence: 0.8 },
      musical: true,
    })

    expect(first.decision.outcome).toBe(RECOGNITION_OUTCOME.PROGRESS)
    expect(second.decision.advance).toBe(true)
  })

  it('exports immutable serializable debug decisions with string/fret confidence', () => {
    const target = expectation([45, 52])
    const result = evaluateOnce(target, [45, 52])
    expect(result.decision.confidence.instrument).toBe(1)
    expect(result.window.chordProgress.requiredCount).toBe(2)
    expect(Object.isFrozen(result.decision)).toBe(true)
    expect(() => JSON.stringify(result.window)).not.toThrow()
  })
})

describe('Mic V3 Guitar real-timbre evaluation gate', () => {
  it('accepts every existing acoustic/electric guitar replay without changing detector thresholds', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const guitarClips = manifest.clips.filter((clip) => clip.instrument === 'guitar')
    expect(guitarClips).toHaveLength(6)

    for (const clip of guitarClips) {
      let samples
      let sampleRate = SAMPLE_RATE
      if (clip.synthetic) {
        samples = renderSyntheticChordClip(clip.synthetic, sampleRate)
      } else {
        const wav = readWavPcm(join(root, 'benchmarks/mic-polyphony', clip.file))
        samples = sliceClipSamples(wav.samples, wav.sampleRate, {
          startMs: clip.startMs,
          endMs: clip.endMs,
        })
        sampleRate = wav.sampleRate
      }
      const replay = replayScoreInformedPolyphonyClip(samples, sampleRate, {
        expectedMidis: clip.expectedMidis,
        chordType: clip.chordType,
        rollMs: clip.rollMs,
        expectedOnsetMs: clip.expectedOnsetMs,
        scorerOptions: { expectedStringFrets: clip.expectedStringFrets },
      })
      const target = expectation(clip.expectedMidis, {
        id: clip.id,
        expectedStringFrets: clip.expectedStringFrets,
        minimumRequiredTones: clip.expectedMidis.length <= 2 ? 2 : 3,
        rollingWindowMs: 900,
      })
      let state = createGuitarRecognitionState(target)
      let accepted = false
      let attackStarted = false
      for (const replayFrame of replay.frames) {
        if (!replayFrame.detectedMidis.length) {
          continue
        }
        const result = evaluateGuitarRecognition({
          expectation: target,
          state,
          timeMs: replayFrame.timeMs,
          frame: {
            ...replayFrame,
            sampleRate,
            windowMs: replay.fftSize / sampleRate * 1000,
            gateOpen: true,
            musical: true,
            v2Notes: replayFrame.notes,
          },
          attack: {
            id: `${clip.id}-attack`,
            fresh: !attackStarted,
            confidence: 0.9,
          },
          musical: true,
        })
        attackStarted = true
        state = result.state
        if (result.decision.advance) {
          accepted = true
          break
        }
      }
      expect(accepted, clip.id).toBe(true)
    }
  })
})
