/**
 * Mic polyphony measurement — manifest, scoring, and V1 baseline replay.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadMicPolyphonyManifest,
  normalizeExpectedMidis,
  normalizeMicPolyphonyClip,
  resolveMicPolyphonyClipAudio,
  sliceClipSamples,
} from '../src/features/microphone-input/micPolyphonyManifest.js'
import {
  evaluatePolyphonyClip,
  formatMicPolyphonyReportMarkdown,
  summarizeMicPolyphony,
} from '../src/features/microphone-input/micPolyphonyReport.js'
import { replayPolyphonyClip } from '../src/features/microphone-input/micPolyphonyReplayHarness.js'
import {
  renderSyntheticChordClip,
} from '../src/features/microphone-input/micSyntheticChordClips.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const manifestPath = join(root, 'benchmarks/mic-polyphony/manifest.json')
const SAMPLE_RATE = 44100
const settings = normalizeMatchSettings({})

describe('mic polyphony manifest', () => {
  it('loads and normalizes chord clip metadata', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    expect(manifest.version).toBe(1)
    expect(manifest.clips.some((clip) => clip.label === 'chord')).toBe(true)
    const triad = manifest.clips.find((clip) => clip.id === 'synth-c-major-triad')
    expect(triad.expectedMidis).toEqual([60, 64, 67])
    expect(triad.chordType).toBe('simultaneous')
    expect(triad.instrument).toBe('piano')
  })

  it('normalizes expected MIDI arrays', () => {
    expect(normalizeExpectedMidis([64, 60, 60])).toEqual([60, 64])
  })

  it('documents manifest fields in README', () => {
    const readme = readFileSync(join(root, 'benchmarks/mic-polyphony/README.md'), 'utf8')
    expect(readme).toContain('expectedMidis')
    expect(readme).toContain('chordType')
    expect(readme).toContain('mic:polyphony-replay')
    expect(readme).toContain('Chord hit rate')
  })
})

describe('mic polyphony scoring', () => {
  it('scores a full chord hit when all expected notes are detected', () => {
    const evaluation = evaluatePolyphonyClip(
      {
        id: 'triad',
        label: 'chord',
        expectedMidis: [60, 64, 67],
        chordType: 'simultaneous',
      },
      {
        stableDetections: [
          { midi: 60, timeMs: 200, clarity: 0.9 },
          { midi: 64, timeMs: 220, clarity: 0.88 },
          { midi: 67, timeMs: 240, clarity: 0.87 },
        ],
      },
      { centsTolerance: settings.micCentsTolerance },
    )
    expect(evaluation.chordHit).toBe(true)
    expect(evaluation.perNoteHitRate).toBe(1)
    expect(evaluation.missedMidis).toEqual([])
    expect(evaluation.meanConfidence).toBeGreaterThan(0.8)
  })

  it('reports partial chords and missed notes', () => {
    const evaluation = evaluatePolyphonyClip(
      {
        id: 'partial',
        label: 'chord',
        expectedMidis: [60, 64, 67],
      },
      { stableDetections: [{ midi: 60, timeMs: 150, clarity: 0.8 }] },
      { centsTolerance: settings.micCentsTolerance },
    )
    expect(evaluation.chordHit).toBe(false)
    expect(evaluation.partialChord).toBe(true)
    expect(evaluation.missedMidis).toEqual([64, 67])
    expect(evaluation.perNoteHitRate).toBeCloseTo(1 / 3, 5)
  })

  it('marks skipped missing-file clips without false negatives', () => {
    const evaluation = evaluatePolyphonyClip(
      { id: 'missing', label: 'chord', expectedMidis: [60, 64], missingFile: true },
      { stableDetections: [], frames: [] },
    )
    expect(evaluation.skipped).toBe(true)
    expect(evaluation.chordHit).toBe(false)
    const summary = summarizeMicPolyphony([evaluation])
    expect(summary.skippedClipCount).toBe(1)
    expect(summary.chordHitRate).toBeNull()
  })

  it('summarizes chord and per-note hit rates', () => {
    const evaluations = [
      evaluatePolyphonyClip(
        { id: 'a', label: 'chord', expectedMidis: [60, 64] },
        { stableDetections: [{ midi: 60, clarity: 0.8 }, { midi: 64, clarity: 0.7 }] },
      ),
      evaluatePolyphonyClip(
        { id: 'b', label: 'chord', expectedMidis: [60, 64, 67] },
        { stableDetections: [{ midi: 60, clarity: 0.75 }] },
      ),
      evaluatePolyphonyClip(
        { id: 'c', label: 'silence', expectedMidis: null },
        { stableDetections: [] },
      ),
    ]
    const summary = summarizeMicPolyphony(evaluations)
    expect(summary.chordHitRate).toBe(0.5)
    expect(summary.perNoteHitRate).toBeCloseTo(3 / 5, 5)
    expect(summary.missedNoteCount).toBe(2)
    expect(summary.falsePositiveRate).toBe(0)
    expect(formatMicPolyphonyReportMarkdown(summary)).toContain('Per-note hit rate')
  })
})

describe('mic polyphony — V1 baseline replay', () => {
  it('replays synthetic chord clips through the monophonic harness', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const clip = manifest.clips.find((entry) => entry.id === 'synth-dyad-c4-e4')
    const samples = renderSyntheticChordClip(clip.synthetic, SAMPLE_RATE)
    const replay = replayPolyphonyClip(samples, SAMPLE_RATE, {
      centsTolerance: settings.micCentsTolerance,
    })
    const evaluation = evaluatePolyphonyClip(clip, replay, {
      centsTolerance: settings.micCentsTolerance,
    })
    expect(evaluation.skipped).toBe(false)
    expect(evaluation.outcome).toBeTruthy()
    expect(replay.stableDetections).toBeDefined()
  })

  it('runs the full manifest and produces a measurable polyphony report', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const evaluations = []
    for (const clip of manifest.clips) {
      const audio = resolveMicPolyphonyClipAudio(clip, manifest, SAMPLE_RATE)
      if (audio.missingFile) {
        evaluations.push(evaluatePolyphonyClip({ ...clip, missingFile: true }, { stableDetections: [] }))
        continue
      }
      let samples
      let sampleRate = SAMPLE_RATE
      if (clip.synthetic) {
        samples = renderSyntheticChordClip(clip.synthetic, SAMPLE_RATE)
      } else {
        const wav = readWavPcm(audio.filePath)
        samples = wav.samples
        sampleRate = wav.sampleRate
      }
      const sliced = sliceClipSamples(samples, sampleRate, {
        startMs: clip.startMs,
        endMs: clip.endMs,
      })
      const replay = replayPolyphonyClip(sliced, sampleRate, {
        centsTolerance: settings.micCentsTolerance,
      })
      evaluations.push(
        evaluatePolyphonyClip(clip, replay, { centsTolerance: settings.micCentsTolerance }),
      )
    }
    const summary = summarizeMicPolyphony(evaluations)
    expect(summary.engine).toBe('v1-monophonic-baseline')
    expect(summary.measuredClipCount).toBeGreaterThan(0)
    expect(summary.tuningRecommendation).toContain('do not tune')
  })
})
