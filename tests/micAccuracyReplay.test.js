/**
 * Offline mic replay harness — deterministic measurement before tuning.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  replayMicClip,
  MIC_REPLAY_FFT_SIZE,
  frameHopSamples,
} from '../src/features/microphone-input/micReplayHarness.js'
import {
  evaluateLabeledClip,
  formatMicAccuracyReportMarkdown,
  summarizeMicAccuracy,
} from '../src/features/microphone-input/micAccuracyReport.js'
import {
  loadMicAccuracyManifest,
  resolveMicAccuracyClipAudio,
  sliceClipSamples,
} from '../src/features/microphone-input/micAccuracyManifest.js'
import { renderSyntheticClip, synthSine } from '../src/features/microphone-input/micSyntheticClips.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const manifestPath = join(root, 'benchmarks/mic-accuracy/manifest.json')

const SAMPLE_RATE = 44100
const settings = normalizeMatchSettings({})

describe('mic replay harness', () => {
  it('matches live analyser frame size and hop cadence', () => {
    expect(MIC_REPLAY_FFT_SIZE).toBe(2048)
    expect(frameHopSamples(44100)).toBe(Math.round(44100 / 60))
  })

  it('completes calibration and emits analysis frames for a sine clip', () => {
    const samples = synthSine(440, SAMPLE_RATE, 0.6, 0.35)

    const replay = replayMicClip(samples, SAMPLE_RATE, {
      centsTolerance: settings.micCentsTolerance,
    })

    expect(replay.calibration?.ready).toBe(true)
    expect(replay.frames.length).toBeGreaterThan(0)
    expect(replay.clipStartMs).toBeGreaterThan(0)
  })

  it('does not emit stable notes on silence', () => {
    const silence = renderSyntheticClip({ type: 'silence', seconds: 0.6 }, SAMPLE_RATE)

    const replay = replayMicClip(silence, SAMPLE_RATE, {
      centsTolerance: settings.micCentsTolerance,
    })
    expect(replay.stableDetections.length).toBe(0)
  })
})

describe('mic accuracy report', () => {
  it('computes hit rate, false negatives, and false positives', () => {
    const evaluations = [
      evaluateLabeledClip(
        { id: 'hit', label: 'note', expectedMidi: 60 },
        { stableDetections: [{ midi: 60, timeMs: 200, clarity: 0.8, centsOffset: 2 }], frames: [] },
      ),
      evaluateLabeledClip(
        { id: 'miss', label: 'note', expectedMidi: 64 },
        { stableDetections: [], frames: [] },
      ),
      evaluateLabeledClip(
        { id: 'quiet', label: 'silence', expectedMidi: null },
        { stableDetections: [], frames: [] },
      ),
      evaluateLabeledClip(
        { id: 'fp', label: 'noise', expectedMidi: null },
        { stableDetections: [{ midi: 67, timeMs: 100, clarity: 0.5, centsOffset: 0 }], frames: [] },
      ),
    ]

    const summary = summarizeMicAccuracy(evaluations)
    expect(summary.hitRate).toBeCloseTo(0.5)
    expect(summary.falseNegativeRate).toBeCloseTo(0.5)
    expect(summary.falsePositiveRate).toBeCloseTo(0.5)
    expect(summary.meanClarity).toBeCloseTo(0.8)
    expect(summary.meanAbsCentsError).toBeCloseTo(2)
    expect(formatMicAccuracyReportMarkdown(summary)).toContain('Hit rate')
  })
})

describe('mic accuracy manifest', () => {
  it('loads the fixture manifest with synthetic and file placeholders', () => {
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = loadMicAccuracyManifest(manifestPath)
    expect(manifest.version).toBe(1)
    expect(manifest.clips.length).toBeGreaterThanOrEqual(4)
    expect(manifest.clips.some((clip) => clip.synthetic)).toBe(true)
    expect(manifest.clips.some((clip) => clip.file?.startsWith('clips/'))).toBe(true)
  })

  it('loads real WAV fixtures from the manifest', () => {
    const manifest = loadMicAccuracyManifest(manifestPath)
    const fileClips = manifest.clips.filter((clip) => clip.file && !clip.synthetic)
    expect(fileClips.length).toBeGreaterThanOrEqual(3)
    for (const clip of fileClips) {
      const audio = resolveMicAccuracyClipAudio(clip, manifest, SAMPLE_RATE)
      expect(audio.missingFile).toBe(false)
    }
  })

  it('replays synthetic manifest clips and produces a measurable report', () => {
    const manifest = loadMicAccuracyManifest(manifestPath)
    const syntheticClips = manifest.clips.filter((clip) => clip.synthetic)
    const evaluations = []

    for (const clip of syntheticClips) {
      const audio = resolveMicAccuracyClipAudio(clip, manifest, SAMPLE_RATE)
      expect(audio.missingFile).toBe(false)
      const samples = renderSyntheticClip(clip.synthetic, SAMPLE_RATE)
      const replay = replayMicClip(samples, SAMPLE_RATE, {
        centsTolerance: settings.micCentsTolerance,
      })
      evaluations.push(evaluateLabeledClip(clip, replay, { centsTolerance: settings.micCentsTolerance }))
    }

    const summary = summarizeMicAccuracy(evaluations)
    expect(summary.measuredClipCount).toBe(syntheticClips.length)
    expect(summary.noteClipCount).toBe(2)
    expect(summary.rejectClipCount).toBe(2)
    expect(summary.hitRate).not.toBeNull()
    expect(summary.falsePositiveRate).toBe(0)
    expect(summary.tuningRecommendation).toContain('do not tune')
    expect(formatMicAccuracyReportMarkdown(summary)).toContain('False negative rate')
    expect(formatMicAccuracyReportMarkdown(summary)).toContain('Tuning guidance')
  })

  it('replays real-file note clips with measurable hits', () => {
    const manifest = loadMicAccuracyManifest(manifestPath)
    const noteClips = manifest.clips.filter(
      (clip) => clip.file && !clip.synthetic && clip.label === 'note',
    )
    const evaluations = []

    for (const clip of noteClips) {
      const audio = resolveMicAccuracyClipAudio(clip, manifest, SAMPLE_RATE)
      expect(audio.missingFile).toBe(false)
      const wav = readWavPcm(audio.filePath)
      const samples = sliceClipSamples(wav.samples, wav.sampleRate, {
        startMs: clip.startMs,
        endMs: clip.endMs,
      })
      const replay = replayMicClip(samples, wav.sampleRate, {
        centsTolerance: settings.micCentsTolerance,
      })
      evaluations.push(evaluateLabeledClip(clip, replay, { centsTolerance: settings.micCentsTolerance }))
    }

    const summary = summarizeMicAccuracy(evaluations)
    expect(summary.realFileNoteClipCount).toBe(noteClips.length)
    expect(summary.realFileHitRate).toBeGreaterThanOrEqual(0.66)
    expect(summary.hits).toBeGreaterThanOrEqual(2)
  })

  it('skips missing file placeholders without counting them as misses', () => {
    const manifest = loadMicAccuracyManifest(manifestPath)
    const filePlaceholder = manifest.clips.find((clip) => clip.file && !clip.synthetic)
    expect(filePlaceholder).toBeTruthy()
    const evaluation = evaluateLabeledClip(
      { ...filePlaceholder, missingFile: true },
      { stableDetections: [], frames: [] },
    )
    expect(evaluation.skipped).toBe(true)
    const summary = summarizeMicAccuracy([evaluation])
    expect(summary.skippedClipCount).toBe(1)
    expect(summary.falseNegativeRate).toBeNull()
  })

  it('documents how to add real recordings', () => {
    const readme = readFileSync(join(root, 'benchmarks/mic-accuracy/README.md'), 'utf8')
    expect(readme).toContain('Add a real recording')
    expect(readme).toContain('instrument')
    expect(readme).toContain('noiseCondition')
    expect(readme).toContain('startMs')
    expect(readme).toContain('mic:generate-clips')
    expect(readme).toContain('expectedMidi')
  })
})

describe('mic accuracy — offline replay isolation', () => {
  it('uses a fresh stabilizer for each replayMicClip invocation', () => {
    const clipA = { id: 'a', label: 'note', expectedMidi: 60 }
    const clipB = { id: 'b', label: 'note', expectedMidi: 64 }

    const samplesA = renderSyntheticClip(
      { type: 'sine', midi: 60, seconds: 0.7, amplitude: 0.35 },
      SAMPLE_RATE,
    )
    const samplesB = renderSyntheticClip(
      { type: 'sine', midi: 64, seconds: 0.7, amplitude: 0.35 },
      SAMPLE_RATE,
    )

    const replayA = replayMicClip(samplesA, SAMPLE_RATE, {
      centsTolerance: settings.micCentsTolerance,
    })
    const replayB = replayMicClip(samplesB, SAMPLE_RATE, {
      centsTolerance: settings.micCentsTolerance,
    })

    expect(replayA.calibration?.ready).toBe(true)
    expect(replayB.calibration?.ready).toBe(true)
    expect(replayA).not.toBe(replayB)

    const evalA = evaluateLabeledClip(clipA, replayA, { centsTolerance: settings.micCentsTolerance })
    const evalB = evaluateLabeledClip(clipB, replayB, { centsTolerance: settings.micCentsTolerance })
    expect(evalA.clipId).toBe('a')
    expect(evalB.clipId).toBe('b')
  })

  it('scores a wrong expected note as a false negative', () => {
    const replay = {
      stableDetections: [{ midi: 60, timeMs: 120, clarity: 0.8, centsOffset: 2 }],
      frames: [{ timeMs: 80, midi: 60, clarity: 0.8, centsOffset: 2 }],
    }
    const evaluation = evaluateLabeledClip(
      { id: 'e4-target', label: 'note', expectedMidi: 64 },
      replay,
      { centsTolerance: settings.micCentsTolerance },
    )
    expect(evaluation.hit).toBe(false)
    expect(evaluation.falseNegative).toBe(true)
  })
})
