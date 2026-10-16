/**
 * M1 — Chord-root ledger on real MIX recordings.
 *
 * Scores the analysis of the actual MIX (mix.wav) against the simultaneously
 * sounding TRUTH voices of the same mix: at each analyzed chord window, the
 * truth bass (lowest sounding voice) is the most defensible root reference
 * available without a separate chord annotation.
 *   rootAccuracy     : analyzed root == truth lowest-voice root
 *   rootOrFifth      : analyzed root in {root, fifth} (classic bass/root split)
 *   qualityAccuracy  : root+quality both match the truth triad
 *
 * Deliberately conservative and stated as "root vs lowest sounding truth
 * voice", not as absolute chord ground truth. Drift-free MIDI truth only
 * (TRIOS), so the reference itself is not a model output.
 *
 * Usage: node scripts/audio-vision-chord-ledger.mjs [--only substr] [--json p] [--md p]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/chord-ledger.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/chord-ledger.md')
const onlyFilter = argValue('--only', null)

const trios = JSON.parse(readFileSync('/tmp/trios-truth.json', 'utf8')).takes

function soundingAt(notes, seconds) {
  return notes.filter((n) => n.onset <= seconds && (n.offset ?? n.onset + 0.4) > seconds)
}

function truthTriadQuality(voices) {
  if (!voices.length) return null
  const pcs = new Set(voices.map((v) => ((v.midi % 12) + 12) % 12))
  const root = ((Math.min(...voices.map((v) => v.midi)) % 12) + 12) % 12
  const third = pcs.has((root + 4) % 12) ? 'major' : pcs.has((root + 3) % 12) ? 'minor' : null
  if (!third) return null
  return { root, quality: third }
}

const rows = []
for (const [take, data] of Object.entries(trios)) {
  if (onlyFilter && !take.includes(onlyFilter)) continue
  if (!data.mix?.notes?.length) continue
  console.log(`--- ${take} (mix, ${data.mix.notes.length} truth notes)`)
  const wav = readWavPcm(join('/tmp/trios/TRIOS Dataset', take, 'mix.wav'))
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const views = buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, { views: { harmonic: views.harmonic, percussive: views.percussive }, predictNotes: null })
  let rootHit = 0
  let familyHit = 0
  let qualityHit = 0
  let qualityTotal = 0
  let n = 0
  const perWindow = []
  for (const chord of analysis.chords) {
    const midSeconds = (chord.startSeconds + chord.endSeconds) / 2
    const sounding = soundingAt(data.mix.notes, midSeconds)
    if (!sounding.length) continue
    const lowest = Math.min(...sounding.map((s) => s.midi))
    const truthRoot = ((lowest % 12) + 12) % 12
    n += 1
    const rootOk = chord.root === truthRoot
    const familyOk = rootOk || chord.root === (truthRoot + 7) % 12
    if (rootOk) rootHit += 1
    if (familyOk) familyHit += 1
    const truth = truthTriadQuality(sounding)
    if (truth) {
      qualityTotal += 1
      if (chord.root === truth.root && chord.quality === truth.quality) qualityHit += 1
    }
    perWindow.push({
      seconds: Math.round(midSeconds * 10) / 10,
      analyzed: chord.label,
      root: chord.root,
      truthRoot,
      rootOk,
      confidence: chord.confidence,
    })
  }
  const row = {
    take,
    windows: n,
    rootAccuracy: n ? Math.round((rootHit / n) * 1000) / 1000 : null,
    rootOrFifthAccuracy: n ? Math.round((familyHit / n) * 1000) / 1000 : null,
    qualityAccuracy: qualityTotal ? Math.round((qualityHit / qualityTotal) * 1000) / 1000 : null,
    qualityWindows: qualityTotal,
    perWindow,
  }
  rows.push(row)
  console.log(`  windows=${n} root=${row.rootAccuracy} root|5th=${row.rootOrFifthAccuracy} quality=${row.qualityAccuracy}`)
}

writeFileSync(join(root, jsonOut), JSON.stringify({ rows }, null, 2))
const lines = ['# Chord-root ledger (mix analysis vs lowest sounding TRUTH voice)', '',
  '| take | windows | root acc | root or fifth | root+quality |',
  '|---|---|---|---|---|']
for (const r of rows) {
  lines.push(`| ${r.take} | ${r.windows} | ${r.rootAccuracy} | ${r.rootOrFifthAccuracy} | ${r.qualityAccuracy} |`)
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log('done')
