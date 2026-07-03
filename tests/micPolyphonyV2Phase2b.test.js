/**
 * Mic Engine V2 Phase 2B — dyad, rolled chord, and bass improvements.
 */
import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMicPolyphonyManifest, sliceClipSamples } from '../src/features/microphone-input/micPolyphonyManifest.js'
import {
  classifyChordShape,
  compareV2Phase2Baseline,
  evaluatePolyphonyClip,
  PHASE2_V2_BASELINE,
  summarizeMicPolyphony,
} from '../src/features/microphone-input/micPolyphonyReport.js'
import { renderSyntheticChordClip } from '../src/features/microphone-input/micSyntheticChordClips.js'
import {
  aggregateScoreInformedTracks,
  shiftClipRelativeDetections,
} from '../src/features/microphone-input/v2/micScoreInformedAggregation.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const manifestPath = join(root, 'benchmarks/mic-polyphony/manifest.json')
const SAMPLE_RATE = 44100
const settings = normalizeMatchSettings({})

function replayClip(clip, manifest) {
  let samples
  let sampleRate = SAMPLE_RATE
  if (clip.synthetic) {
    samples = renderSyntheticChordClip(clip.synthetic, SAMPLE_RATE)
  } else {
    const wav = readWavPcm(join(root, 'benchmarks/mic-polyphony', clip.file))
    samples = sliceClipSamples(wav.samples, wav.sampleRate, {
      startMs: clip.startMs,
      endMs: clip.endMs,
    })
    sampleRate = wav.sampleRate
  }
  return replayScoreInformedPolyphonyClip(samples, sampleRate, {
    expectedMidis: clip.expectedMidis ?? [],
    chordType: clip.chordType ?? null,
    rollMs: clip.rollMs ?? null,
    expectedOnsetMs: clip.expectedOnsetMs ?? 0,
  })
}

describe('Mic V2 Phase 2B aggregation', () => {
  it('keeps detections within FFT hop tolerance of clip boundary', () => {
    const detections = [{ midi: 60, timeMs: 933.33, confidence: 0.5 }]
    const shifted = shiftClipRelativeDetections(detections, 950, 1000 / 60)
    expect(shifted).toHaveLength(1)
    expect(shifted[0].timeMs).toBe(0)
  })

  it('aggregates rolled chord tracks with peak confidence', () => {
    const stable = aggregateScoreInformedTracks(
      [
        { midi: 60, maxConfidence: 0.45, firstTimeMs: 0, stableFrames: 1, peakRatio: 2 },
        { midi: 64, maxConfidence: 0.42, firstTimeMs: 80, stableFrames: 1, peakRatio: 2 },
        { midi: 67, maxConfidence: 0.4, firstTimeMs: 160, stableFrames: 1, peakRatio: 2 },
      ],
      { chordType: 'rolled', rollMs: 80, expectedMidis: [60, 64, 67] },
    )
    expect(stable.map((entry) => entry.midi)).toEqual([60, 64, 67])
  })
})

describe('Mic V2 Phase 2B dyad and rolled chord replay', () => {
  it('hits synthetic dyad C4+E4', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const clip = manifest.clips.find((entry) => entry.id === 'synth-dyad-c4-e4')
    const replay = replayClip(clip, manifest)
    const evaluation = evaluatePolyphonyClip(clip, replay, {
      centsTolerance: settings.micCentsTolerance,
    })
    expect(evaluation.chordHit).toBe(true)
    expect(evaluation.missedMidis).toEqual([])
    expect(classifyChordShape(clip)).toBe('dyad')
  })

  it('hits rolled C-major triad with all three notes', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const clip = manifest.clips.find((entry) => entry.id === 'synth-rolled-c-major')
    const replay = replayClip(clip, manifest)
    const evaluation = evaluatePolyphonyClip(clip, replay, {
      centsTolerance: settings.micCentsTolerance,
    })
    expect(evaluation.chordHit).toBe(true)
    expect(evaluation.matchedMidis).toEqual(expect.arrayContaining([60, 64, 67]))
    expect(classifyChordShape(clip)).toBe('rolled')
  })

  it('hits real dyad fixture WAV', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const clip = manifest.clips.find((entry) => entry.id === 'real-dyad-c4-g4')
    const replay = replayClip(clip, manifest)
    const evaluation = evaluatePolyphonyClip(clip, replay, {
      centsTolerance: settings.micCentsTolerance,
    })
    expect(evaluation.chordHit).toBe(true)
    expect(evaluation.missedMidis).toEqual([])
  })

  it('improves over Phase 2 baseline on the full manifest without false positives', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const evaluations = manifest.clips.map((clip) => {
      if (!clip.synthetic && !clip.file) {
        return evaluatePolyphonyClip({ ...clip, missingFile: true }, { stableDetections: [] })
      }
      const replay = replayClip(clip, manifest)
      return evaluatePolyphonyClip(clip, replay, { centsTolerance: settings.micCentsTolerance })
    })
    const summary = summarizeMicPolyphony(evaluations, {
      engine: 'v2-score-informed-phase-2b',
      scorerVersion: 'phase-2b',
    })
    const phase2b = compareV2Phase2Baseline(summary, PHASE2_V2_BASELINE)
    expect(phase2b.improved).toBe(true)
    expect(summary.falsePositiveRate).toBe(0)
    expect(summary.chordHitRate).toBeGreaterThan(PHASE2_V2_BASELINE.chordHitRate)
    expect(summary.perNoteHitRate).toBeGreaterThanOrEqual(PHASE2_V2_BASELINE.perNoteHitRate)
    expect(summary.byChordShape?.dyad?.chordHitRate).toBe(1)
    expect(summary.byChordShape?.rolled?.chordHitRate).toBe(1)
  })
})
