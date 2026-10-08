#!/usr/bin/env node
/**
 * Stage-2 blind/hybrid comparison (S7/S9) — EXPERIMENTAL, offline only.
 *
 * Compares on the SAME synthetic clips:
 *   V1 monophonic  ·  V2 score-informed  ·  blind prototype  ·  hybrid
 *
 * Source-class honesty: every clip below is deterministic synthesis.
 * Natural instrument recordings: 0. These numbers establish proxy behavior
 * only and must NEVER be combined with (nonexistent) real-recording results.
 *
 * Usage:
 *   npm run mic:stage2-compare
 *   node scripts/mic-stage2-comparison.mjs [--json tmp/mic-stage2-comparison/report.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { replayPolyphonyClip } from '../src/features/microphone-input/micPolyphonyReplayHarness.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'
import {
  detectBlindPolyphony,
  replayBlindPolyphonySamples,
} from '../src/features/microphone-input/v2/blindPolyphonicDetector.js'
import { confirmBlindCandidates } from '../src/features/microphone-input/micHybridConfirmation.js'
import {
  renderSyntheticChordClip,
} from '../src/features/microphone-input/micSyntheticChordClips.js'
import {
  synthSilence,
  synthSpeech,
  synthWhiteNoise,
} from '../src/features/microphone-input/micSyntheticClips.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SAMPLE_RATE = 44100

const CLIPS = [
  { id: 'triad-ceg', kind: 'chord', played: [60, 64, 67], expected: [60, 64, 67], render: () => renderSyntheticChordClip({ type: 'chord-simultaneous', midis: [60, 64, 67], seconds: 1.8 }, SAMPLE_RATE) },
  { id: 'dyad-ce', kind: 'chord', played: [60, 64], expected: [60, 64], render: () => renderSyntheticChordClip({ type: 'chord-simultaneous', midis: [60, 64], seconds: 1.6 }, SAMPLE_RATE) },
  { id: 'tetrad-g7', kind: 'chord', played: [55, 59, 62, 65], expected: [55, 59, 62, 65], render: () => renderSyntheticChordClip({ type: 'chord-simultaneous', midis: [55, 59, 62, 65], seconds: 1.8 }, SAMPLE_RATE) },
  { id: 'rolled-c', kind: 'chord', played: [60, 64, 67], expected: [60, 64, 67], render: () => renderSyntheticChordClip({ type: 'chord-rolled', midis: [60, 64, 67], seconds: 2, staggerMs: 80 }, SAMPLE_RATE) },
  { id: 'elec-dyad-clean', kind: 'chord', played: [45, 52], expected: [45, 52], render: () => renderSyntheticChordClip({ type: 'chord-electric', midis: [45, 52], mode: 'clean', seconds: 1.7 }, SAMPLE_RATE) },
  { id: 'elec-power-dist', kind: 'chord', played: [40, 47], expected: [40, 47], render: () => renderSyntheticChordClip({ type: 'chord-electric', midis: [40, 47], mode: 'distorted', seconds: 1.7 }, SAMPLE_RATE) },
  { id: 'wrong-dfa-vs-ceg', kind: 'wrong-chord', played: [62, 65, 69], expected: [60, 64, 67], render: () => renderSyntheticChordClip({ type: 'chord-simultaneous', midis: [62, 65, 69], seconds: 1.8 }, SAMPLE_RATE) },
  { id: 'silence', kind: 'control', played: [], expected: [], render: () => synthSilence(SAMPLE_RATE, 0.8) },
  { id: 'noise', kind: 'control', played: [], expected: [], render: () => synthWhiteNoise(SAMPLE_RATE, 0.8, 7) },
  { id: 'speech', kind: 'control', played: [], expected: [57], render: () => synthSpeech(SAMPLE_RATE, 1.6, { f0: 220, seed: 17, driftSemitones: 2.4 }) },
]

function toneScores(detected, played) {
  const detectedSet = new Set(detected)
  const playedSet = new Set(played)
  const hits = [...playedSet].filter((midi) => detectedSet.has(midi)).length
  const extras = [...detectedSet].filter((midi) => !playedSet.has(midi)).length
  return {
    recall: playedSet.size ? hits / playedSet.size : null,
    precision: detectedSet.size ? (detectedSet.size - extras) / detectedSet.size : (playedSet.size === 0 ? 1 : null),
    exact: detectedSet.size === playedSet.size && hits === playedSet.size,
  }
}

function timed(fn) {
  const start = performance.now()
  const value = fn()
  return { value, ms: performance.now() - start }
}

const rows = []
for (const clip of CLIPS) {
  const samples = clip.render()

  // V1 monophonic baseline.
  const v1 = timed(() => replayPolyphonyClip(samples, SAMPLE_RATE, {}))
  const v1Midis = [...new Set(
    (v1.value.stableDetections ?? []).map((detection) => detection.midi).filter((midi) => midi != null),
  )]

  // V2 score-informed (expected = score truth by design).
  const v2 = timed(() => replayScoreInformedPolyphonyClip(samples, SAMPLE_RATE, {
    expectedMidis: clip.expected,
  }))
  const v2Midis = v2.value.frames.length
    ? [...new Set(v2.value.frames.flatMap((frame) => frame.detectedMidis ?? []))]
    : []
  const v2Award = clip.kind === 'wrong-chord'
    ? (v2.value.stableDetections ?? []).map((detection) => detection.midi)
    : null

  // Blind prototype (no expected input at all).
  const blind = timed(() => replayBlindPolyphonySamples(samples, SAMPLE_RATE, {}))

  // Hybrid: blind candidates on several windows across the clip (mirroring
  // the live multi-frame confirm philosophy), confirmed vs expected.
  const hybrid = timed(() => {
    const positions = [0.1, 0.3, 0.5, 0.7, 0.9]
    const confirmedUnion = new Map()
    const unexpectedUnion = new Set()
    for (const position of positions) {
      const center = Math.floor(samples.length * position)
      const window = samples.subarray(Math.max(0, center - 1024), center + 1024)
      const detected = detectBlindPolyphony(window, SAMPLE_RATE, {})
      const verdict = confirmBlindCandidates(
        detected.candidates.filter((candidate) => candidate.detected),
        clip.expected,
      )
      for (const midi of verdict.confirmedMidis) {
        if (!confirmedUnion.has(midi)) {
          confirmedUnion.set(midi, verdict.evidence[midi])
        }
      }
      for (const midi of verdict.unexpectedMidis) {
        unexpectedUnion.add(midi)
      }
    }
    const confirmedMidis = [...confirmedUnion.keys()].sort((a, b) => a - b)
    const missingMidis = clip.expected.filter((midi) => !confirmedUnion.has(midi))
    return {
      confirmedMidis,
      missingMidis,
      unexpectedMidis: [...unexpectedUnion].sort((a, b) => a - b),
      complete: clip.expected.length > 0 && missingMidis.length === 0,
      evidence: Object.fromEntries(confirmedUnion),
    }
  })

  const v1Scores = toneScores(v1Midis, clip.played)
  const v2Scores = toneScores(v2Midis, clip.expected.length ? clip.expected : clip.played)
  const blindScores = toneScores(blind.value.stableMidis, clip.played)
  const hybridScores = toneScores(hybrid.value.confirmedMidis, clip.expected.length ? clip.expected : clip.played)

  rows.push({
    clip: clip.id,
    kind: clip.kind,
    played: clip.played,
    expected: clip.expected,
    v1: { detected: v1Midis, ...v1Scores, ms: Math.round(v1.ms * 10) / 10 },
    v2: { detected: v2Midis, ...v2Scores, ms: Math.round(v2.ms * 10) / 10, awardOnWrong: v2Award },
    blind: { detected: blind.value.stableMidis, ...blindScores, ms: Math.round(blind.ms * 10) / 10 },
    hybrid: {
      confirmed: hybrid.value.confirmedMidis,
      missing: hybrid.value.missingMidis,
      unexpected: hybrid.value.unexpectedMidis,
      complete: hybrid.value.complete,
      ...hybridScores,
      ms: Math.round(hybrid.ms * 10) / 10,
    },
  })
}

function summarize(rows, engine) {
  const musical = rows.filter((row) => row.kind === 'chord')
  const exact = musical.filter((row) => row[engine].exact).length
  const recalls = musical.map((row) => row[engine].recall ?? 0)
  const controls = rows.filter((row) => row.kind === 'control')
  const controlClean = controls.filter((row) => (row[engine].detected ?? row[engine].confirmed ?? []).length === 0).length
  const wrong = rows.find((row) => row.kind === 'wrong-chord')
  const setsEqual = (left, right) =>
    left.length === right.length && left.every((midi) => right.includes(midi))
  // "Awarded" means the engine claimed the EXPECTED chord while something
  // else was played. The blind prototype has no award path by design — it
  // can only report what it heard (reportedAsPlayed=true is CORRECT there).
  const wrongChordAwarded =
    engine === 'v2'
      ? setsEqual([...(wrong.v2.awardOnWrong ?? [])].sort((a, b) => a - b), [...wrong.expected].sort((a, b) => a - b))
      : engine === 'hybrid'
        ? wrong.hybrid.complete
        : engine === 'blind'
          ? false
          : wrong[engine].exact
  const wrongChordHeard = engine === 'blind' ? wrong.blind.exact : undefined
  return {
    chordExact: `${exact}/${musical.length}`,
    meanToneRecall: Math.round((recalls.reduce((a, b) => a + b, 0) / Math.max(1, recalls.length)) * 100) / 100,
    controlsClean: `${controlClean}/${controls.length}`,
    wrongChordAwarded: Boolean(wrongChordAwarded),
    ...(wrongChordHeard !== undefined ? { wrongChordReportedAsPlayed: wrongChordHeard } : {}),
  }
}

const summary = {
  engine: 'stage2-comparison-v1',
  sourceClass: 'deterministic-synthesis-only',
  naturalRecordings: 0,
  warning: 'Proxy behavior only. Do not combine with real-recording results.',
  engines: {
    v1Monophonic: summarize(rows, 'v1'),
    v2ScoreInformed: summarize(rows, 'v2'),
    blindPrototype: summarize(rows, 'blind'),
    hybrid: summarize(rows, 'hybrid'),
  },
  rows,
}

console.log('# Stage-2 comparison (SYNTHETIC ONLY — 0 natural recordings)\n')
for (const row of rows) {
  console.log(`## ${row.clip} [${row.kind}] played=[${row.played}] expected=[${row.expected}]`)
  console.log(`  V1    detected=[${row.v1.detected}] exact=${row.v1.exact} recall=${row.v1.recall} ${row.v1.ms}ms`)
  console.log(`  V2    detected=[${row.v2.detected}] exact=${row.v2.exact} recall=${row.v2.recall} ${row.v2.ms}ms`)
  console.log(`  blind detected=[${row.blind.detected}] exact=${row.blind.exact} recall=${row.blind.recall} ${row.blind.ms}ms`)
  console.log(`  hybrid confirmed=[${row.hybrid.confirmed}] missing=[${row.hybrid.missing}] unexpected=[${row.hybrid.unexpected}] complete=${row.hybrid.complete} ${row.hybrid.ms}ms`)
}
console.log('\n# Summary')
console.log(JSON.stringify(summary.engines, null, 2))

const args = process.argv.slice(2)
const jsonIndex = args.indexOf('--json')
if (jsonIndex !== -1 && args[jsonIndex + 1]) {
  const outPath = join(ROOT, args[jsonIndex + 1])
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.log(`\nWrote ${outPath}`)
}
