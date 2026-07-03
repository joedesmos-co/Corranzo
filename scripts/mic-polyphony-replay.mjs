#!/usr/bin/env node
/**
 * Offline mic polyphony replay — V1 monophonic baseline + V2 score-informed prototype.
 *
 * Usage:
 *   npm run mic:polyphony-replay
 *   node scripts/mic-polyphony-replay.mjs --manifest benchmarks/mic-polyphony/manifest.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadMicPolyphonyManifest,
  resolveMicPolyphonyClipAudio,
  sliceClipSamples,
} from '../src/features/microphone-input/micPolyphonyManifest.js'
import { replayPolyphonyClip } from '../src/features/microphone-input/micPolyphonyReplayHarness.js'
import {
  compareMicPolyphonyEngines,
  compareV2Phase2Baseline,
  evaluatePolyphonyClip,
  formatMicPolyphonyComparisonMarkdown,
  summarizeMicPolyphony,
} from '../src/features/microphone-input/micPolyphonyReport.js'
import { renderSyntheticChordClip } from '../src/features/microphone-input/micSyntheticChordClips.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'
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
  const resolved = resolveMicPolyphonyClipAudio(clip, manifest, defaultSampleRate)
  if (resolved.missingFile) {
    return resolved
  }
  if (resolved.source === 'synthetic' || clip.synthetic) {
    return {
      ...resolved,
      samples: renderSyntheticChordClip(clip.synthetic, resolved.sampleRate),
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
    argValue(args, '--manifest') ?? join(ROOT, 'benchmarks/mic-polyphony/manifest.json')
  const jsonOut =
    argValue(args, '--json') ?? join(ROOT, 'tmp/mic-polyphony-replay/report.json')
  const mdOut = argValue(args, '--md') ?? join(ROOT, 'tmp/mic-polyphony-replay/report.md')

  const manifest = loadMicPolyphonyManifest(manifestPath)
  const defaultSampleRate = manifest.defaultSampleRate ?? 44100
  const v1Evaluations = []
  const v2Evaluations = []

  for (const clip of manifest.clips) {
    const audio = loadClipSamples(clip, manifest, defaultSampleRate)
    if (audio.missingFile) {
      const skipped = evaluatePolyphonyClip(
        { ...clip, missingFile: true },
        { stableDetections: [], frames: [] },
      )
      v1Evaluations.push(skipped)
      v2Evaluations.push(skipped)
      console.error(`Skipping missing file: ${clip.id}`)
      continue
    }

    const v1Replay = replayPolyphonyClip(audio.samples, audio.sampleRate, {
      centsTolerance: MIC_CENTS_TOLERANCE,
    })
    const v2Replay = replayScoreInformedPolyphonyClip(audio.samples, audio.sampleRate, {
      expectedMidis: clip.expectedMidis ?? [],
      chordType: clip.chordType ?? null,
      rollMs: clip.rollMs ?? null,
      expectedOnsetMs: clip.expectedOnsetMs ?? 0,
      centsTolerance: MIC_CENTS_TOLERANCE,
    })

    v1Evaluations.push(
      evaluatePolyphonyClip(clip, v1Replay, { centsTolerance: MIC_CENTS_TOLERANCE }),
    )
    v2Evaluations.push(
      evaluatePolyphonyClip(clip, v2Replay, { centsTolerance: MIC_CENTS_TOLERANCE }),
    )
    console.error(`Replayed: ${clip.id} (${clip.label}) — V1 + V2`)
  }

  const v1Summary = summarizeMicPolyphony(v1Evaluations, { engine: 'v1-monophonic-baseline' })
  const v2Summary = summarizeMicPolyphony(v2Evaluations, {
    engine: 'v2-score-informed-phase-2b',
    scorerVersion: 'phase-2b',
  })
  const comparison = compareMicPolyphonyEngines(v1Summary, v2Summary)
  const phase2bComparison = compareV2Phase2Baseline(v2Summary)

  const payload = {
    generatedAt: new Date().toISOString(),
    manifest: manifestPath,
    constantsTuned: false,
    runtimeMicChanged: false,
    v1: v1Summary,
    v2: v2Summary,
    comparison,
    phase2bComparison,
    summary: v2Summary,
    engine: v2Summary.engine,
  }

  mkdirSync(dirname(resolve(jsonOut)), { recursive: true })
  writeFileSync(jsonOut, JSON.stringify(payload, null, 2))
  const markdown = formatMicPolyphonyComparisonMarkdown(
    comparison,
    v1Summary,
    v2Summary,
    phase2bComparison,
  )
  writeFileSync(mdOut, markdown)

  console.log(markdown)
  console.error(`Wrote ${jsonOut}`)
  console.error(`Wrote ${mdOut}`)
  console.error(`Comparison verdict: ${comparison.verdict}`)
  console.error(`Phase 2B improved: ${phase2bComparison.improved ? 'yes' : 'no'}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
