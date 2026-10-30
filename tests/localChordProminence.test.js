import { describe, expect, it } from 'vitest'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'
import { scoreInformedChordWindow } from '../src/features/microphone-input/v2/scoreInformedChordScorer.js'

const POLY = 'benchmarks/mic-polyphony/clips'
const REAL = 'benchmarks/mic-real/clips'
const ACC = 'benchmarks/mic-accuracy/clips'

function scoreAt(path, ms, expected, options = {}) {
  const wav = readWavPcm(path)
  const end = Math.floor((ms / 1000) * wav.sampleRate)
  const samples = wav.samples.subarray(0, end)
  return scoreInformedChordWindow(samples, wav.sampleRate, expected, {
    fftSize: 2048,
    ...options,
  })
}

function note(result, midi) {
  return result.notes.find((entry) => entry.midi === midi)
}

describe('local chord-tone prominence rescue', () => {
  it('recovers a genuinely present quiet E4 in the UIowa C-major triad', () => {
    const normal = scoreAt(`${POLY}/uiowa-piano-mf-c-major-triad.wav`, 400, [60, 64, 67], {
      localProminenceRescue: false,
    })
    expect(normal.detectedMidis).not.toContain(64)

    const rescued = scoreAt(`${POLY}/uiowa-piano-mf-c-major-triad.wav`, 400, [60, 64, 67])
    expect(rescued.detectedMidis).toEqual(expect.arrayContaining([60, 64, 67]))
    expect(note(rescued, 64).localProminenceRescue).toBe(true)
    expect(note(rescued, 64).localProminence).toBeGreaterThan(6)
  })

  it('recovers the quiet Cmaj7 chord tones but not a missing B4 on a C triad', () => {
    const cmaj7 = scoreAt(`${POLY}/uiowa-piano-mf-cmaj7.wav`, 400, [60, 64, 67, 71])
    expect(cmaj7.detectedMidis).toEqual(expect.arrayContaining([60, 64, 67, 71]))

    const negative = scoreAt(`${POLY}/uiowa-piano-mf-c-major-triad.wav`, 400, [60, 64, 67, 71])
    expect(note(negative, 71).detected).toBe(false)
  })

  it('recovers the quiet A3 of the natural Vienna Schubert triad at 450 ms', () => {
    const normal = scoreAt(`${REAL}/piano-schubert-triad.wav`, 450, [56, 60, 65], {
      localProminenceRescue: false,
    })
    expect(normal.detectedMidis).not.toContain(56)
    const rescued = scoreAt(`${REAL}/piano-schubert-triad.wav`, 450, [56, 60, 65])
    expect(rescued.detectedMidis).toEqual(expect.arrayContaining([56, 60, 65]))
    expect(note(rescued, 56).localProminenceRescue).toBe(true)
  })

  it('does not invent the missing fifth of a C4+E4 dyad', () => {
    const result = scoreAt(`${POLY}/uiowa-piano-mf-c4-e4-dyad.wav`, 400, [60, 64, 67])
    expect(note(result, 67).detected).toBe(false)
  })

  it('does not rescue a C5 octave ghost of a played C4', () => {
    const result = scoreAt(`${ACC}/uiowa-piano-mf-c4.wav`, 400, [60, 72])
    expect(note(result, 72).detected).toBe(false)
  })

  it('does not invent a fifth over a single C4', () => {
    const result = scoreAt(`${ACC}/uiowa-piano-mf-c4.wav`, 400, [60, 67])
    expect(note(result, 67).detected).toBe(false)
  })

  it('does not rescue noise or a transposed wrong chord', () => {
    const noise = scoreAt(`${ACC}/real-room-noisy.wav`, 500, [60, 64, 67])
    expect(noise.notes.some((entry) => entry.localProminenceRescue)).toBe(false)

    const jazz = scoreAt(`${REAL}/acoustic-jazz-dyad.wav`, 500, [52, 62])
    expect(jazz.notes.some((entry) => entry.localProminenceRescue)).toBe(false)

    const eg08 = scoreAt(`${REAL}/electric-eg08-triad.wav`, 500, [49, 60, 74])
    expect(eg08.notes.some((entry) => entry.localProminenceRescue)).toBe(false)
  })

  it('keeps a legitimate fifth untouched', () => {
    const result = scoreAt(`${REAL}/acoustic-power-dyad.wav`, 500, [49, 56])
    expect(result.detectedMidis).toEqual(expect.arrayContaining([49, 56]))
  })
})
