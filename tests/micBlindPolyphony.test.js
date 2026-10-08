/**
 * Blind polyphonic prototype (Stage 2, S3) — detection behavior on
 * synthetic fixtures. Proxies only: no real-world accuracy is claimed here.
 */
import { describe, expect, it } from 'vitest'
import {
  detectBlindPolyphony,
  replayBlindPolyphonySamples,
} from '../src/features/microphone-input/v2/blindPolyphonicDetector.js'
import {
  synthSimultaneousChord,
  synthRolledChord,
  synthElectricChord,
} from '../src/features/microphone-input/micSyntheticChordClips.js'
import {
  synthHarmonicTone,
  synthSilence,
  synthSpeech,
  synthWhiteNoise,
} from '../src/features/microphone-input/micSyntheticClips.js'

const SAMPLE_RATE = 44100

function midWindow(samples, size = 2048) {
  const start = Math.floor(samples.length / 2)
  return samples.subarray(start, start + size)
}

describe('blind polyphonic detector', () => {
  it('hears a simultaneous C major triad exactly, with no score knowledge', () => {
    const samples = synthSimultaneousChord([60, 64, 67], SAMPLE_RATE, {})
    const result = detectBlindPolyphony(midWindow(samples), SAMPLE_RATE, {})
    expect(result.detectedMidis).toEqual([60, 64, 67])
  })

  it('hears a dyad and a four-note tetrad including the masked interior tone', () => {
    const dyad = synthSimultaneousChord([60, 64], SAMPLE_RATE, {})
    expect(detectBlindPolyphony(midWindow(dyad), SAMPLE_RATE, {}).detectedMidis).toEqual([60, 64])
    const tetrad = synthSimultaneousChord([55, 59, 62, 65], SAMPLE_RATE, {})
    expect(detectBlindPolyphony(midWindow(tetrad), SAMPLE_RATE, {}).detectedMidis)
      .toEqual([55, 59, 62, 65])
  })

  it('hears a single harmonic note as exactly one pitch', () => {
    const samples = synthHarmonicTone(
      440,
      [
        { multiple: 1, amplitude: 0.5 },
        { multiple: 2, amplitude: 0.25 },
        { multiple: 3, amplitude: 0.12 },
      ],
      SAMPLE_RATE,
      0.6,
    )
    const result = detectBlindPolyphony(midWindow(samples), SAMPLE_RATE, {})
    expect(result.detectedMidis).toEqual([69])
  })

  it('suppresses the octave overtone instead of reporting it as played', () => {
    const samples = synthSimultaneousChord([60, 64, 67], SAMPLE_RATE, {})
    const result = detectBlindPolyphony(midWindow(samples), SAMPLE_RATE, {})
    expect(result.detectedMidis).not.toContain(72)
    const octave = result.candidates.find((candidate) => candidate.midi === 72)
    if (octave) {
      expect(octave.detected).toBe(false)
    }
  })

  it('stays silent on silence and white noise', () => {
    expect(
      detectBlindPolyphony(midWindow(synthSilence(SAMPLE_RATE, 0.6)), SAMPLE_RATE, {}).detectedMidis,
    ).toEqual([])
    expect(
      detectBlindPolyphony(midWindow(synthWhiteNoise(SAMPLE_RATE, 0.6, 7)), SAMPLE_RATE, {}).detectedMidis,
    ).toEqual([])
  })

  it('hears a clean electric dyad and a distorted power chord', () => {
    const dyad = synthElectricChord([45, 52], SAMPLE_RATE, { mode: 'clean' })
    expect(detectBlindPolyphony(midWindow(dyad), SAMPLE_RATE, {}).detectedMidis)
      .toEqual([45, 52])
    const power = synthElectricChord([40, 47], SAMPLE_RATE, { mode: 'distorted' })
    const replay = replayBlindPolyphonySamples(power, SAMPLE_RATE, {})
    expect(replay.stableMidis).toContain(40)
    expect(replay.stableMidis).toContain(47)
  })

  it('recovers part of a quiet six-string electric mix (known limitation)', () => {
    const samples = synthElectricChord([40, 45, 50, 55, 59, 64], SAMPLE_RATE, { mode: 'clean' })
    const replay = replayBlindPolyphonySamples(samples, SAMPLE_RATE, {})
    const played = [40, 45, 50, 55, 59, 64]
    const recall = replay.stableMidis.filter((midi) => played.includes(midi)).length
    expect(recall).toBeGreaterThanOrEqual(2)
    expect(replay.stableMidis).toContain(40)
  })

  it('reports what is actually played for the wrong-chord fixture', () => {
    const samples = synthSimultaneousChord([62, 65, 69], SAMPLE_RATE, {})
    const result = detectBlindPolyphony(midWindow(samples), SAMPLE_RATE, {})
    expect(result.detectedMidis).toEqual([62, 65, 69])
  })

  it('never invents a triad out of speech (documents single-source FP bound)', () => {
    const samples = synthSpeech(SAMPLE_RATE, 1.6, { f0: 220, seed: 17, driftSemitones: 2.4 })
    const replay = replayBlindPolyphonySamples(samples, SAMPLE_RATE, {})
    // Voiced speech CAN excite a drifting mono source: the blind layer is
    // allowed isolated tones, but must never stabilize a full phantom chord.
    expect(replay.stableMidis.length).toBeLessThan(3)
  })

  it('replays staggered strums into a stable simultaneous set', () => {
    const samples = synthRolledChord([60, 64, 67], SAMPLE_RATE, { staggerMs: 80 })
    expect(replayBlindPolyphonySamples(samples, SAMPLE_RATE, {}).stableMidis)
      .toEqual([60, 64, 67])
  })
})
