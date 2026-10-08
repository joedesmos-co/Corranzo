#!/usr/bin/env node
/**
 * Real-audio benchmark runner — V1 / V2 / blind / hybrid / V3-live-gate on
 * the SAME verified excerpts (benchmarks/mic-real/manifest.json).
 *
 * Truth comes ONLY from independent dataset annotations. Detector output is
 * never used as truth. Wrong-chord variants transpose the EXPECTED set to
 * pitches absent from the excerpt truth; any award is a manufacture failure.
 *
 * Usage:
 *   node scripts/mic-realbench-run.mjs [--json tmp/mic-realbench/report.json] [--only <id-substring>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { replayPolyphonyClip } from '../src/features/microphone-input/micPolyphonyReplayHarness.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'
import {
  detectBlindPolyphony,
  replayBlindPolyphonyEvents,
  replayBlindPolyphonySamples,
} from '../src/features/microphone-input/v2/blindPolyphonicDetector.js'
import { confirmBlindCandidates } from '../src/features/microphone-input/micHybridConfirmation.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import { createMicFrameAnalyzer } from '../src/features/microphone-input/micFrameAnalysis.js'
import { getMicInstrumentProfile } from '../src/features/microphone-input/micInstrumentProfiles.js'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  markMicAttackConsumed,
  updateMicAttackRelease,
} from '../src/features/practice/micAttackLatch.js'
import { isMusicalMicFrame } from '../src/features/practice/micMusicalAcceptance.js'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  frameConfidentForMatch,
  frameCorroboratesSingleNote,
  resetMatchConfirmState,
} from '../src/features/practice/micMatchConfirm.js'
import {
  createChordToneAccumulator,
  pushChordToneFrame,
} from '../src/features/practice/micChordToneAccumulator.js'
import {
  evaluateMicScoreInformedInput,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const settings = normalizeMatchSettings({})
const FFT = 2048
const HOP = Math.round(44100 / 60)

const INSTRUMENT_PROFILE = {
  'piano': 'piano',
  'acoustic-guitar': 'guitar',
  'electric-guitar': 'guitar',
}

function timed(fn) {
  const start = performance.now()
  const value = fn()
  return { value, ms: performance.now() - start }
}

function uniqueSorted(values) {
  return [...new Set(values.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b)
}

/** First-detection time per midi from timestamped detections. */
function firstDetections(frames) {
  const first = new Map()
  for (const frame of frames) {
    for (const midi of frame.detectedMidis ?? []) {
      if (!first.has(midi)) {
        first.set(midi, frame.timeMs / 1000)
      }
    }
  }
  return first
}

/**
 * First time per midi with support in 2 adjacent frames (blip-resistant).
 * Single-frame spectral ghosts never count as "heard" here.
 */
function firstSustainedDetections(frames) {
  const first = new Map()
  let previous = new Set()
  for (const frame of frames) {
    const current = new Set(frame.detectedMidis ?? [])
    for (const midi of current) {
      if (!first.has(midi) && previous.has(midi)) {
        first.set(midi, frame.timeMs / 1000)
      }
    }
    previous = current
  }
  return first
}

function runV1(samples, sampleRate) {
  const replay = replayPolyphonyClip(samples, sampleRate, {})
  const stable = uniqueSorted((replay.stableDetections ?? []).map((d) => d.midi))
  const frames = (replay.frames ?? []).map((f) => ({
    timeMs: f.timeMs,
    detectedMidis: f.midi != null ? [f.midi] : [],
  }))
  return { stable, frames }
}

function runV2(samples, sampleRate, expectedMidis) {
  const replay = replayScoreInformedPolyphonyClip(samples, sampleRate, { expectedMidis })
  const stable = uniqueSorted((replay.stableDetections ?? []).map((d) => d.midi))
  const frames = (replay.frames ?? []).map((f) => ({
    timeMs: f.timeMs,
    detectedMidis: f.detectedMidis ?? [],
  }))
  return { stable, frames }
}

function runBlind(samples, sampleRate) {
  const replay = replayBlindPolyphonySamples(samples, sampleRate, {})
  return { stable: replay.stableMidis, frames: replay.frames }
}

/**
 * Strum-aware blind leg (Stage 4 P1): sustained near-attack detections.
 *
 * A tone counts when it is heard in ≥2 adjacent frames with first sustain
 * inside [anchor-0.3, anchor+1.0] (attack + slowest measured strum spread +
 * sustain emergence, excluding later beats). Single-frame transient ghosts
 * never qualify; vote-counting's 20%-of-clip rule (which drops short
 * notes and staggered strings) is gone. Chord-group structure rides along
 * for onset/canonical output; the anchor group type is reported. Silence
 * must produce no groups at all.
 */
function runBlindGrouped(samples, sampleRate, anchorOnset, anchorTones = [], blind = null) {
  // Retention path scores exhaustively (masked fundamentals are not
  // spectrum peaks); the vote-counted stable leg stays peak-pruned as the
  // conservative baseline. Stage-4 experiment 2026-10-07 (lowered family
  // bars 1.15/0.2) REVERTED: masked piano ratios overlap the FP
  // distribution, so lowering the bar added FPs without recall — the
  // ratio bar is load-bearing. Piano dense harmony is at the spectral
  // ceiling (see Stage-4 report); guards stay at production values.
  blind ??= replayBlindPolyphonyEvents(samples, sampleRate, { exhaustive: true })
  if (anchorOnset == null) {
    const detected = new Set()
    for (const group of blind.groups) {
      for (const note of group.notes) {
        detected.add(note.midi)
      }
    }
    return {
      detected: [...detected].sort((a, b) => a - b),
      first: new Map(),
      groupCount: blind.groups.length,
      groups: blind.groups,
      frames: blind.frames,
    }
  }
  const lo = anchorOnset - 0.3
  const hi = anchorOnset + 1.0
  const sustained = firstSustainedDetections(blind.frames)
  const firstAll = firstDetections(blind.frames)
  // Retention operating point: any tone sustained ≥2 adjacent frames with
  // first sustain inside the attack window (attack + slow strums +
  // sustain emergence, excluding later beats).
  const detected = new Set()
  const first = new Map()
  for (const [midi, timeSeconds] of sustained) {
    if (timeSeconds < lo || timeSeconds > hi) {
      continue
    }
    detected.add(midi)
    first.set(midi, firstAll.get(midi) ?? timeSeconds)
  }
  const inWindow = blind.groups.filter((group) => {
    const onsetSeconds = group.groupOnsetMs / 1000
    return onsetSeconds >= lo && onsetSeconds <= hi
  })
  const anchorSet = new Set(anchorTones)
  const anchorGroup = inWindow.find((group) => group.notes.some((note) => anchorSet.has(note.midi)))
    ?? inWindow[0]
    ?? null
  return {
    detected: [...detected].sort((a, b) => a - b),
    first,
    groupCount: blind.groups.length,
    groups: blind.groups,
    anchorGroupType: anchorGroup?.type ?? null,
    anchorGroupMidis: anchorGroup?.midis ?? [],
    frames: blind.frames,
  }
}

/**
 * Hybrid-from-groups (Stage 4 P1+P4): onset-anchored group tones with
 * max-confidence become the confirmation candidates. Same anti-manufacture
 * contract as windowed hybrid — expected tones confirm only on blind
 * evidence — but candidates carry attack structure instead of arbitrary
 * window slices.
 */
function runHybridGrouped(blindReplay, expectedMidis, anchorOnset) {
  const lo = anchorOnset != null ? anchorOnset - 0.3 : -Infinity
  const hi = anchorOnset != null ? anchorOnset + 1.0 : Infinity
  const pool = []
  for (const group of blindReplay.groups ?? []) {
    const onsetSeconds = group.groupOnsetMs / 1000
    if (onsetSeconds < lo || onsetSeconds > hi) {
      continue
    }
    for (const note of group.notes) {
      pool.push({
        midi: note.midi,
        midiFloat: note.midi,
        confidence: note.maxConfidence ?? note.confidence ?? 0,
        detected: true,
      })
    }
  }
  return confirmBlindCandidates(pool, expectedMidis)
}

function runHybrid(samples, sampleRate, expectedMidis) {  const positions = [0.15, 0.3, 0.5, 0.7, 0.85]
  const confirmed = new Map()
  const unexpected = new Set()
  for (const position of positions) {
    const center = Math.floor(samples.length * position)
    const window = samples.subarray(Math.max(0, center - 1024), center + 1024)
    const detected = detectBlindPolyphony(window, sampleRate, {})
    const verdict = confirmBlindCandidates(
      detected.candidates.filter((c) => c.detected),
      expectedMidis,
    )
    for (const midi of verdict.confirmedMidis) {
      if (!confirmed.has(midi)) {
        confirmed.set(midi, center / sampleRate)
      }
    }
    for (const midi of verdict.unexpectedMidis) {
      unexpected.add(midi)
    }
  }
  const confirmedMidis = [...confirmed.keys()].sort((a, b) => a - b)
  return {
    confirmedMidis,
    missingMidis: expectedMidis.filter((m) => !confirmed.has(m)),
    unexpectedMidis: [...unexpected].sort((a, b) => a - b),
    complete: expectedMidis.length > 0 && expectedMidis.every((m) => confirmed.has(m)),
    firstMap: confirmed,
  }
}

/** V3 + chord-tone accumulation (Stage 4 P2, experimental, unwired). */
function runV3AccumGate(samples, sampleRate, expectedMidis, instrument, corroboratedMidis = null) {
  const v2State = createMicEngineV2RuntimeState()
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile(INSTRUMENT_PROFILE[instrument] ?? null)
  const accum = createChordToneAccumulator({ expectedMidis })
  // Hit bar (measured Stage 4): V2 detection + gate open + blind-region
  // membership. Deliberately NOT musical-per-hit and NOT local-dominance:
  // both starved true accumulation while adding nothing over the region
  // gate. Manufacture safety comes from the region gate alone (score-free
  // blind evidence) — the same contract as hybrid confirmation. The
  // per-hit bar stays at production's audibility floor (gate open).
  const corroboratedSet = corroboratedMidis == null ? null : new Set(corroboratedMidis)
  let advances = 0
  let advanceAt = null
  const matched = new Set()

  for (let end = FFT; end <= samples.length; end += HOP) {
    const timeMs = (end / sampleRate) * 1000
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FFT, end)),
      sampleRate,
      expectedMidis,
      noiseFloor: analyzer.noiseFloor,
      state: v2State,
      centsTolerance: settings.micCentsTolerance,
      gateOptions: profile?.gate ?? null,
      timeMs,
    })
    const frame = tick.frame
    if (!frame) {
      continue
    }
    const byMidi = new Map((frame.v2Notes ?? []).map((note) => [note.midi, note]))
    const verdict = pushChordToneFrame(accum, {
      timeMs,
      tones: (frame.v2DetectedMidis ?? [])
        .filter((midi) => expectedMidis.includes(midi))
        .filter((midi) => corroboratedSet == null || corroboratedSet.has(midi))
        .map((midi) => ({ midi, confidence: byMidi.get(midi)?.confidence ?? 0 })),
      musical: Boolean(frame.gateOpen),
    })
    if (verdict.completed && advances === 0) {
      advances = 1
      advanceAt = timeMs / 1000
      for (const midi of verdict.matchedMidis) {
        matched.add(midi)
      }
    }
  }
  return { advances, advanceAt, matched: [...matched].sort((a, b) => a - b) }
}

/** V3 production decision path (V2 tick + latch + musical + confirm + eval). */
function runV3LiveGate(samples, sampleRate, expectedMidis, instrument) {
  const v2State = createMicEngineV2RuntimeState()
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile(INSTRUMENT_PROFILE[instrument] ?? null)
  const confirm = createMatchConfirmState()
  const latch = createMicAttackLatchState()
  const checkpoint = { id: 'realbench', expectedMidis }
  let advances = 0
  let advanceAt = null
  const matched = new Set()
  const toneFirst = new Map()
  const v2Hits = new Set()
  const gate = { raw: 0, soft: 0, musical: 0, v2frames: 0, total: 0 }

  for (let end = FFT; end <= samples.length; end += HOP) {
    const timeMs = (end / sampleRate) * 1000
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FFT, end)),
      sampleRate,
      expectedMidis,
      noiseFloor: analyzer.noiseFloor,
      state: v2State,
      centsTolerance: settings.micCentsTolerance,
      gateOptions: profile?.gate ?? null,
      timeMs,
    })
    const frame = tick.frame
    if (!frame) {
      continue
    }
    gate.total += 1
    if (frame.rawGateOpen) gate.raw += 1
    if (frame.softGateOpen) gate.soft += 1
    if (isMusicalMicFrame(frame)) gate.musical += 1
    for (const midi of frame.v2DetectedMidis ?? []) {
      if (expectedMidis.includes(midi)) {
        v2Hits.add(midi)
        if (!toneFirst.has(midi)) {
          toneFirst.set(midi, timeMs / 1000)
        }
      }
    }
    if (frame.v2DetectedMidis?.length) gate.v2frames += 1

    updateMicAttackRelease(latch, Boolean(frame.gateOpen))
    if (!canAcceptMicAttackMatch(latch)) {
      resetMatchConfirmState(confirm)
      continue
    }
    if (!frame.gateOpen || !frame.v2DetectedMidis?.length) {
      resetMatchConfirmState(confirm)
      continue
    }
    const preview = evaluateMicScoreInformedInput(checkpoint, frame.v2DetectedMidis, settings)
    if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
      resetMatchConfirmState(confirm)
      continue
    }
    const frameConfident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
    const key = `realbench:${[...frame.v2DetectedMidis].sort((a, b) => a - b).join(',')}`
    let corroborated = true
    if (expectedMidis.length === 1) {
      corroborated = frameCorroboratesSingleNote(frame, expectedMidis[0], {
        centsTolerance: settings.micCentsTolerance,
      })
    }
    if (confirmConfidentMatch(confirm, key, frameConfident && corroborated, {
      pitchCents: frame.midiFloat != null ? frame.midiFloat * 100 : null,
    })) {
      resetMatchConfirmState(confirm)
      markMicAttackConsumed(latch)
      advances += 1
      if (advanceAt == null) advanceAt = timeMs / 1000
      for (const midi of preview.detectedMidis ?? []) {
        matched.add(midi)
      }
    }
  }
  return { advances, advanceAt, matched: [...matched].sort((a, b) => a - b), v2Hits: [...v2Hits], toneFirst, gate }
}

/** Transposed expectation avoiding all excerpt truth (else skip variant). */
function wrongExpectation(anchorTones, truthMidis) {
  const truth = new Set(truthMidis)
  for (const delta of [1, 3, -2, 5, -4]) {
    const shifted = anchorTones.map((m) => m + delta)
    if (shifted.every((m) => m >= 21 && m <= 108) && shifted.every((m) => !truth.has(m))) {
      return { expected: shifted, delta }
    }
  }
  return null
}

function scoreDetections(detected, firstMap, excerpt, sustainedMap = null) {
  const anchor = new Set(excerpt.truth.anchorTones)
  const truth = new Set(excerpt.truth.notes.map((n) => n.midi))
  const det = new Set(detected)
  const anchorHit = [...anchor].filter((m) => det.has(m)).length
  const truthHit = [...truth].filter((m) => det.has(m)).length
  const fp = [...det].filter((m) => !truth.has(m))
  const onsetErrors = []
  for (const midi of anchor) {
    const t = firstMap.get(midi)
    if (t != null) {
      onsetErrors.push(t - excerpt.truth.anchorOnset)
    }
  }
  const sustainedHeard = sustainedMap
    ? [...anchor].filter((m) => sustainedMap.has(m)).length
    : null
  return {
    anchorRecall: anchor.size ? anchorHit / anchor.size : null,
    anchorHeardRecall: anchor.size && sustainedHeard != null ? sustainedHeard / anchor.size : null,
    excerptRecall: truth.size ? truthHit / truth.size : (det.size === 0 ? 1 : null),
    excerptPrecision: det.size ? (det.size - fp.length) / det.size : 1,
    exact: det.size === truth.size && truthHit === truth.size,
    missed: [...truth].filter((m) => !det.has(m)),
    fp,
    meanOnsetError: onsetErrors.length
      ? onsetErrors.reduce((a, b) => a + b, 0) / onsetErrors.length
      : null,
  }
}

function main() {
  const args = process.argv.slice(2)
  const startMemory = process.memoryUsage()
  const onlyIndex = args.indexOf('--only')
  const only = onlyIndex !== -1 ? args[onlyIndex + 1] : null
  const splitIndex = args.indexOf('--split')
  const split = splitIndex !== -1 ? args[splitIndex + 1] : 'all'
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks', 'mic-real', 'manifest.json'), 'utf8'))
  const rows = []

  for (const clip of manifest.clips) {
    if (only && !clip.id.includes(only)) {
      continue
    }
    if (split !== 'all' && (clip.split ?? 'dev') !== split) {
      continue
    }
    const wav = readWavPcm(join(ROOT, 'benchmarks', 'mic-real', clip.audio.file))
    const samples = wav.samples
    const sampleRate = wav.sampleRate
    const truthMidis = uniqueSorted(clip.truth.notes.map((n) => n.midi))
    const row = { id: clip.id, instrument: clip.instrument, category: clip.category, split: clip.split ?? 'dev', anchorTones: clip.truth.anchorTones, truthMidis }

    const v1 = timed(() => runV1(samples, sampleRate))
    row.v1 = { detected: v1.value.stable, ...scoreDetections(v1.value.stable, firstDetections(v1.value.frames), clip, firstSustainedDetections(v1.value.frames)), ms: Math.round(v1.ms) }

    const v2 = timed(() => runV2(samples, sampleRate, clip.truth.anchorTones))
    row.v2 = { detected: v2.value.stable, ...scoreDetections(v2.value.stable, firstDetections(v2.value.frames), clip, firstSustainedDetections(v2.value.frames)), ms: Math.round(v2.ms) }

    const blind = timed(() => runBlind(samples, sampleRate))
    row.blind = { detected: blind.value.stable, ...scoreDetections(blind.value.stable, firstDetections(blind.value.frames), clip, firstSustainedDetections(blind.value.frames)), ms: Math.round(blind.ms) }

    const grouped = timed(() => runBlindGrouped(samples, sampleRate, clip.truth.anchorOnset, clip.truth.anchorTones))
    // Shared group replay feeds the hybrid-from-groups leg (one blind
    // pass per clip, not two).
    const blindReplay = {
      groups: grouped.value.groups ?? [],
      frames: grouped.value.frames ?? [],
    }
    row.grouped = {
      detected: grouped.value.detected,
      groupCount: grouped.value.groupCount,
      ...scoreDetections(grouped.value.detected, grouped.value.first, clip, grouped.value.first),
      ms: Math.round(grouped.ms),
    }

    const hybrid = timed(() => runHybrid(samples, sampleRate, clip.truth.anchorTones))
    const hybridFirst = hybrid.value.firstMap
    row.hybrid = {
      confirmed: hybrid.value.confirmedMidis,
      missing: hybrid.value.missingMidis,
      unexpected: hybrid.value.unexpectedMidis,
      complete: hybrid.value.complete,
      ...scoreDetections(hybrid.value.confirmedMidis, hybridFirst, clip),
      ms: Math.round(hybrid.ms),
    }
    delete row.hybrid.first

    const hybridG = timed(() => runHybridGrouped(blindReplay, clip.truth.anchorTones, clip.truth.anchorOnset))
    row.hybridGrouped = {
      confirmed: hybridG.value.confirmedMidis,
      missing: hybridG.value.missingMidis,
      unexpected: hybridG.value.unexpectedMidis,
      complete: hybridG.value.complete,
      ...scoreDetections(hybridG.value.confirmedMidis, new Map(), clip),
      ms: Math.round(hybridG.ms),
    }

    const v3 = timed(() => runV3LiveGate(samples, sampleRate, clip.truth.anchorTones, clip.instrument))
    row.v3 = {
      advances: v3.value.advances,
      advanceAt: v3.value.advanceAt != null ? Math.round(v3.value.advanceAt * 1000) / 1000 : null,
      matched: v3.value.matched,
      ...scoreDetections(v3.value.matched.length ? v3.value.matched : v3.value.v2Hits, v3.value.toneFirst, clip),
      onsetErrorAdvance: v3.value.advanceAt != null && clip.truth.anchorOnset != null
        ? Math.round((v3.value.advanceAt - clip.truth.anchorOnset) * 1000) / 1000
        : null,
      gate: v3.value.gate,
      ms: Math.round(v3.ms),
    }

    const v3accum = timed(() => runV3AccumGate(samples, sampleRate, clip.truth.anchorTones, clip.instrument, grouped.value.detected))
    row.v3accum = {
      advances: v3accum.value.advances,
      advanceAt: v3accum.value.advanceAt != null ? Math.round(v3accum.value.advanceAt * 1000) / 1000 : null,
      matched: v3accum.value.matched,
      ...scoreDetections(v3accum.value.matched, new Map(), clip),
      onsetErrorAdvance: v3accum.value.advanceAt != null && clip.truth.anchorOnset != null
        ? Math.round((v3accum.value.advanceAt - clip.truth.anchorOnset) * 1000) / 1000
        : null,
      ms: Math.round(v3accum.ms),
    }

    // Silence + expected control: the live path must never advance a
    // chord out of room tone, even when the score expects one.
    if (clip.category === 'pause') {
      const silenceExpected = [60, 64, 67]
      const v2s = runV2(samples, sampleRate, silenceExpected)
      const v3s = runV3LiveGate(samples, sampleRate, silenceExpected, clip.instrument)
      row.silenceWithExpected = {
        expected: silenceExpected,
        v2Stable: v2s.stable,
        v3Advances: v3s.advances,
      }
      console.log(`  silence+expected: V2stable=${JSON.stringify(v2s.stable)} V3adv=${v3s.advances}`)
    }

    // Wrong-chord variants (manufacture test).
    const wrong = wrongExpectation(clip.truth.anchorTones, truthMidis)
    if (wrong && clip.truth.anchorTones.length) {
      const v2w = runV2(samples, sampleRate, wrong.expected)
      const hybridW = runHybrid(samples, sampleRate, wrong.expected)
      const hybridGW = runHybridGrouped(blindReplay, wrong.expected, clip.truth.anchorOnset)
      const v3w = runV3LiveGate(samples, sampleRate, wrong.expected, clip.instrument)
      const v3aw = runV3AccumGate(samples, sampleRate, wrong.expected, clip.instrument, grouped.value.detected)
      row.wrong = {
        expected: wrong.expected,
        delta: wrong.delta,
        v2Award: wrong.expected.every((m) => v2w.stable.includes(m)),
        hybridAward: hybridW.complete,
        hybridGroupedAward: hybridGW.complete,
        v3Award: v3w.advances > 0,
        v3accumAward: v3aw.advances > 0,
        v3accumWrongMatched: v3aw.matched,
      }
    } else {
      row.wrong = { skipped: true }
    }

    console.log(`${clip.id} [${clip.category}] anchor=[${clip.truth.anchorTones}] ` +
      `V1=${JSON.stringify(row.v1.detected)} V2=${JSON.stringify(row.v2.detected)} ` +
      `blind=${JSON.stringify(row.blind.detected)} grouped=${JSON.stringify(row.grouped.detected)} ` +
      `hybrid=${JSON.stringify(row.hybrid.confirmed)} hybridG=${JSON.stringify(row.hybridGrouped.confirmed)} ` +
      `V3adv=${row.v3.advances} wrong=${row.wrong.skipped ? 'skip' : `V2:${row.wrong.v2Award} H:${row.wrong.hybridAward} HG:${row.wrong.hybridGroupedAward} V3:${row.wrong.v3Award}`}`)
    rows.push(row)
  }

  const byInstrument = {}
  for (const row of rows) {
    const bucket = byInstrument[`${row.split ?? 'dev'}:${row.instrument}`] ??= { clips: 0, engines: {} }
    bucket.clips += 1
    for (const engine of ['v1', 'v2', 'blind', 'grouped', 'hybrid', 'hybridGrouped', 'v3', 'v3accum']) {
      const cell = bucket.engines[engine] ??= { anchorHits: 0, anchorTotal: 0, heardHits: 0, heardTotal: 0, exact: 0, fp: 0, missed: 0, onsetErrs: [], ms: 0, awards: 0, wrongTests: 0 }
      const data = row[engine]
      const anchorCount = row.anchorTones.length
      if (data.anchorRecall != null) {
        cell.anchorHits += data.anchorRecall * anchorCount
        cell.anchorTotal += anchorCount
      }
      if (data.anchorHeardRecall != null) {
        cell.heardHits += data.anchorHeardRecall * anchorCount
        cell.heardTotal += anchorCount
      }
      if (data.exact) cell.exact += 1
      cell.fp += (data.fp ?? []).length
      cell.missed += (data.missed ?? []).length
      if (data.meanOnsetError != null) cell.onsetErrs.push(data.meanOnsetError)
      cell.ms += data.ms ?? 0
    }
    if (!row.wrong.skipped) {
      for (const [engine, key] of [['v2', 'v2Award'], ['hybrid', 'hybridAward'], ['hybridGrouped', 'hybridGroupedAward'], ['v3', 'v3Award'], ['v3accum', 'v3accumAward']]) {
        byInstrument[`${row.split ?? 'dev'}:${row.instrument}`].engines[engine].wrongTests += 1
        if (row.wrong[key]) byInstrument[`${row.split ?? 'dev'}:${row.instrument}`].engines[engine].awards += 1
      }
    }
  }
  const summary = {}
  for (const [instrument, bucket] of Object.entries(byInstrument)) {
    summary[instrument] = { clips: bucket.clips, engines: {} }
    for (const [engine, cell] of Object.entries(bucket.engines)) {
      summary[instrument].engines[engine] = {
        anchorRecall: cell.anchorTotal ? Math.round((cell.anchorHits / cell.anchorTotal) * 100) / 100 : null,
        anchorHeardRecall: cell.heardTotal ? Math.round((cell.heardHits / cell.heardTotal) * 100) / 100 : null,
        exactRate: `${cell.exact}/${bucket.clips}`,
        totalFP: cell.fp,
        totalMissed: cell.missed,
        meanOnsetErrorS: cell.onsetErrs.length ? Math.round((cell.onsetErrs.reduce((a, b) => a + b, 0) / cell.onsetErrs.length) * 1000) / 1000 : null,
        meanMs: Math.round(cell.ms / bucket.clips),
        wrongAwards: cell.wrongTests ? `${cell.awards}/${cell.wrongTests}` : 'n/a',
      }
    }
  }
  console.log('\n# Per-instrument summary')
  console.log(JSON.stringify(summary, null, 2))
  const endMemory = process.memoryUsage()
  const megabytes = (bytes) => Math.round(bytes / 1048576)
  // Coarse process-level resource footprint (offline Node; browser heap
  // differs, but per-engine algorithmic costs — FFT + Goertzel passes per
  // window, no models, scratch buffers only — are the same shape).
  const resources = {
    heapUsedDeltaMB: megabytes(endMemory.heapUsed - startMemory.heapUsed),
    heapUsedMB: megabytes(endMemory.heapUsed),
    rssMB: megabytes(endMemory.rss),
  }
  console.log('\n# Resources')
  console.log(JSON.stringify(resources))

  const jsonIndex = args.indexOf('--json')
  if (jsonIndex !== -1 && args[jsonIndex + 1]) {
    const outPath = join(ROOT, args[jsonIndex + 1])
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify({ summary, rows, resources }, null, 2))
    console.log(`\nWrote ${outPath}`)
  }
}

main()
