/**
 * #2/#3 — Bar-aligned chord ledger with per-failure attribution.
 *
 * GuitarSet JAMS chord labels are exactly bar-aligned (one 4-beat bar each),
 * so each label is a MEASURE-level ground truth. The analyzer's per-beat chord
 * estimates are aggregated per bar (majority vote), and every disagreement is
 * attributed to one cause:
 *
 *   segmentation : the analyzer changed chords strictly inside the bar (so its
 *                  own estimates disagree with each other, and no single
 *                  estimate covers the bar)
 *   root-only        root wrong, quality right
 *   quality-only     root right, quality wrong
 *   both             root and quality wrong
 *   missed           no chord estimate covered the bar at all
 *
 * Bass evidence is separate: the analyzer's per-frame bass pitch class is
 * compared to the label root, to distinguish "bass confusion" (the bass was
 * heard but was not the root) from "no bass evidence".
 *
 * Usage: node --expose-gc scripts/audio-vision-bar-ledger.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
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
const jsonOut = argValue('--json', 'benchmarks/audio-vision/bar-ledger.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/bar-ledger.md')
const manifest = JSON.parse(readFileSync('/tmp/realcorpus/manifest.json', 'utf8'))

function pc(midi) {
  return ((midi % 12) + 12) % 12
}

const QUALITY_ALIAS = {
  major: 'major', minor: 'minor', major7: 'major7', minor7: 'minor7',
  dominant7: 'dominant7', diminished: 'diminished', suspended4: 'suspended4',
}
// What our analyzer can say vs what JAMS labels look like: JAMS uses maj/min/m7/
// maj7/7 etc. Our analyzer outputs major/minor/major7/minor7/dominant7/...
// Compare root always; compare quality only when the label's quality is one we
// can express (maj/min/maj7/min7/7).
function labelQualityKind(label) {
  const m = String(label).match(/^[A-G][#b]?:([a-z0-9]+)/)
  const q = m ? m[1] : 'maj'
  return q
}

const rows = []
for (const entry of manifest.entries) {
  if (!entry.truthBars?.length) continue
  console.log(`--- ${entry.id} (${entry.truthBars.length} bars)`)
  const wav = readWavPcm(entry.audio)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bpOut = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const views = buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: async () => bpOut.notes.map((n) => ({
      midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude,
    })),
  })

  const counts = {
    bars: 0,
    rootHit: 0,
    qualityHit: 0,
    bothHit: 0,
    missed: 0,
    segmentation: 0,
    rootOnly: 0,
    qualityOnly: 0,
    bothWrong: 0,
    bassEvidencePresent: 0,
    bassAgreesWithRoot: 0,
  }
  const perBar = []
  for (const bar of entry.truthBars) {
    counts.bars += 1
    const inBar = analysis.chords.filter((c) => c.startSeconds < bar.endSeconds - 1e-9 && c.endSeconds > bar.startSeconds + 1e-9)
    if (!inBar.length) {
      counts.missed += 1
      perBar.push({ measure: bar.measure, label: bar.label, verdict: 'missed' })
      continue
    }
    // Majority vote among estimates covering this bar (by duration).
    const tally = new Map()
    for (const c of inBar) {
      const overlap = Math.min(c.endSeconds, bar.endSeconds) - Math.max(c.startSeconds, bar.startSeconds)
      const key = `${c.root}:${c.quality}`
      tally.set(key, (tally.get(key) ?? 0) + Math.max(0, overlap))
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    const [bestRoot, bestQuality] = best[0].split(':').map((v, i) => (i === 0 ? Number(v) : v))
    const distinct = new Set(inBar.map((c) => `${c.root}:${c.quality}`)).size

    // Bass evidence inside the bar.
    const bassFrames = analysis.bassLine.filter((b) => b.seconds >= bar.startSeconds && b.seconds < bar.endSeconds)
    const bassPcs = new Map()
    for (const b of bassFrames) {
      const p = pc(b.midi)
      bassPcs.set(p, (bassPcs.get(p) ?? 0) + 1)
    }
    const dominantBass = [...bassPcs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (dominantBass != null) {
      counts.bassEvidencePresent += 1
      if (dominantBass === bar.root) counts.bassAgreesWithRoot += 1
    }

    const rootOk = bestRoot === bar.root
    const qualityKind = labelQualityKind(bar.label)
    const comparable = ['maj', 'min', 'maj7', 'min7', '7', 'm7'].includes(qualityKind)
    const expectedQuality = {
      maj: 'major', min: 'minor', maj7: 'major7', min7: 'minor7', m7: 'minor7', 7: 'dominant7',
    }[qualityKind]
    const qualityOk = comparable && (QUALITY_ALIAS[bestQuality] ?? bestQuality) === expectedQuality
    const verdict = distinct > 1 ? 'segmentation' : (rootOk && qualityOk ? 'both' : (rootOk ? 'qualityOnly' : (qualityOk ? 'rootOnly' : 'bothWrong')))
    if (distinct > 1) counts.segmentation += 1
    if (rootOk) counts.rootHit += 1
    if (qualityOk) counts.qualityHit += 1
    if (rootOk && qualityOk) counts.bothHit += 1
    if (verdict === 'qualityOnly') counts.qualityOnly += 1
    if (verdict === 'rootOnly') counts.rootOnly += 1
    if (verdict === 'bothWrong') counts.bothWrong += 1
    perBar.push({
      measure: bar.measure,
      label: bar.label,
      chosen: `${bestRoot}/${bestQuality}`,
      distinctEstimates: distinct,
      dominantBassPc: dominantBass ?? null,
      verdict,
    })
  }
  const r = {
    id: entry.id,
    bars: counts.bars,
    rootAccuracy: Math.round((counts.rootHit / Math.max(1, counts.bars)) * 1000) / 1000,
    qualityAccuracy: Math.round((counts.qualityHit / Math.max(1, counts.bars)) * 1000) / 1000,
    rootAndQualityAccuracy: Math.round((counts.bothHit / Math.max(1, counts.bars)) * 1000) / 1000,
    missedBars: counts.missed,
    segmentationBars: counts.segmentation,
    rootOnlyBars: counts.rootOnly,
    qualityOnlyBars: counts.qualityOnly,
    bothWrongBars: counts.bothWrong,
    bassEvidenceBars: counts.bassEvidencePresent,
    bassAgreesWithRootBars: counts.bassAgreesWithRoot,
    bassEvidenceRate: Math.round((counts.bassEvidencePresent / Math.max(1, counts.bars)) * 1000) / 1000,
    bassRootAgreement: counts.bassEvidencePresent ? Math.round((counts.bassAgreesWithRoot / counts.bassEvidencePresent) * 1000) / 1000 : null,
    perBar,
  }
  rows.push(r)
  console.log(`  bars=${r.bars} root=${r.rootAccuracy} quality=${r.qualityAccuracy} both=${r.rootAndQualityAccuracy} missed=${r.missedBars} segmentation=${r.segmentationBars} rootOnly=${r.rootOnlyBars} qualityOnly=${r.qualityOnlyBars} bothWrong=${r.bothWrongBars}`)
  console.log(`  bass evidence on ${r.bassEvidenceBars}/${r.bars} bars; bass agrees with label root ${r.bassRootAgreement}`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

const totals = rows.reduce((acc, r) => {
  for (const k of ['bars', 'missedBars', 'segmentationBars', 'rootOnlyBars', 'qualityOnlyBars', 'bothWrongBars', 'bassEvidenceBars', 'bassAgreesWithRootBars']) acc[k] += r[k]
  return acc
}, { bars: 0, missedBars: 0, segmentationBars: 0, rootOnlyBars: 0, qualityOnlyBars: 0, bothWrongBars: 0, bassEvidenceBars: 0, bassAgreesWithRootBars: 0 })

writeFileSync(join(root, jsonOut), JSON.stringify({ rows, totals }, null, 2))
const lines = ['# Bar-aligned chord ledger (GuitarSet JAMS, measure-level truth)', '',
  `bars=${totals.bars} · root=weighted below`, '',
  '| recording | bars | root | quality | both | missed | segmentation | rootOnly | qualityOnly | bothWrong | bass evidence | bass=root |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|']
let weightedRoot = 0
let weightedQuality = 0
let weightedBoth = 0
for (const r of rows) {
  weightedRoot += r.rootAccuracy * r.bars
  weightedQuality += r.qualityAccuracy * r.bars
  weightedBoth += r.rootAndQualityAccuracy * r.bars
  lines.push(`| ${r.id} | ${r.bars} | ${r.rootAccuracy} | ${r.qualityAccuracy} | ${r.rootAndQualityAccuracy} | ${r.missedBars} | ${r.segmentationBars} | ${r.rootOnlyBars} | ${r.qualityOnlyBars} | ${r.bothWrongBars} | ${r.bassEvidenceRate} | ${r.bassRootAgreement ?? '—'} |`)
}
const n = Math.max(1, totals.bars)
lines.push('', `**Weighted**: root=${(weightedRoot / n).toFixed(3)} quality=${(weightedQuality / n).toFixed(3)} both=${(weightedBoth / n).toFixed(3)}`)
lines.push('', `**Attribution (bars)**: missed=${totals.missedBars} segmentation=${totals.segmentationBars} rootOnly=${totals.rootOnlyBars} qualityOnly=${totals.qualityOnlyBars} bothWrong=${totals.bothWrongBars}`)
lines.push('', `**Bass**: evidence on ${totals.bassEvidenceBars} bars; agrees with label root on ${totals.bassAgreesWithRootBars} (${totals.bassEvidenceBars ? Math.round((100 * totals.bassAgreesWithRootBars) / totals.bassEvidenceBars) : 0}% of bars with evidence)`)
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log(`\nTOTAL bars=${totals.bars} root=${(weightedRoot / n).toFixed(3)} quality=${(weightedQuality / n).toFixed(3)} both=${(weightedBoth / n).toFixed(3)}`)
console.log('done')
