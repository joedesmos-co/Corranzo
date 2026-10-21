#!/usr/bin/env node
/**
 * Audio Vision — musical quality evaluation against an INDEPENDENT reference.
 *
 * The point of this harness is to measure the ARRANGEMENT, not the agreement
 * between the score and its own preview. So it needs a reference the pipeline
 * never sees: a synthesized piano piece with known notes, known onsets and
 * known hands. The audio is rendered from that reference, the real browser
 * pipeline analyses it (Basic Pitch in its Web Worker, the same code the app
 * runs), and the resulting MusicXML is compared with the reference.
 *
 * Metrics (reported separately, never blended into one "accuracy" number):
 *   pitch accuracy      reference notes that appear in the arrangement
 *   onset accuracy      matched notes that also land on the right beat
 *   false positives     arrangement notes that match no reference note
 *   missed notes        reference notes with no arrangement match
 *   event accuracy      F1 over (onset bucket, pitch) events
 *   staff placement     notes written in the expected hand/staff
 *   musicxml validity   parses, and every voice fills its measures exactly
 *   playability         density, tiny durations, out-of-range notes
 *
 * Usage: E2E_PORT=5651 node scripts/browser-audio-vision-quality-eval.mjs
 *        --json out.json --md out.md
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-quality-eval')
const PORT = Number(process.env.E2E_PORT ?? 5651)
const baseUrl = `http://127.0.0.1:${PORT}/`
const SR = 22050

const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null
const mdOut = args.includes('--md') ? args[args.indexOf('--md') + 1] : null

/* ------------------------------------------------------------------ fixtures */

/**
 * A piano piece whose notes are known exactly. The right hand states the
 * melody (including a passing note and a held note), the left hand states the
 * harmony and the bass.
 */
function pianoPiece() {
  const bpm = 100
  const beat = 60 / bpm
  const events = []
  const melody = [
    // [beat, midi, beats]
    [0, 72, 1], [1, 74, 1], [2, 76, 2], [4, 77, 1], [5, 76, 1],
    [6, 74, 2], [8, 72, 1], [9, 71, 1], [10, 69, 4],
    [14, 67, 1], [15, 69, 1], [16, 71, 1], [17, 72, 1], [18, 74, 4],
    [22, 76, 1], [23, 77, 1], [24, 79, 1], [25, 77, 1], [26, 76, 1],
    [27, 74, 1], [28, 72, 4],
  ]
  const harmony = [
    // [beat, [midi...], beats]
    [0, [48, 60, 64], 4], [4, [50, 62, 65], 4], [8, [43, 59, 67], 4],
    [12, [48, 60, 64], 2], [14, [47, 59, 62], 2], [16, [43, 59, 67], 2],
    [18, [50, 62, 65], 4], [22, [48, 60, 64], 4], [26, [45, 57, 64], 2],
    [28, [48, 60, 64], 4],
  ]
  for (const [b, midi, beats] of melody) {
    events.push({ midi, start: b * beat, dur: beats * beat * 0.95, hand: 'RH', amp: 0.34 })
  }
  for (const [b, midis, beats] of harmony) {
    for (const midi of midis) {
      events.push({ midi, start: b * beat, dur: beats * beat * 0.95, hand: 'LH', amp: 0.24 })
    }
  }
  const musicEndSeconds = Math.max(...events.map((e) => e.start + e.dur))
  return {
    id: 'piano-piece',
    musicEndSeconds: Math.round(musicEndSeconds * 1000) / 1000,
    bpm,
    seconds: 24,
    events,
    reference: events.map((e) => ({
      midi: e.midi,
      onsetSeconds: Math.round(e.start * 1000) / 1000,
      durationSeconds: Math.round(e.dur * 1000) / 1000,
      hand: e.hand,
    })),
  }
}

/** Render the reference to audio (the only thing the pipeline ever sees). */
function render(events, seconds) {
  const out = new Float32Array(Math.floor(seconds * SR))
  for (const { midi, start, dur, amp = 0.3 } of events) {
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const s0 = Math.floor(start * SR)
    const s1 = Math.min(out.length, Math.floor((start + dur) * SR))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / SR
      const env = Math.min(1, t * 120) * Math.exp(-1.6 * t)
      let v = 0
      for (let h = 1; h <= 5; h += 1) v += Math.sin(2 * Math.PI * freq * h * t) / (h * 1.6)
      out[i] += amp * env * v
    }
  }
  // A touch of room noise so the detector sees a realistic signal.
  for (let i = 0; i < out.length; i += 1) out[i] += (Math.random() - 0.5) * 0.0015
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < out.length; i += 1) out[i] = (out[i] / peak) * 0.85
  return out
}

function wavBytes(samples, sampleRate = SR) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

/* ------------------------------------------------------------------ compare */

/**
 * Compare the arrangement's notes with the reference.
 * A reference note is "hit" when the arrangement has a note of the same pitch
 * within `onsetTolerance` seconds; an arrangement note is a false positive
 * when no reference note of that pitch is that close.
 */
function compare(reference, arranged, { onsetTolerance = 0.12, musicEndSeconds = null } = {}) {
  const sortedRef = [...reference].sort((a, b) => a.onsetSeconds - b.onsetSeconds)
  const sortedArr = [...arranged].sort((a, b) => a.timeSeconds - b.timeSeconds)
  const usedRef = new Set()
  const usedArr = new Set()
  let onsetHits = 0
  const matched = []
  for (let ri = 0; ri < sortedRef.length; ri += 1) {
    const ref = sortedRef[ri]
    let best = -1
    let bestDelta = Infinity
    for (let ai = 0; ai < sortedArr.length; ai += 1) {
      if (usedArr.has(ai)) continue
      const arr = sortedArr[ai]
      if (arr.midi !== ref.midi) continue
      const delta = Math.abs(arr.timeSeconds - ref.onsetSeconds)
      if (delta <= onsetTolerance && delta < bestDelta) {
        best = ai
        bestDelta = delta
      }
    }
    if (best >= 0) {
      usedRef.add(ri)
      usedArr.add(best)
      matched.push({ ref, arr: sortedArr[best], delta: bestDelta })
      if (bestDelta <= 0.05) onsetHits += 1
    }
  }
  const matchedRef = usedRef.size
  const falsePositives = sortedArr.length - usedArr.size
  const missed = sortedRef.length - matchedRef
  // Where do the false positives live? A note after the music ends is a
  // hallucination in silence; one inside the music is a wrong note.
  const falsePositiveNotes = sortedArr.filter((_, index) => !usedArr.has(index))
  const fpInSilence = Number.isFinite(musicEndSeconds)
    ? falsePositiveNotes.filter((n) => n.timeSeconds > musicEndSeconds + 0.4).length
    : null
  const fpInsideMusic = Number.isFinite(musicEndSeconds)
    ? falsePositiveNotes.filter((n) => n.timeSeconds <= musicEndSeconds + 0.4).length
    : null
  const precision = sortedArr.length ? matchedRef / sortedArr.length : 0
  const recall = sortedRef.length ? matchedRef / sortedRef.length : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  // Hand placement: the fraction of matched notes written in the reference's hand.
  let handHits = 0
  let handTotal = 0
  for (const { ref, arr } of matched) {
    if (!ref.hand || !arr.hand) continue
    handTotal += 1
    if (ref.hand === arr.hand) handHits += 1
  }
  // Pitch-only recall: does the pitch appear AT ALL in the arrangement? This
  // separates "the note was dropped" from "the note is there but late/early".
  const arrangementPitches = new Set(sortedArr.map((n) => n.midi))
  const pitchOnly = sortedRef.filter((ref) => arrangementPitches.has(ref.midi)).length
  // Time offset of the pitch-matched notes: a systematic shift means the beat
  // grid is offset, not that the pitches are wrong.
  const offsets = matched.map((m) => m.arr.timeSeconds - m.ref.onsetSeconds).sort((a, b) => a - b)
  const median = offsets.length ? offsets[Math.floor(offsets.length / 2)] : null
  const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
  return {
    referenceNotes: sortedRef.length,
    arrangedNotes: sortedArr.length,
    matched: matchedRef,
    pitchAccuracy: round(recall),
    pitchOnlyRecall: round(sortedRef.length ? pitchOnly / sortedRef.length : 0),
    onsetAccuracy: round(matchedRef ? onsetHits / matchedRef : 0),
    falsePositives,
    missed,
    eventAccuracyF1: round(f1),
    handAccuracy: handTotal ? round(handHits / handTotal) : null,
    handChecked: handTotal,
    medianTimeOffsetSeconds: round(median),
    falsePositivesInSilence: fpInSilence,
    falsePositivesInsideMusic: fpInsideMusic,
  }
}

/** Playability and notation hygiene of the engraved score. */
function playability(arranged, { beatsPerMeasure = 4 } = {}) {
  if (!arranged.length) return { density: 0, tinyDurations: 0, outOfRange: 0, ledgerRisk: 0 }
  const duration = Math.max(...arranged.map((n) => n.timeSeconds + (n.durationSeconds ?? 0)))
  const beats = duration * (arranged.length ? 1 : 0)
  const tiny = arranged.filter((n) => (n.durationSeconds ?? 0) < 0.09).length
  const outOfRange = arranged.filter((n) => n.midi < 28 || n.midi > 96).length
  const ledger = arranged.filter((n) => n.midi < 40 || n.midi > 84).length
  void beatsPerMeasure
  void beats
  return {
    densityPerSecond: Math.round((arranged.length / Math.max(0.001, duration)) * 100) / 100,
    tinyDurations: tiny,
    tinyRatio: Math.round((tiny / arranged.length) * 1000) / 1000,
    outOfRange,
    ledgerRisk: ledger,
    ledgerRatio: Math.round((ledger / arranged.length) * 1000) / 1000,
  }
}

/**
 * MusicXML validity: the written position must fill every measure exactly.
 * The check walks the measure the way a reader does - notes and rests move
 * the cursor forward, a backup moves it back - so a two-voice score (grand
 * staff, or notation + TAB) is judged per voice, not summed.
 */
function xmlValidity(xml) {
  const measures = [...xml.matchAll(/<measure number="(\d+)">([\s\S]*?)<\/measure>/g)]
  let overfull = 0
  let underfull = 0
  const expected = 4 * 16 // 4/4 at 16 divisions
  for (const [, , body] of measures) {
    let cursor = 0
    let maxCursor = 0
    const tokens = body.matchAll(/<note>([\s\S]*?)<\/note>|<backup><duration>(\d+)<\/duration>|<forward><duration>(\d+)<\/duration>/g)
    for (const token of tokens) {
      if (token[2] != null) {
        cursor -= Number(token[2])
        continue
      }
      if (token[3] != null) {
        cursor += Number(token[3])
        maxCursor = Math.max(maxCursor, cursor)
        continue
      }
      const body = token[1] ?? ''
      const duration = Number(/<duration>(\d+)<\/duration>/.exec(body)?.[1] ?? 0)
      // A <chord/> note sounds WITH the previous note: it does not move the
      // written position.
      if (/<chord\s*\/?>/.test(body)) continue
      cursor += duration
      maxCursor = Math.max(maxCursor, cursor)
    }
    if (maxCursor > expected) overfull += 1
    if (cursor !== expected) underfull += 1
  }
  return {
    measures: measures.length,
    overfullMeasures: overfull,
    underfullMeasures: underfull,
    valid: overfull === 0 && underfull === 0,
  }
}

/* --------------------------------------------------------------------- main */

await mkdir(outDir, { recursive: true })
const piece = pianoPiece()
const samples = render(piece.events, piece.seconds)
const wavPath = join(outDir, `${piece.id}.wav`)
await writeFile(wavPath, wavBytes(samples))

const vite = await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
await vite.listen()
await new Promise((r) => setTimeout(r, 800))

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

const results = []
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(1500)
  // The reference audio travels into the page; the pipeline never sees the
  // reference notes.
  const wavBase64 = wavBytes(samples).toString('base64')
  const outcomes = await page.evaluate(async ({ wavBase64, sampleRate, pieceSeconds, musicEndSeconds, targetParts, difficulties }) => {
    const binary = atob(wavBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const arrayBuffer = bytes.buffer
    const pipeline = await import('/src/features/audio-vision/audioArrangementPipeline.js')
    const client = await import('/src/features/audio-vision/audioVisionPitchClient.js')
    const parse = await import('/src/features/musicxml/parseMusicXml.js')
    const analysisModule = await import('/src/features/audio-vision/musicAnalysis.js')
    const importModule = await import('/src/features/audio-vision/audioImport.js')
    const results = []

    // Stage 1 — the TRANSCRIPTION alone (no arrangement). This separates
    // "the model heard the wrong notes" from "the arranger wrote them badly".
    {
      const imported = await importModule.importAudioFile(
        { name: 'reference.wav', size: arrayBuffer.byteLength, type: 'audio/wav' },
        arrayBuffer,
        async (buffer) => {
          const Ctx = window.AudioContext || window.webkitAudioContext
          const ctx = new Ctx()
          try {
            const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
            const channels = []
            for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
              channels.push(Float32Array.from(audioBuffer.getChannelData(c)))
            }
            return {
              channelData: channels,
              sampleRate: audioBuffer.sampleRate,
              durationSeconds: audioBuffer.duration,
              channelCount: audioBuffer.numberOfChannels,
            }
          } finally {
            try { await ctx.close() } catch { /* noop */ }
          }
        },
      )
      const views = await import('/src/features/audio-vision/sourceSeparation.js')
      const built = await views.buildAnalysisViews(imported.samples, imported.sampleRate)
      const analysis = await analysisModule.analyzeMusic(imported.samples, imported.sampleRate, {
        views: built,
        predictNotes: async (audioSamples) => {
          const notes = await client.inferNotesInWorker(audioSamples)
          return notes.map((n) => ({
            midi: n.midi,
            startSeconds: n.startOffsetSeconds,
            endSeconds: n.endOffsetSeconds,
          }))
        },
      })
      results.push({
        stage: 'transcription',
        ok: true,
        pieceSeconds,
        transcriptionNotes: (analysis.predictedNotes ?? []).map((n) => ({
          midi: n.midi,
          timeSeconds: n.startSeconds,
          durationSeconds: Math.max(0, (n.endSeconds ?? 0) - (n.startSeconds ?? 0)),
        })),
        tempoBpm: analysis.tempo?.bpm ?? null,
        notes: (analysis.predictedNotes ?? []).map((n) => ({
          midi: n.midi,
          timeSeconds: n.startSeconds,
          durationSeconds: Math.max(0, (n.endSeconds ?? 0) - (n.startSeconds ?? 0)),
        })),
        onsets: analysis.onsets?.length ?? 0,
        chords: analysis.chords?.length ?? 0,
      })
    }
    for (const targetPart of targetParts) {
      for (const difficulty of difficulties) {
        const started = performance.now()
        const out = await pipeline.runAudioArrangementPipeline(
          { name: 'reference.wav', size: arrayBuffer.byteLength, type: 'audio/wav' },
          arrayBuffer,
          { targetPart, difficulty, title: 'Reference Piece' },
          {
            decodeAudioDataImpl: async (buffer) => {
              const Ctx = window.AudioContext || window.webkitAudioContext
              const ctx = new Ctx()
              try {
                const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
                const channels = []
                for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
                  channels.push(Float32Array.from(audioBuffer.getChannelData(c)))
                }
                return {
                  channelData: channels,
                  sampleRate: audioBuffer.sampleRate,
                  durationSeconds: audioBuffer.duration,
                  channelCount: audioBuffer.numberOfChannels,
                }
              } finally {
                try { await ctx.close() } catch { /* noop */ }
              }
            },
            predictNotes: async (audioSamples) => {
              const notes = await client.inferNotesInWorker(audioSamples)
              return notes.map((n) => ({
                midi: n.midi,
                startSeconds: n.startOffsetSeconds,
                endSeconds: n.endOffsetSeconds,
              }))
            },
          },
        )
        const ms = Math.round(performance.now() - started)
        if (!out.ok) {
          results.push({ targetPart, difficulty, ok: false, code: out.code, ms })
          continue
        }
        const parsed = parse.parseMusicXml(out.musicXml, 'reference.musicxml')
        const notes = (parsed?.notes ?? [])
          .filter((n) => !n.isRest && Number.isFinite(n.midi) && !n.isTabMirror)
          .map((n) => ({
            midi: n.midi,
            timeSeconds: n.timeSeconds ?? 0,
            durationSeconds: n.durationSeconds ?? 0,
            hand: n.staff === 2 ? 'LH' : 'RH',
            staff: n.staff ?? 1,
          }))
        results.push({
          targetPart,
          difficulty,
          ok: true,
          ms,
          confidence: out.confidence?.overall ?? null,
          pitchSource: out.analysis?.pitchSource ?? null,
          tempoBpm: out.analysis?.tempo?.bpm ?? null,
          agreement: out.transcriptionAgreement ?? null,
          musicXml: out.musicXml,
          notes,
          events: out.model?.parts?.[0]?.events?.length ?? 0,
          warnings: out.model?.parts?.[0]?.warnings ?? [],
        })
      }
    }
    return results
  }, {
    wavBase64,
    sampleRate: SR,
    pieceSeconds: piece.seconds,
    musicEndSeconds: piece.musicEndSeconds,
    targetParts: ['solo-piano', 'solo-guitar'],
    difficulties: ['easy', 'intermediate', 'advanced'],
  })

  let transcriptionNotes = []
  for (const outcome of outcomes) {
    if (outcome.stage === 'transcription') {
      transcriptionNotes = outcome.transcriptionNotes ?? []
      const row = {
        stage: 'transcription',
        ok: true,
        tempoBpm: outcome.tempoBpm,
        ...compare(piece.reference, outcome.notes, { musicEndSeconds: piece.musicEndSeconds }),
        ...playability(outcome.notes),
        predictedNotes: outcome.notes.length,
        onsets: outcome.onsets,
        chords: outcome.chords,
        sample: [...outcome.notes].sort((a, b) => a.timeSeconds - b.timeSeconds).slice(0, 8),
        notesInSilence: outcome.notes.filter((n) => n.timeSeconds > outcome.musicEndSeconds + 0.4).length,
        notesInMusic: outcome.notes.filter((n) => n.timeSeconds <= outcome.musicEndSeconds + 0.4).length,
        earliest: [...outcome.notes].sort((a, b) => a.timeSeconds - b.timeSeconds).slice(0, 8),
      }
      results.push(row)
      console.log(
        `transcription: notes=${row.predictedNotes} pitch=${row.pitchAccuracy} onset=${row.onsetAccuracy} ` +
        `fp=${row.falsePositives} missed=${row.missed} f1=${row.eventAccuracyF1} tempo=${row.tempoBpm} ` +
        `offset=${row.medianTimeOffsetSeconds} fpSilence=${row.falsePositivesInSilence} fpMusic=${row.falsePositivesInsideMusic}`,
      )
      console.log(`  first predicted: ${JSON.stringify(row.sample)}`)
      continue
    }
    const row = {
      targetPart: outcome.targetPart,
      difficulty: outcome.difficulty,
      ok: outcome.ok,
      code: outcome.code ?? null,
      ms: outcome.ms,
      confidence: outcome.confidence ?? null,
      pitchSource: outcome.pitchSource ?? null,
      tempoBpm: outcome.tempoBpm ?? null,
      agreement: outcome.agreement ?? null,
    }
    if (outcome.ok) {
      Object.assign(row, compare(piece.reference, outcome.notes, { musicEndSeconds: piece.musicEndSeconds }))
      Object.assign(row, playability(outcome.notes))
      Object.assign(row, xmlValidity(outcome.musicXml))
      row.warnings = outcome.warnings.map((w) => w.kind)
      row.arrangedSample = [...outcome.notes].sort((a, b) => a.timeSeconds - b.timeSeconds).slice(0, 8)
      row.transcriptionSample = [...transcriptionNotes].sort((a, b) => a.timeSeconds - b.timeSeconds).slice(0, 8)
      // What the ARRANGER did to a transcription that was already correct.
      const fidelity = compare(transcriptionNotes, outcome.notes)
      row.arrangerKeptPitches = fidelity.pitchOnlyRecall
      row.arrangerKeptOnsets = fidelity.onsetAccuracy
      row.arrangerMissed = fidelity.missed
      row.arrangerAdded = fidelity.falsePositives
      row.arrangerMedianOffset = fidelity.medianTimeOffsetSeconds
    }
    results.push(row)
    console.log(
      `${row.targetPart} ${row.difficulty}: ${row.ok ? 'ok' : `FAIL(${row.code})`}` +
      (row.ok
        ? ` pitch=${row.pitchAccuracy} pitchOnly=${row.pitchOnlyRecall} onset=${row.onsetAccuracy} fp=${row.falsePositives} missed=${row.missed} f1=${row.eventAccuracyF1} hand=${row.handAccuracy} offset=${row.medianTimeOffsetSeconds} dens=${row.densityPerSecond} tiny=${row.tinyDurations} ledger=${row.ledgerRisk}` +
        ` | arranger kept=${row.arrangerKeptPitches} onsets=${row.arrangerKeptOnsets} missed=${row.arrangerMissed} added=${row.arrangerAdded} offset=${row.arrangerMedianOffset}` +
      `\n    arranged: ${JSON.stringify(row.arrangedSample)}\n    transcrip: ${JSON.stringify(row.transcriptionSample)}`
        : ''),
    )
  }
} catch (error) {
  console.error(String(error?.stack ?? error))
  results.push({ error: String(error?.message ?? error) })
} finally {
  try { await browser.close() } catch { /* noop */ }
  try { await vite.close() } catch { /* noop */ }
}

const summary = {
  generatedAt: new Date().toISOString(),
  fixture: piece.id,
  referenceNotes: piece.reference.length,
  consoleErrors,
  results,
}
if (jsonOut) await writeFile(jsonOut, JSON.stringify(summary, null, 2))
if (mdOut) {
  const lines = [
    '# Audio Vision — musical quality (independent reference)',
    '',
    `Fixture: ${piece.id} · ${piece.reference.length} reference notes · ${piece.bpm} BPM`,
    '',
    '| part | difficulty | pitch | onset | FP | missed | event F1 | hand | density/s | tiny | ledger | overfull | conf |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const r of results) {
    if (!r.ok) { lines.push(`| ${r.targetPart} | ${r.difficulty} | — | — | — | — | — | — | — | — | — | — | FAIL |`); continue }
    lines.push(`| ${r.targetPart} | ${r.difficulty} | ${r.pitchAccuracy} | ${r.onsetAccuracy} | ${r.falsePositives} | ${r.missed} | ${r.eventAccuracyF1} | ${r.handAccuracy ?? '—'} | ${r.densityPerSecond} | ${r.tinyDurations} | ${r.ledgerRisk} | ${r.overfullMeasures} | ${r.confidence} |`)
  }
  await writeFile(mdOut, `${lines.join('\n')}\n`)
}
console.log(`\nconsoleErrors=${consoleErrors.length}`)
process.exit(results.some((r) => r.error) ? 1 : 0)
