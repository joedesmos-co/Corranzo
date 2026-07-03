#!/usr/bin/env node
/**
 * Offline mic accuracy replay — measures pitch detection before tuning.
 *
 * Usage:
 *   npm run mic:accuracy-replay
 *   node scripts/mic-accuracy-replay.mjs --manifest benchmarks/mic-accuracy/manifest.json
 *   node scripts/mic-accuracy-replay.mjs --json tmp/mic-accuracy-replay/report.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMicAccuracyManifest, resolveMicAccuracyClipAudio, sliceClipSamples } from '../src/features/microphone-input/micAccuracyManifest.js'
import { replayMicClip } from '../src/features/microphone-input/micReplayHarness.js'
import {
  evaluateLabeledClip,
  formatMicAccuracyReportMarkdown,
  summarizeMicAccuracy,
} from '../src/features/microphone-input/micAccuracyReport.js'
import { renderSyntheticClip } from '../src/features/microphone-input/micSyntheticClips.js'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIC_CENTS_TOLERANCE = normalizeMatchSettings({}).micCentsTolerance

function argValue(args, flag) {
  const index = args.indexOf(flag)
  if (index === -1) {
    return null
  }
  return args[index + 1] ?? null
}

function loadClipSamples(clip, manifest, defaultSampleRate) {
  const resolved = resolveMicAccuracyClipAudio(clip, manifest, defaultSampleRate)
  if (resolved.missingFile) {
    return resolved
  }
  if (resolved.source === 'synthetic' || clip.synthetic) {
    return {
      ...resolved,
      samples: renderSyntheticClip(clip.synthetic, resolved.sampleRate),
    }
  }
  const wav = readWavPcm(resolved.filePath)
  const sliced = sliceClipSamples(wav.samples, wav.sampleRate, {
    startMs: clip.startMs,
    endMs: clip.endMs,
  })
  return {
    ...resolved,
    samples: sliced,
    sampleRate: wav.sampleRate,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const manifestPath =
    argValue(args, '--manifest') ?? join(ROOT, 'benchmarks/mic-accuracy/manifest.json')
  const jsonOut =
    argValue(args, '--json') ?? join(ROOT, 'tmp/mic-accuracy-replay/report.json')
  const mdOut =
    argValue(args, '--md') ?? join(ROOT, 'tmp/mic-accuracy-replay/report.md')

  const manifest = loadMicAccuracyManifest(manifestPath)
  const defaultSampleRate = manifest.defaultSampleRate ?? 44100
  const evaluations = []

  for (const clip of manifest.clips) {
    const audio = loadClipSamples(clip, manifest, defaultSampleRate)
    if (audio.missingFile) {
      evaluations.push(
        evaluateLabeledClip(
          { ...clip, missingFile: true },
          { stableDetections: [], frames: [] },
        ),
      )
      console.error(`Skipping missing file: ${clip.id}`)
      continue
    }

    const replay = replayMicClip(audio.samples, audio.sampleRate, {
      centsTolerance: MIC_CENTS_TOLERANCE,
    })
    evaluations.push(
      evaluateLabeledClip(clip, replay, { centsTolerance: MIC_CENTS_TOLERANCE }),
    )
    console.error(`Replayed: ${clip.id} (${clip.label})`)
  }

  const summary = summarizeMicAccuracy(evaluations)
  const payload = {
    generatedAt: new Date().toISOString(),
    manifest: manifestPath,
    constantsTuned: true,
    tuningNotes: [
      'pitchDetection MIN_CORRELATION 0.012 → 0.011 (real WAV autocorrelation cliff)',
      'micFrameAnalysis: pitch on raw buffer; high-pass for gate only',
      'micFrameAnalysis default centsTolerance 35 (matches WFY match settings)',
      'micReplayHarness: longer calibration prelude with room dither',
    ],
    summary,
  }

  mkdirSync(dirname(resolve(jsonOut)), { recursive: true })
  writeFileSync(jsonOut, JSON.stringify(payload, null, 2))
  writeFileSync(mdOut, formatMicAccuracyReportMarkdown(summary))

  console.log(formatMicAccuracyReportMarkdown(summary))
  console.error(`Wrote ${jsonOut}`)
  console.error(`Wrote ${mdOut}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
