/**
 * PRIORITY 1 — measure-integrity audit (per-staff/voice, parser-accurate).
 *
 * A measure is correct when EVERY voice (staff on a grand staff, or the single
 * voice on one staff) writes exactly `beats * divisions` of duration. Summing
 * all notes in a measure is wrong for two-staff parts: the LH's full-bar rest
 * legitimately brings the total to 2× a bar.
 *
 * Also verifies:
 *   - a <chord/> note reuses its parent onset's duration (the original
 *     overfull-measure cause)
 *   - no note ends past the parser's own barline for its measure
 *
 * Usage: node --expose-gc scripts/audio-vision-measure-audit.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { readWavPcm } from './lib/readWavPcm.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/measure-audit.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/measure-audit.md')

const manifest = JSON.parse(readFileSync('/tmp/realcorpus/manifest.json', 'utf8'))
const entries = (manifest.entries ?? []).filter((e) => existsSync(e.audio)).slice(0, 10)

async function loadPcm(entry) {
  if (entry.__pcm) return entry.__pcm
  const wav = readWavPcm(entry.audio)
  entry.__pcm = {
    channelData: [Float32Array.from(wav.samples)],
    sampleRate: wav.sampleRate,
    durationSeconds: wav.samples.length / wav.sampleRate,
    channelCount: 1,
  }
  return entry.__pcm
}

const report = { checked: 0, overfullVoices: 0, invalidChordDurations: 0, notesPastBarline: 0, tieErrors: 0, rows: [] }

for (const entry of entries) {
  const pcm = await loadPcm(entry)
  for (const targetPart of ['solo-piano', 'solo-guitar']) {
    const out = await runAudioArrangementPipeline(
      { name: `${entry.id}.wav`, size: 99, type: 'audio/wav' },
      new ArrayBuffer(8),
      { targetPart, difficulty: 'advanced', title: entry.id },
      { decodeAudioDataImpl: async () => pcm, predictNotes: null },
    )
    if (!out.ok) continue
    report.checked += 1

    const divisions = Number(out.musicXml.match(/<divisions>(\d+)</)?.[1] ?? 16)
    const beats = Number(out.musicXml.match(/<beats>(\d+)</)?.[1] ?? 4)
    const nominal = beats * divisions

    // Per-voice written totals, straight from the XML (voice = staff segment).
    let overfullVoices = 0
    let voiceCount = 0
    for (const [, body] of out.musicXml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)) {
      const totals = new Map()
      let voice = 1
      let prevDur = null
      for (const child of body.match(/<note>[\s\S]*?<\/note>|<backup><duration>\d+<\/duration><\/backup>/g) ?? []) {
        if (/<backup>/.test(child)) {
          voice += 1
          prevDur = null
          continue
        }
        const dur = Number(child.match(/<duration>(\d+)</)?.[1] ?? 0)
        if (/<chord\s*\/?>/.test(child)) {
          if (prevDur != null && dur !== prevDur) report.invalidChordDurations += 1
          continue // chords do not advance time
        }
        totals.set(voice, (totals.get(voice) ?? 0) + dur)
        prevDur = dur
        voiceCount += 1
      }
      for (const [, total] of totals) if (total !== nominal) overfullVoices += 1
    }

    // No note ends past its own barline, using the parser's boundaries. A note
    // that is tied (tieStart/tieStop) LEGITIMATATELY crosses a barline — the
    // parser merges the pair into one sounding note — so tied notes are excluded
    // here and checked separately for pair consistency.
    const tm = parseMusicXml(out.musicXml, 'audit.musicxml')
    const starts = (tm.measures ?? []).map((m) => m.startTimeSeconds)
    let pastBarline = 0
    for (const n of tm.notes) {
      if (n.isRest || !starts.length) continue
      if (n.tieStart || n.tieStop) continue
      const idx = starts.findIndex((s, i) => n.timeSeconds >= s - 1e-9 && (i + 1 >= starts.length || n.timeSeconds < starts[i + 1] - 1e-9))
      if (idx < 0) continue
      // Next boundary: the following barline, or this measure's OWN end for the
      // final measure (falling back to the start would flag every note).
      const next = idx + 1 < starts.length
        ? starts[idx + 1]
        : (tm.measures[idx]?.endTimeSeconds ?? starts[idx] + 4 * (60 / (out.transcribed.tempo.bpm || 120)))
      if (n.timeSeconds + n.durationSeconds > next + 1e-6) pastBarline += 1
    }
    // Tie consistency: every tie-start must pair with a same-pitch tie-stop at
    // the adjacent onset, so a tie never dangles or mis-joins.
    let tieErrors = 0
    {
      const sounding = tm.notes.filter((n) => !n.isRest)
      const byKey = new Map()
      for (const n of sounding) {
        const k = `${n.midi}:${n.timeSeconds.toFixed(4)}`
        byKey.set(k, n)
      }
      for (const n of sounding) {
        if (!n.tieStart) continue
        const expectedEnd = n.timeSeconds + n.durationSeconds
        const partner = byKey.get(`${n.midi}:${expectedEnd.toFixed(4)}`)
        if (!partner || !partner.tieStop) tieErrors += 1
      }
      for (const n of sounding) {
        if (!n.tieStop) continue
        const expectedStart = [...sounding].find(
          (o) => o.tieStart && o.midi === n.midi && Math.abs(o.timeSeconds + o.durationSeconds - n.timeSeconds) < 1e-6,
        )
        if (!expectedStart) tieErrors += 1
      }
    }
    report.tieErrors = (report.tieErrors ?? 0) + tieErrors
    report.overfullVoices += overfullVoices
    report.notesPastBarline += pastBarline
    report.rows.push({
      id: entry.id,
      targetPart,
      notes: tm.notes.length,
      measures: tm.measures?.length ?? 0,
      voices: voiceCount,
      overfullVoices,
      notesPastBarline: pastBarline,
    })
    if (overfullVoices || pastBarline) {
      console.log(`INVALID ${entry.id} ${targetPart}: overfullVoices=${overfullVoices} pastBarline=${pastBarline}`)
    }
    if (global.gc) global.gc()
  }
}

writeFileSync(join(root, jsonOut), JSON.stringify(report, null, 2))
const lines = ['# Audio Vision measure-integrity audit (per-voice, parser-accurate)', '',
  `configurations checked: ${report.checked} | overfull voices: ${report.overfullVoices} | notes past barline: ${report.notesPastBarline} | invalid chord durations: ${report.invalidChordDurations}`, '',
  '| recording | part | notes | measures | overfull voices | notes past barline |', '|---|---|---|---|---|---|']
for (const r of report.rows) {
  lines.push(`| ${r.id} | ${r.targetPart} | ${r.notes} | ${r.measures} | ${r.overfullVoices} | ${r.notesPastBarline} |`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log(`\nchecked ${report.checked} configs | overfull voices ${report.overfullVoices} | notes past barline ${report.notesPastBarline} | invalid chord durations ${report.invalidChordDurations}`)
process.exit(report.overfullVoices || report.notesPastBarline || report.invalidChordDurations || report.tieErrors ? 1 : 0)
