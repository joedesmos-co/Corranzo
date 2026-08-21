#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadMicPolyphonyManifest,
  resolveMicPolyphonyClipAudio,
  sliceClipSamples,
} from '../src/features/microphone-input/micPolyphonyManifest.js'
import { renderSyntheticChordClip } from '../src/features/microphone-input/micSyntheticChordClips.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'
import {
  evaluateMicV3PerformanceClip,
  formatMicV3PerformanceMetricsMarkdown,
  summarizeMicV3PerformanceMetrics,
} from '../src/features/microphone-input/v3/performanceMetrics.js'
import {
  replayMicV3PerformanceSequence,
  summarizeMicV3PerformanceSequences,
} from '../src/features/microphone-input/v3/performanceSequenceReplay.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { readWavPcm } from './lib/readWavPcm.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CENTS_TOLERANCE = normalizeMatchSettings({}).micCentsTolerance

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1] ?? null
}

function loadClipSamples(clip, manifest, sampleRate) {
  const resolved = resolveMicPolyphonyClipAudio(clip, manifest, sampleRate)
  if (resolved.missingFile) return resolved
  if (resolved.source === 'synthetic' || clip.synthetic) {
    return {
      ...resolved,
      samples: renderSyntheticChordClip(clip.synthetic, resolved.sampleRate),
    }
  }
  const wav = readWavPcm(resolved.filePath)
  return {
    ...resolved,
    samples: sliceClipSamples(wav.samples, wav.sampleRate, {
      startMs: clip.startMs,
      endMs: clip.endMs,
    }),
    sampleRate: wav.sampleRate,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const manifestPath = argValue(args, '--manifest') ??
    join(ROOT, 'benchmarks/mic-polyphony/manifest.json')
  const jsonOut = argValue(args, '--json') ??
    join(ROOT, 'tmp/mic-v3-performance-replay/report.json')
  const mdOut = argValue(args, '--md') ??
    join(ROOT, 'tmp/mic-v3-performance-replay/report.md')
  const manifest = loadMicPolyphonyManifest(manifestPath)
  const sampleRate = manifest.defaultSampleRate ?? 44100
  const evaluations = []

  for (const clip of manifest.clips) {
    const audio = loadClipSamples(clip, manifest, sampleRate)
    if (audio.missingFile) {
      console.error(`Skipping missing file: ${clip.id}`)
      continue
    }
    const replay = replayScoreInformedPolyphonyClip(audio.samples, audio.sampleRate, {
      expectedMidis: clip.expectedMidis ?? [],
      chordType: clip.chordType ?? null,
      rollMs: clip.rollMs ?? null,
      expectedOnsetMs: clip.performanceOnsetMs ?? 0,
      centsTolerance: CENTS_TOLERANCE,
    })
    evaluations.push(evaluateMicV3PerformanceClip(clip, replay))
    console.error(`V3 replayed: ${clip.id}`)
  }

  const summary = summarizeMicV3PerformanceMetrics(evaluations)
  const sequenceManifestPath = argValue(args, '--sequence-manifest') ??
    join(ROOT, 'benchmarks/mic-performance-sequences/manifest.json')
  const sequenceManifest = JSON.parse(readFileSync(sequenceManifestPath, 'utf8'))
  const sequenceSummary = summarizeMicV3PerformanceSequences(
    sequenceManifest.scenarios.map(replayMicV3PerformanceSequence),
  )
  summary.ringingAudioFixtureSuccess = summary.ringingTransitionSuccess
  summary.ringingTransitionSuccess = sequenceSummary.ringingTransitionSuccess
  summary.sequenceReplay = sequenceSummary
  const payload = {
    generatedAt: new Date().toISOString(),
    manifest: manifestPath,
    sequenceManifest: sequenceManifestPath,
    constantsTuned: false,
    productionThresholdsChanged: false,
    summary,
  }
  const markdown = formatMicV3PerformanceMetricsMarkdown(summary)
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true })
  writeFileSync(jsonOut, JSON.stringify(payload, null, 2))
  writeFileSync(mdOut, markdown)
  console.log(markdown)
  console.error(`Wrote ${jsonOut}`)
  console.error(`Wrote ${mdOut}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
