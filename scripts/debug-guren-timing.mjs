/**
 * Guren playback-cursor timing trace.
 *
 * Loads the real uploaded Guren MXL, builds the performed timeline + playback
 * schedule, and at a sweep of PERFORMED playback times prints:
 *   playback time, performed measure index, written measure number, repeat pass,
 *   beat within measure, the note/rest event sounding then, the cursor x/y the
 *   resolver would emit, tempo, and the duration source.
 *
 * Run: node scripts/debug-guren-timing.mjs [path-to-mxl-or-xml]
 *
 * Purpose: prove WHERE playback time and the scorebar position diverge.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  mapMidiEventsMeasureAligned,
  mapMidiEventsToPerformedTimeline,
} from '../src/features/playback/midiToPerformedMapping.js'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import {
  getMeasureAtTime,
  getBeatAtTime,
  getTempoAtTime,
} from '../src/features/musicxml/timingQuery.js'
import {
  getMeasurePlaybackWindow,
  getPerformedEntryAtTime,
  getPerformedBeats,
  usesPerformedTimeline,
} from '../src/features/musicxml/performedTimeline.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'

// Mirror of buildScoreNoteSchedule() without importing the playback module (it
// transitively pulls in @tonejs/midi, a CommonJS dep that this raw-Node script
// can't import). The performed note schedule is exactly the MusicXML branch.
function buildScoreNoteSchedule(timingMap) {
  return getTimeline(timingMap)
    .performedNotes()
    .filter((note) => !note.isRest && note.midi != null)
    .map((note) => ({
      type: 'note',
      scoreTimeSeconds: note.performedSeconds,
      baseDurationSeconds: Math.max(note.durationSeconds, 0.03),
      midi: note.midi,
      label: note.label,
      measureNumber: note.measureNumber,
      repeatPass: note.repeatPass ?? 1,
    }))
    .sort((a, b) => a.scoreTimeSeconds - b.scoreTimeSeconds)
}

// Pass the score path as an argument; these are convenience fallbacks only.
const DEFAULT_CANDIDATES = [
  'uploads/attack-on-titan-opening-1-guren-no-yumiya.mxl',
  'fixtures/guren.mxl',
  'attack-on-titan-opening-1-guren-no-yumiya.mxl',
].filter(Boolean)

async function readScoreXml(filePath) {
  const buf = fs.readFileSync(filePath)
  if (filePath.toLowerCase().endsWith('.mxl')) {
    const zip = await JSZip.loadAsync(buf)
    const container = zip.file('META-INF/container.xml')
    let rootPath = null
    if (container) {
      const xml = await container.async('string')
      const m = xml.match(/full-path="([^"]+)"/)
      if (m) rootPath = m[1]
    }
    if (!rootPath || !zip.file(rootPath)) {
      rootPath = Object.keys(zip.files).find(
        (p) => p.toLowerCase().endsWith('.xml') && !p.startsWith('__MACOSX') && !/container\.xml/i.test(p),
      )
    }
    return zip.file(rootPath).async('string')
  }
  return buf.toString('utf8')
}

/** Build one trusted anchor per written measure with a known measure-local x span. */
function syntheticAnchors(timingMap) {
  return timingMap.measures.map((measure, index) => ({
    measureNumber: measure.number,
    page: 0,
    x: 100 + index * 100, // measure start x (arbitrary but monotonic)
    y: 200,
    meta: {
      playableStartX: 100 + index * 100,
      playableEndX: 100 + index * 100 + 80, // 80px-wide note region per measure
      systemEndX: 100 + index * 100 + 90,
    },
  }))
}

function noteSoundingAt(schedule, t) {
  // The most recent note whose onset ≤ t (what the ear is currently on).
  let current = null
  for (const ev of schedule) {
    if (ev.scoreTimeSeconds <= t + 1e-6) {
      if (!current || ev.scoreTimeSeconds > current.scoreTimeSeconds) current = ev
    }
  }
  return current
}

function fmt(n, d = 3) {
  return n == null ? '—' : Number(n).toFixed(d)
}

async function main() {
  const arg = process.argv[2]
  const filePath = arg || DEFAULT_CANDIDATES.find((p) => fs.existsSync(p))
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('No Guren score found. Pass a path: node scripts/debug-guren-timing.mjs <file>')
    process.exit(1)
  }
  console.log('Score file:', filePath)

  const xml = await readScoreXml(filePath)
  const timingMap = parseMusicXml(xml, path.basename(filePath))
  const timeline = getTimeline(timingMap)
  const schedule = buildScoreNoteSchedule(timingMap)
  const anchors = syntheticAnchors(timingMap)

  console.log('\n=== HEADER ===')
  console.log('divisions:', timingMap.divisions)
  console.log('written measures:', timingMap.measures.length)
  console.log('written duration (s):', fmt(timingMap.durationSeconds))
  console.log('usesPerformedTimeline:', usesPerformedTimeline(timingMap))
  console.log('performed duration (s):', fmt(timeline.performedDurationSeconds))
  console.log('tempoChanges:', JSON.stringify(timingMap.tempoChanges))
  console.log('repeat diagnostics:', JSON.stringify(timingMap.performedMeasureTimeline?.diagnostics, null, 2))

  console.log('\n=== WRITTEN MEASURES (first 12) ===')
  for (const m of timingMap.measures.slice(0, 12)) {
    console.log(
      `m${m.number}: start=${fmt(m.startTimeSeconds)} end=${fmt(m.endTimeSeconds)} dur=${fmt(m.endTimeSeconds - m.startTimeSeconds)} beats=${m.beats}/${m.beatType ?? '?'}`,
    )
  }

  console.log('\n=== PERFORMED ENTRIES (repeat expansion) ===')
  for (const e of timeline.entries) {
    console.log(
      `perf#${e.performedIndex} writtenM${e.writtenMeasureNumber} pass${e.repeatPass} start=${fmt(e.startTimeSeconds)} end=${fmt(e.endTimeSeconds)} dur=${fmt(e.endTimeSeconds - e.startTimeSeconds)}`,
    )
  }

  // Find the fastest passage: the written measure with the most note onsets.
  const onsetsByMeasure = new Map()
  for (const ev of schedule) {
    onsetsByMeasure.set(ev.measureNumber, (onsetsByMeasure.get(ev.measureNumber) ?? 0) + 1)
  }
  const fastMeasure = [...onsetsByMeasure.entries()].sort((a, b) => b[1] - a[1])[0]
  console.log(`\n=== DENSEST WRITTEN MEASURE: m${fastMeasure?.[0]} with ${fastMeasure?.[1]} onsets ===`)
  const fastNotes = schedule.filter((e) => e.measureNumber === fastMeasure?.[0]).slice(0, 16)
  for (const n of fastNotes) {
    console.log(`  ${n.label ?? n.name ?? '?'} perfT=${fmt(n.scoreTimeSeconds)} dur=${fmt(n.baseDurationSeconds)} pass=${n.repeatPass}`)
  }

  console.log('\n=== TRACE: performed time → measure / beat / event / cursor ===')
  console.log('time | perf# wM pass | beat | window[start,end] prog | soundingNote(wM) | cursorX prog | tempo')
  const total = timeline.performedDurationSeconds
  const step = Math.max(0.1, total / 80)
  let lastDesync = null
  const desyncs = []
  for (let t = 0; t <= total + 1e-6; t += step) {
    const entry = getPerformedEntryAtTime(timingMap, t)
    const measure = getMeasureAtTime(timingMap, t)
    const beat = getBeatAtTime(timingMap, t)
    const window = getMeasurePlaybackWindow(timingMap, measure?.number, t)
    const sounding = noteSoundingAt(schedule, t)
    const tempo = getTempoAtTime(timingMap, t)
    const res = resolveScoreFollowCursor({
      timingMap,
      practiceTime: t,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
    })
    const cur = res.cursor

    // Desync check: the measure the cursor thinks we're in vs the measure of the
    // note currently sounding (per the audio schedule). They MUST agree.
    const cursorMeasure = cur.measureNumber ?? measure?.number ?? null
    const soundingMeasure = sounding?.measureNumber ?? null
    const measureMismatch =
      soundingMeasure != null && cursorMeasure != null && soundingMeasure !== cursorMeasure
    if (measureMismatch) desyncs.push({ t, cursorMeasure, soundingMeasure })

    const flag = measureMismatch ? '  <<< MEASURE MISMATCH' : ''
    console.log(
      `${fmt(t, 2)} | #${entry?.performedIndex ?? '—'} m${measure?.number ?? '—'} p${entry?.repeatPass ?? '—'} | b${beat?.beat ?? '—'} | [${fmt(window?.startTimeSeconds, 2)},${fmt(window?.endTimeSeconds, 2)}] | sound=m${soundingMeasure ?? '—'}(${sounding?.label ?? sounding?.name ?? '—'}) | x=${fmt(cur.x, 1)} prog=${fmt(cur.progress, 2)} | ${fmt(tempo, 1)}${flag}`,
    )
  }

  console.log('\n=== SUMMARY (cursor measure vs sounding-note measure) ===')
  console.log('measure-mismatch samples:', desyncs.length)
  if (desyncs.length) {
    console.log('first mismatch:', JSON.stringify(desyncs[0]))
    console.log('last mismatch:', JSON.stringify(desyncs.at(-1)))
  }

  // ── MIDI backing mapping check ──────────────────────────────────────────────
  const midiPath = filePath.replace(/\.(mxl|musicxml|xml)$/i, '.mid')
  if (fs.existsSync(midiPath)) {
    console.log('\n=== MIDI BACKING MAP CHECK ===')
    console.log('MIDI file:', midiPath)
    const require = createRequire(import.meta.url)
    const { Midi } = require('@tonejs/midi')
    const midi = new Midi(fs.readFileSync(midiPath))
    const t2m =
      typeof midi.header?.ticksToMeasures === 'function'
        ? (ticks) => midi.header.ticksToMeasures(ticks)
        : null
    const midiNotes = midi.tracks
      .flatMap((track) => track.notes)
      .map((n) => ({
        time: n.time,
        duration: n.duration,
        name: n.name,
        velocity: n.velocity,
        measurePosition: t2m && Number.isFinite(n.ticks) ? t2m(n.ticks) : null,
      }))
      .sort((a, b) => a.time - b.time)
    const midiDuration = midi.duration
    console.log('midi duration:', fmt(midiDuration), ' musicxml performed duration:', fmt(timeline.performedDurationSeconds))
    console.log('midi note count:', midiNotes.length)

    // True measure for a MIDI time (MIDI times are real seconds; measures carry
    // real start/end times). This is where the note actually belongs visually.
    const trueMeasureAtTime = (t) => {
      for (let i = timingMap.measures.length - 1; i >= 0; i -= 1) {
        if (t >= timingMap.measures[i].startTimeSeconds - 1e-6) return timingMap.measures[i]
      }
      return timingMap.measures[0]
    }

    const aligned = mapMidiEventsMeasureAligned(midiNotes, midiDuration, timingMap)
    let wrongMeasure = 0
    let maxScoreErr = 0
    const examples = []
    aligned.events.forEach((ev, idx) => {
      const src = midiNotes[idx]
      const trueM = trueMeasureAtTime(src.time)
      // The score time this note SHOULD have ≈ its real MIDI time (durations match).
      const expectedScore = src.time
      const scoreErr = Math.abs(ev.scoreTimeSeconds - expectedScore)
      maxScoreErr = Math.max(maxScoreErr, scoreErr)
      if (ev.measureNumber !== trueM.number) {
        wrongMeasure += 1
        if (examples.length < 12 && src.time > 18) {
          examples.push(
            `midiT=${fmt(src.time)} ${src.name}: equal-slice→m${ev.measureNumber}@score${fmt(ev.scoreTimeSeconds)} | TRUE→m${trueM.number} (scoreErr=${fmt(scoreErr)})`,
          )
        }
      }
    })
    console.log(`measure-aligned (equal-slice) assigned WRONG measure for ${wrongMeasure}/${aligned.events.length} notes`)
    console.log('max |mappedScore - realMidiTime| =', fmt(maxScoreErr), 's')
    console.log('examples (after tempo change at 18.67s):')
    examples.forEach((e) => console.log('  ' + e))

    // Compute the REAL alignment assessment to learn which mapping the app picks.
    const { computeAlignmentDiagnostics } = await import(
      '../src/features/practice/computeAlignmentDiagnostics.js'
    )
    const allMidi = midi.tracks
      .flatMap((t) => t.notes)
      .map((n) => ({ timeSeconds: n.time, midi: n.midi }))
      .sort((a, b) => a.timeSeconds - b.timeSeconds)
    const midiProfile = {
      noteCount: allMidi.length,
      durationSeconds: midiDuration,
      firstNote: allMidi[0] ?? null,
      notes: allMidi,
      tempos: (midi.header.tempos ?? []).map((t) => ({ bpm: t.bpm, timeSeconds: midi.header.ticksToSeconds(t.ticks) })),
    }
    const diag = computeAlignmentDiagnostics(midiProfile, timingMap)
    console.log('\nREAL alignment assessment:', diag?.assessment)
    console.log('  pitchOverlapAdjusted%:', diag?.pitchOverlapAdjustedPercent, ' durationDelta:', diag?.durationDeltaLabel, ' noteCountDelta:', diag?.noteCountDelta)
    const used = mapMidiEventsToPerformedTimeline(midiNotes, midiDuration, timingMap, diag)
    console.log('  → method the app uses:', used.method, '| warning:', used.warning ?? 'none')

    // Cross-check: with the ACTUAL method, how far are mapped score times from the
    // real MIDI times (which is where the cursor/MusicXML clock expects them)?
    let maxErrUsed = 0
    let sumErrUsed = 0
    used.events.forEach((ev, idx) => {
      const err = Math.abs(ev.scoreTimeSeconds - midiNotes[idx].time)
      maxErrUsed = Math.max(maxErrUsed, err)
      sumErrUsed += err
    })
    console.log('  with actual method: max scoreErr =', fmt(maxErrUsed), 's, mean =', fmt(sumErrUsed / used.events.length), 's')
    console.log('  (scoreErr = |mapped audio time − real MIDI time|; large = audio plays where cursor is NOT)')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
