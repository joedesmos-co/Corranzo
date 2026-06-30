#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import JSZip from 'jszip'
import { evaluateOmrAccuracy } from '../src/features/omr/omrAccuracyEvaluator.js'
import { categorizeDurationError } from '../src/features/omr/omrDurationErrorAnalysis.js'

async function readMxl(path) {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const container = await zip.file('META-INF/container.xml')?.async('string')
  let root = container?.match(/full-path="([^"]+)"/)?.[1]
  if (!root) {
    root = Object.keys(zip.files).find((entry) => entry.endsWith('.xml') && !entry.startsWith('META-INF/'))
  }
  return zip.file(root).async('string')
}

const generatedPath = process.argv[2] ?? 'tmp/omr-benchmark-iter/rhythm-voice/dense-generated.xml'
const truthPath = `${process.env.HOME}/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl`
const outPath = process.argv[3] ?? 'tmp/omr-benchmark-iter/rhythm-voice2/baseline-duration-analysis.json'

const report = evaluateOmrAccuracy({
  generatedMusicXml: readFileSync(generatedPath, 'utf8'),
  groundTruthMusicXml: await readMxl(truthPath),
  generatedFileName: generatedPath,
  groundTruthFileName: truthPath,
  options: { exampleLimit: 99999 },
})

const wrong = report.debug?.wrongDurations ?? []
const onsetOk = wrong.filter((entry) => Math.abs(entry.onsetDiffQuarters ?? 0) <= 0.2)
const histogram = {}
const signed = {}
for (const entry of onsetOk) {
  const category = categorizeDurationError(entry)
  histogram[category] = (histogram[category] ?? 0) + 1
  const key = String(Math.round((entry.durationDiffQuarters ?? 0) * 100) / 100)
  signed[key] = (signed[key] ?? 0) + 1
}

const fmt = (entry) =>
  `${entry.truth?.label ?? '?'}@${entry.truth?.onsetQuarters ?? '?'}/${entry.truth?.durationQuarters ?? '?'} -> ${entry.generated?.label ?? '?'}@${entry.generated?.onsetQuarters ?? '?'}/${entry.generated?.durationQuarters ?? '?'}`

const payload = {
  metrics: report.metrics,
  totals: report.totals,
  onsetCorrectWrongCount: onsetOk.length,
  histogram,
  signed,
  quarterToEighth: onsetOk
    .filter(
      (entry) =>
        Math.abs((entry.truth?.durationQuarters ?? 0) - 1) < 0.01 &&
        Math.abs((entry.generated?.durationQuarters ?? 0) - 0.5) < 0.01,
    )
    .slice(0, 20)
    .map((entry) => ({ measure: entry.measureNumber, detail: fmt(entry), pitchDelta: entry.pitchDeltaSemitones })),
  tooLong: onsetOk
    .filter((entry) => (entry.durationDiffQuarters ?? 0) < -0.2)
    .slice(0, 20)
    .map((entry) => ({
      measure: entry.measureNumber,
      delta: entry.durationDiffQuarters,
      detail: fmt(entry),
    })),
}

mkdirSync('tmp/omr-benchmark-iter/rhythm-voice2', { recursive: true })
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
console.log(JSON.stringify(payload, null, 2))
