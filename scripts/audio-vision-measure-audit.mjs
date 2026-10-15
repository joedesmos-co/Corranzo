/**
 * PRIORITY 1 — measure-integrity audit (parser-accurate).
 *
 * A regex walk of the XML over-counts chord notes (a <chord/> note does not
 * advance time) and mis-tracks <backup>, so it reports measures as overfull
 * that are valid. This audit uses the app's own parser plus a duration check
 * that mirrors what Score Following / OSMD compute:
 *
 *   1. no note extends past its own barline
 *   2. every chord note reuses its parent onset's duration (invalid MusicXML
 *      otherwise, and the cause of the original overfull-measure reports)
 *
 * Usage: node --expose-gc scripts/audio-vision-measure-audit.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/measure-audit.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/measure-audit.md')

const manifest = JSON.parse(readFileSync('/tmp/realcorpus/manifest.json', 'utf8'))
const entries = (manifest.entries ?? []).filter((e) => existsSync(e.audio))

/** Generate audio for one entry once, then reuse it for every config. */
async function loadPcm(entry) {
  if (entry.__pcm) return entry.__pcm
  const { readWavPcm } = await import('./lib/readWavPcm.mjs')
  const wav = readWavPcm(entry.audio)
  entry.__pcm = {
    channelData: [Float32Array.from(wav.samples)],
    sampleRate: wav.sampleRate,
    durationSeconds: wav.samples.length / wav.sampleRate,
    channelCount: 1,
  }
  return entry.__pcm
}

const report = { checked: 0, invalidChordDurations: 0, notesPastBarline: 0, rows: [] }
for (const entry of entries.slice(0, 10)) {
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
    const tm = parseMusicXml(out.musicXml, 'audit.musicxml')
    // Use the PARSER's own measure boundaries, not a barline recomputed from the
    // BPM: rounding 86 vs 84 BPM accumulates and falsely reports overflow.
    const starts = (tm.measures ?? []).map((m) => m.startTimeSeconds)
    let pastBarline = 0
    for (const n of tm.notes) {
      if (n.isRest || !starts.length) continue
      const idx = starts.findIndex((s, i) => n.timeSeconds >= s - 1e-9 && (i + 1 >= starts.length || n.timeSeconds < starts[i + 1] - 1e-9))
      if (idx < 0) continue
      const next = idx + 1 < starts.length ? starts[idx + 1] : starts[idx] + 4 * (60 / (out.transcribed.tempo.bpm || 120))
      if (n.timeSeconds + n.durationSeconds > next + 1e-6) pastBarline += 1
    }
    let badChords = 0
    let prevDur = null
    for (const [, body] of out.musicXml.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
      const dur = Number(body.match(/<duration>(\d+)</)?.[1] ?? 0)
      if (/<chord\/>/.test(body)) {
        if (prevDur != null && dur !== prevDur) badChords += 1
      } else {
        prevDur = dur
      }
    }
    report.invalidChordDurations += badChords
    report.notesPastBarline += pastBarline
    report.rows.push({
      id: entry.id,
      targetPart,
      notes: tm.notes.length,
      notesPastBarline: pastBarline,
      invalidChordDurations: badChords,
    })
    if (badChords || pastBarline) {
      console.log(`INVALID ${entry.id} ${targetPart}: pastBarline=${pastBarline} badChords=${badChords}`)
    }
    if (global.gc) global.gc()
  }
}

writeFileSync(join(root, jsonOut), JSON.stringify(report, null, 2))
const lines = ['# Audio Vision measure-integrity audit (parser-accurate)', '',
  `configurations checked: ${report.checked} | notes past barline: ${report.notesPastBarline} | invalid chord durations: ${report.invalidChordDurations}`, '',
  '| recording | part | notes | notes past barline | invalid chord durations |', '|---|---|---|---|---|']
for (const r of report.rows) {
  lines.push(`| ${r.id} | ${r.targetPart} | ${r.notes} | ${r.notesPastBarline} | ${r.invalidChordDurations} |`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log(`\nchecked ${report.checked} configs | notes past barline ${report.notesPastBarline} | invalid chord durations ${report.invalidChordDurations}`)
process.exit(report.notesPastBarline || report.invalidChordDurations ? 1 : 0)
