#!/usr/bin/env node
/**
 * Neural corpus benchmark — REAL Basic Pitch model in real Chromium over
 * labeled real-audio clips (UIowa-derived + captured; see the benchmarks
 * mic-accuracy and mic-polyphony README files).
 *
 * Streams each clip through model windows (configurable window/hop +
 * onset/frame thresholds), then scores note-level precision/recall,
 * chord exact-match, false positives, and inference latency per
 * instrument. Disjoint by construction: tune on synth+real-*, report
 * uiowa-* as held-out evidence (never tune on uiowa).
 *
 * Usage:
 *   node scripts/benchmark-neural-corpus.mjs [--window 0.5] [--hop 0.25]
 *     [--onset 0.5] [--frame 0.3] [--min-note 5] [--split tune|heldout|all]
 *     [--json /tmp/neural-bench.json]
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleToModelRate, NEURAL_MODEL_RATE } from '../src/features/microphone-input/micNeuralTfAdapter.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const WINDOW = Number(arg('window', '0.5'))
const HOP = Number(arg('hop', '0.25'))
const ONSET = Number(arg('onset', '0.5'))
const FRAME = Number(arg('frame', '0.3'))
const MIN_NOTE = Number(arg('min-note', '5'))
const EDGE_MS = Number(arg('edge', '80'))
const SPLIT = arg('split', 'all')
const JSON_OUT = arg('json', null)
const SAVE_NOTES = arg('save-notes', null)

function loadManifest(name) {
  return JSON.parse(readFileSync(join(root, 'benchmarks', name, 'manifest.json'), 'utf8'))
}

const CORPUS = arg('corpus', 'legacy')

function collectClips() {
  if (CORPUS === 'mic-real') {
    return collectMicRealClips()
  }
  if (CORPUS === 'composites') {
    return collectCompositeClips()
  }
  const clips = []
  for (const [manifestName, kind] of [['mic-accuracy', 'single'], ['mic-polyphony', 'chord']]) {
    const manifest = loadManifest(manifestName)
    for (const clip of manifest.clips) {
      if (!clip.file || clip.file.endsWith('.wav') === false) {
        continue
      }
      if (clip.expectedMidi == null && clip.expectedMidis == null) {
        continue // silence/noise clips scored separately
      }
      const expected = clip.expectedMidis ?? [clip.expectedMidi]
      const id = clip.id
      const split = id.startsWith('uiowa-') ? 'heldout' : 'tune'
      if (SPLIT !== 'all' && split !== SPLIT) {
        continue
      }
      clips.push({ id, kind, file: join(root, 'benchmarks', manifestName, clip.file), instrument: clip.instrument ?? 'piano', expected, split })
    }
  }
  return clips
}

// Composites: real single-note recordings concatenated with exact
// construction truth (sample-measured onsets). For repeated-note and
// legato timing the natural corpus lacks.
function collectCompositeClips() {
  const manifest = loadManifest('mic-composites')
  return manifest.clips.map((clip) => ({
    id: clip.id,
    kind: 'composite',
    file: join(root, 'benchmarks', 'mic-composites', clip.audio.file),
    instrument: clip.instrument,
    expected: clip.truth.anchorTones,
    truthNotes: clip.truth.notes,
    split: 'dev',
  }))
}
// Clips in manifest.excluded are NEVER scored (annotation errors —
// re-adding one without re-verification corrupts every metric).
// mic-real: independent JAMS/MIDI annotations, dev/eval/eval-fresh splits.
// expected[] = anchor tones (WFY-style); truthNotes = full note list (M14).
function collectMicRealClips() {
  const manifest = loadManifest('mic-real')
  const excluded = new Set((manifest.excluded ?? []).map((entry) => entry.id))
  const clips = []
  for (const clip of manifest.clips) {
    if (excluded.has(clip.id)) {
      continue
    }
    if (SPLIT !== 'all' && clip.split !== SPLIT && !(SPLIT === 'heldout' && clip.split !== 'dev')) {
      continue
    }
    const instrument = clip.instrument === 'piano' ? 'piano' : 'guitar'
    clips.push({
      id: clip.id,
      kind: 'performance',
      file: join(root, 'benchmarks', 'mic-real', clip.audio.file),
      instrument,
      instrumentDetail: clip.instrument,
      expected: clip.truth.anchorTones,
      anchorOnset: clip.truth.anchorOnset,
      truthNotes: clip.truth.notes,
      split: clip.split,
    })
  }
  return clips
}

// Corpus self-check: median emitted-minus-truth onset offset over
// greedy same-pitch matches. |median| > 0.1 s means the CLIP's labels
// (not the recognizer) are suspect — misaligned truth silently depresses
// every onset metric (measured: three Mozart excerpts at -0.1/-0.3/-0.5 s
// from MIDI/audio take drift). Flagged, never silently absorbed.
function alignmentAudit(truthNotes, emitted) {
  const diffs = []
  for (const truth of [...truthNotes].sort((a, b) => a.onset - b.onset)) {
    if (truth.onset < 0) {
      continue
    }
    let best = null
    for (const note of emitted) {
      if (Math.round(note.midi) !== truth.midi) {
        continue
      }
      const delta = note.start - truth.onset
      if (Math.abs(delta) < 1.0 && (best === null || Math.abs(delta) < Math.abs(best))) {
        best = delta
      }
    }
    if (best !== null) {
      diffs.push(best)
    }
  }
  diffs.sort((a, b) => a - b)
  return {
    pairs: diffs.length,
    medianOffset: diffs.length ? diffs[Math.floor(diffs.length / 2)] : null,
  }
}

function scoreClip(expected, notes, onsetTolerance = 0.35) {  // Note-level: expected pitch counts if ANY emitted note rounds to it
  // with onset inside the clip (clips are single events at ~120ms+).
  // Precision = emitted-in-expected / emitted; recall = expected found.
  const emitted = notes.map((note) => Math.round(note.midi))
  const expectedSet = new Set(expected)
  const found = new Set()
  for (const midi of emitted) {
    if (expectedSet.has(midi)) {
      found.add(midi)
    }
  }
  const falsePositives = emitted.filter((midi) => !expectedSet.has(midi))
  return {
    expected: expected.length,
    emitted: emitted.length,
    found: found.size,
    falsePositives,
    exactMatch: found.size === expected.length && falsePositives.length === 0,
  }
}

// Onset-aware note match (M14): truth note counts iff an emitted note
// rounds to it within ±tolerance (greedy, earliest first). Truth notes
// with onset < 0 predate the audio slice (pickup annotations) and are
// unscorable by construction — counting them as misses would punish the
// recognizer for notes that never sounded.
function scoreNoteOnsets(truthNotes, emitted, tolerance = 0.35) {
  const scorables = truthNotes.filter((note) => note.onset >= 0)
  const remaining = [...emitted].sort((a, b) => a.start - b.start)
  let matched = 0
  let onsetErrorSum = 0
  for (const truth of [...scorables].sort((a, b) => a.onset - b.onset)) {
    const index = remaining.findIndex(
      (note) => Math.round(note.midi) === truth.midi && Math.abs(note.start - truth.onset) <= tolerance,
    )
    if (index >= 0) {
      onsetErrorSum += Math.abs(remaining[index].start - truth.onset)
      remaining.splice(index, 1)
      matched += 1
    }
  }
  return { truth: scorables.length, matched, onsetErrorMean: matched ? onsetErrorSum / matched : null }
}

const server = await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
await server.listen()
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] })
const page = await browser.newPage()
page.on('pageerror', (error) => console.log('PAGEERROR', String(error).slice(0, 200)))
await page.goto(`${baseUrl}/scripts/neural-benchmark-page.html`, { waitUntil: 'load' })
const { backend } = await page.evaluate(async () => window.__neuralBench.load('/neural-model/model.json'))
// Warmup: first evaluateModel call compiles shaders (seconds, one-off).
// Exclude it so p50/p95 reflect steady-state streaming inference.
await page.evaluate(async () => {
  const warm = new Float32Array(Math.floor(0.5 * 22050))
  await window.__neuralBench.infer({ samples: Array.from(warm), onsetThreshold: 0.5, frameThreshold: 0.3, minNoteLength: 5 })
})
console.log(`backend=${backend} window=${WINDOW}s hop=${HOP}s onset=${ONSET} frame=${FRAME} minNote=${MIN_NOTE} split=${SPLIT}`)

const clips = collectClips()
const results = []
const allSavedWindows = []
for (const clip of clips) {
  const { samples, sampleRate } = readWavPcm(clip.file)
  const audio = samples.length ? resampleToModelRate(Float32Array.from(samples), sampleRate, NEURAL_MODEL_RATE) : new Float32Array(0)
  // Emulate a running capture: 1 s of leading silence so clip onsets
  // land mid-stream exactly as they do for a live microphone that was
  // already listening. Without this, onsets near t=0 die in every
  // window's edge suppression (a harness artifact, not model behavior).
  const LEAD_SILENCE_SECONDS = 1.0
  const mono = new Float32Array(Math.floor(LEAD_SILENCE_SECONDS * NEURAL_MODEL_RATE) + audio.length)
  mono.set(audio, Math.floor(LEAD_SILENCE_SECONDS * NEURAL_MODEL_RATE))
  const windowLength = Math.floor(WINDOW * NEURAL_MODEL_RATE)
  const hopLength = Math.floor(HOP * NEURAL_MODEL_RATE)
  const edgeSeconds = EDGE_MS / 1000
  const allNotes = []
  const inferTimes = []
  const savedWindows = []
  for (let start = 0; start + windowLength <= mono.length + hopLength; start += hopLength) {
    const windowSamples = new Float32Array(windowLength)
    const available = Math.min(mono.length - start, windowLength)
    if (available <= 0) {
      break
    }
    // Timing-preserving pad at the END (leading pad would shift onsets).
    windowSamples.set(mono.subarray(start, start + available), 0)
    const windowStartSeconds = start / NEURAL_MODEL_RATE
    const { notes, inferMs } = await page.evaluate(
      async ({ samples, onsetThreshold, frameThreshold, minNoteLength }) =>
        window.__neuralBench.infer({ samples: Array.from(samples), onsetThreshold, frameThreshold, minNoteLength }),
      { samples: windowSamples, onsetThreshold: ONSET, frameThreshold: FRAME, minNoteLength: MIN_NOTE },
    )
    inferTimes.push(inferMs)
    savedWindows.push({
      windowStartMs: (start / NEURAL_MODEL_RATE) * 1000,
      notes: notes.map((note) => ({ midi: note.midi, start: note.start, end: note.end })),
    })
    for (const note of notes) {
      // Same edge rule as the live stream (configurable, default 80 ms).
      if (note.start < edgeSeconds || WINDOW - note.start < edgeSeconds) {
        continue
      }
      if (note.end - note.start < 0.06) {
        continue
      }
      allNotes.push({ midi: note.midi, start: note.start + windowStartSeconds - LEAD_SILENCE_SECONDS, end: note.end + windowStartSeconds - LEAD_SILENCE_SECONDS })
    }
  }
  // Cross-window dedup (same rule as live stream, 120 ms gap).
  const deduped = []
  const byMidi = new Map()
  for (const note of allNotes.sort((a, b) => a.start - b.start)) {
    const key = Math.round(note.midi)
    const open = byMidi.get(key)
    if (open && note.start - open.end < 0.12) {
      open.end = Math.max(open.end, note.end)
      continue
    }
    const entry = { ...note }
    byMidi.set(key, entry)
    deduped.push(entry)
  }
  const score = clip.truthNotes
    ? scoreClip([...new Set(clip.truthNotes.map((note) => note.midi))], deduped)
    : scoreClip(clip.expected, deduped)
  const anchorFound = new Set(deduped.map((note) => Math.round(note.midi)))
  const anchorRecall = clip.expected.length
    ? clip.expected.filter((midi) => anchorFound.has(midi)).length / clip.expected.length
    : null
  const onsetTolerances = [0.2, 0.35, 0.5]
  const onsetByTol = {}
  if (clip.truthNotes) {
    const truth = clip.truthNotes.map((note) => ({ midi: note.midi, onset: note.onset }))
    const emitted = deduped.map((note) => ({ midi: note.midi, start: note.start }))
    for (const tol of onsetTolerances) {
      const scored = scoreNoteOnsets(truth, emitted, tol)
      onsetByTol[String(tol)] = {
        recall: scored.matched / Math.max(1, scored.truth),
        errorMean: scored.onsetErrorMean,
      }
    }
  }
  const onsetScore = clip.truthNotes ? scoreNoteOnsets(clip.truthNotes.map((note) => ({ midi: note.midi, onset: note.onset })), deduped.map((note) => ({ midi: note.midi, start: note.start }))) : null
  inferTimes.sort((a, b) => a - b)
  const result = {
    id: clip.id,
    kind: clip.kind,
    instrument: clip.instrument,
    instrumentDetail: clip.instrumentDetail ?? clip.instrument,
    split: clip.split,
    ...score,
    anchorRecall,
    onsetByTol: Object.keys(onsetByTol).length ? onsetByTol : null,
    onsetRecall: onsetByTol['0.35'] ? onsetByTol['0.35'].recall : null,
    onsetCount: clip.truthNotes ? clip.truthNotes.filter((note) => note.onset >= 0).length : null,
    onsetErrorMean: onsetByTol['0.35'] ? onsetByTol['0.35'].errorMean : null,
    alignment: clip.truthNotes
      ? alignmentAudit(
        clip.truthNotes.map((note) => ({ midi: note.midi, onset: note.onset })),
        deduped.map((note) => ({ midi: note.midi, start: note.start })),
      )
      : null,
    inferP50: inferTimes[Math.floor(inferTimes.length / 2)] ?? null,
    inferP95: inferTimes[Math.floor(inferTimes.length * 0.95)] ?? null,
    windows: inferTimes.length,
  }
  results.push(result)
  allSavedWindows.push(savedWindows)
  console.log(
    `${clip.id} [${clip.split}] exp=${clip.expected.join(',')} got=${deduped.map((n) => `${Math.round(n.midi)}@${n.start.toFixed(2)}+${(n.end - n.start).toFixed(2)}`).join(' ') || '—'} ` +
    `fp=[${score.falsePositives.join(',') || '—'}] exact=${score.exactMatch} p50=${result.inferP50}ms p95=${result.inferP95}ms`,
  )
}

function summarize(rows) {
  let expNotes = 0
  let found = 0
  let emitted = 0
  let fp = 0
  let exact = 0
  let anchorExp = 0
  let anchorGot = 0
  let onsetTruth = 0
  let onsetMatched = 0
  let onsetErrorSum = 0
  let onsetErrorN = 0
  const tolRecalls = {}
  for (const row of rows) {
    expNotes += row.expected
    found += row.found
    emitted += row.emitted
    fp += row.falsePositives.length
    if (row.exactMatch) {
      exact += 1
    }
    if (row.anchorRecall != null) {
      anchorExp += row.expected
      anchorGot += Math.round(row.anchorRecall * row.expected)
    }
    if (row.onsetCount != null) {
      onsetTruth += row.onsetCount
      onsetMatched += Math.round((row.onsetRecall ?? 0) * row.onsetCount)
      if (row.onsetErrorMean != null) {
        onsetErrorSum += row.onsetErrorMean * Math.round((row.onsetRecall ?? 0) * row.onsetCount)
        onsetErrorN += Math.round((row.onsetRecall ?? 0) * row.onsetCount)
      }
    }
    if (row.onsetByTol) {
      for (const [tol, scored] of Object.entries(row.onsetByTol)) {
        tolRecalls[tol] = tolRecalls[tol] ?? { matched: 0, truth: 0 }
        tolRecalls[tol].matched += scored.recall * (row.onsetCount ?? 0)
        tolRecalls[tol].truth += row.onsetCount ?? 0
      }
    }
  }
  return {
    clips: rows.length,
    notes: expNotes,
    recall: expNotes ? found / expNotes : null,
    precision: emitted ? (emitted - fp) / emitted : (expNotes === 0 ? null : 0),
    exactMatch: rows.length ? exact / rows.length : null,
    falsePositives: fp,
    anchorRecall: anchorExp ? anchorGot / anchorExp : null,
    onsetRecall: onsetTruth ? onsetMatched / onsetTruth : null,
    onsetNotes: onsetTruth,
    onsetErrorMean: onsetErrorN ? onsetErrorSum / onsetErrorN : null,
    onsetRecallByTol: Object.fromEntries(
      Object.entries(tolRecalls).map(([tol, value]) => [tol, value.truth ? value.matched / value.truth : null]),
    ),
    misalignedClips: rows
      .filter((row) => row.alignment?.medianOffset != null && Math.abs(row.alignment.medianOffset) > 0.1)
      .map((row) => ({ id: row.id, medianOffset: Math.round(row.alignment.medianOffset * 1000) / 1000, pairs: row.alignment.pairs })),
  }
}

const summary = {
  config: { corpus: CORPUS, window: WINDOW, hop: HOP, onset: ONSET, frame: FRAME, minNote: MIN_NOTE, backend },
  overall: summarize(results),
  tune: summarize(results.filter((r) => r.split === 'tune' || r.split === 'dev')),
  heldout: summarize(results.filter((r) => r.split === 'heldout' || r.split === 'eval' || r.split === 'eval-fresh')),
  evalFresh: summarize(results.filter((r) => r.split === 'eval-fresh')),
  piano: summarize(results.filter((r) => r.instrument === 'piano')),
  guitar: summarize(results.filter((r) => r.instrument === 'guitar')),
  acousticGuitar: summarize(results.filter((r) => r.instrumentDetail === 'acoustic-guitar')),
  electricGuitar: summarize(results.filter((r) => r.instrumentDetail === 'electric-guitar')),
}
console.log(JSON.stringify(summary, null, 1))
if (JSON_OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(JSON_OUT, JSON.stringify({ summary, results }, null, 1))
  console.log(`wrote ${JSON_OUT}`)
}
if (SAVE_NOTES) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(SAVE_NOTES, JSON.stringify({
    config: { window: WINDOW, hop: HOP, onset: ONSET, frame: FRAME, minNote: MIN_NOTE, backend },
    clips: results.map((result, index) => ({
      id: result.id,
      instrument: result.instrument,
      split: result.split,
      expected: clips[index].expected,
      truthMidis: clips[index].truthNotes ? [...new Set(clips[index].truthNotes.map((note) => note.midi))] : null,
      windows: allSavedWindows[index],
    })),
  }, null, 1))
  console.log(`wrote ${SAVE_NOTES}`)
}
await browser.close()
await server.close()
