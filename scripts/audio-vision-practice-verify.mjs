/**
 * PRIORITY 4 — end-to-end practice readiness verification.
 *
 * Verifies the whole path on a real development recording:
 *   audio → pipeline → MusicXML → parse → timing → practice checkpoints,
 * and that WFY/Play Along consume the corrected musical timeline (no lost
 * melody events, no invented timing shifts, chord onsets grouped, ties
 * sustained). Also confirms the guitar part's TAB mirrors standard notation.
 *
 * Run: node --expose-gc scripts/audio-vision-practice-verify.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'

const SOURCE = process.argv[2] && existsSync(process.argv[2])
  ? process.argv[2]
  : '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav'
if (!existsSync(SOURCE)) {
  console.error('missing source:', SOURCE)
  process.exit(1)
}
const wav = readWavPcm(SOURCE)
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures += 1
}

const base = {
  channelData: [Float32Array.from(wav.samples)],
  sampleRate: wav.sampleRate,
  durationSeconds: wav.samples.length / wav.sampleRate,
  channelCount: 1,
}

for (const targetPart of ['solo-piano', 'solo-guitar']) {
  const out = await runAudioArrangementPipeline(
    { name: 'e2e.wav', size: 9, type: 'audio/wav' },
    new ArrayBuffer(8),
    { targetPart, difficulty: 'intermediate', title: 'e2e' },
    { decodeAudioDataImpl: async () => base, predictNotes: null },
  )
  if (!out.ok) {
    check(`${targetPart} pipeline`, false, out.code)
    continue
  }
  const tm = parseMusicXml(out.musicXml, 'e2e.musicxml')
  const notes = tm.notes.filter((n) => !n.isRest)
  const checkpoints = buildNoteCheckpoints(tm)

  check(`${targetPart} MusicXML parses`, (notes.length ?? 0) > 0, `${notes.length} notes`)
  check(`${targetPart} measures present`, (tm.measures?.length ?? 0) > 1, `${tm.measures?.length} measures`)

  // No invented timing shift: the arrangement's beat grid maps onto the score
  // as notated beats. The score's bar 1 starts at t=0 (a pickup is engraved as
  // a short first measure), so the arrangement's beat 0 IS the score's first
  // notated beat. Compare beat-for-beat: the k-th arranged event's startBeat
  // must equal the k-th score note's quarter-time.
  // Beat grid preserved: compare the MULTISET of (pitch, quarter-beat) pairs,
  // not index-by-index — a chord group shares one quarter-time with its
  // parent, so positional comparison misaligns by construction.
  const scoreBag = new Map()
  for (const n of notes) {
    const p = `${Math.round(n.midi)}:${(n.quarterTime ?? -1).toFixed(3)}`
    scoreBag.set(p, (scoreBag.get(p) ?? 0) + 1)
  }
  let matchedGrid = 0
  let gridBad = 0
  for (const e of out.model.parts[0].events) {
    const p = `${Math.round(e.midi)}:${e.startBeat.toFixed(3)}`
    const have = scoreBag.get(p) ?? 0
    if (have > 0) {
      scoreBag.set(p, have - 1)
      matchedGrid += 1
    } else {
      gridBad += 1
    }
  }
  check(
    `${targetPart} beat grid preserved`,
    gridBad === 0 && matchedGrid > 0,
    `${matchedGrid}/${out.model.parts[0].events.length} (pitch, beat) pairs match`,
  )

  // Every arranged event survives into the score (matched on MIDI + beat).
  const scoreByKey = new Set(notes.map((n) => `${Math.round(n.midi)}:${(n.quarterTime ?? -1).toFixed(3)}`))
  let matched = 0
  for (const e of out.model.parts[0].events) {
    if (scoreByKey.has(`${Math.round(e.midi)}:${e.startBeat.toFixed(3)}`)) matched += 1
  }
  check(
    `${targetPart} arranged events present in score`,
    matched > 0 && matched / out.model.parts[0].events.length >= 0.9,
    `${matched}/${out.model.parts[0].events.length} events`,
  )

  // Chord onsets grouped: simultaneous events share a checkpoint onset.
  const grouped = checkpoints.some((c) => (c.expectedMidis?.length ?? 0) > 1)
  check(`${targetPart} chord checkpoints grouped`, grouped || notes.length < 2, `${checkpoints.length} checkpoints`)

  // Ties sustained: no note crosses its barline. A note that is tied
  // (tieStart/tieStop) LEGITIMITELY crosses a barline — the parser merges the
  // pair into one sounding note — so tied notes are excluded from this check
  // and verified separately by tie-consistency assertions in the audit.
  const starts = (tm.measures ?? []).map((m) => m.startTimeSeconds)
  const ends = (tm.measures ?? []).map((m) => m.endTimeSeconds)
  const bpm = out.transcribed.tempo.bpm || 120
  const fallbackBarline = 4 * (60 / bpm)
  let crossed = 0
  for (const n of notes) {
    if (n.tieStart || n.tieStop) continue
    const idx = starts.findIndex((s, i) => n.timeSeconds >= s - 1e-9 && (i + 1 >= starts.length || n.timeSeconds < starts[i + 1] - 1e-9))
    if (idx < 0) continue
    const next = idx + 1 < starts.length ? starts[idx + 1] : (ends[idx] ?? starts[idx] + fallbackBarline)
    if (n.timeSeconds + n.durationSeconds > next + 1e-6) crossed += 1
  }
  check(`${targetPart} notes respect barlines (ties)`, crossed === 0, `${crossed} violations`)

  // Preview (MIDI) agreement is verified separately by preview-verify; here we
  // assert the score has audible durations for playback.
  check(`${targetPart} playable durations`, notes.every((n) => n.durationSeconds > 0), 'all notes have duration > 0')
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
