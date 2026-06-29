#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { evaluateOmrAccuracy } from '../../../src/features/omr/omrAccuracyEvaluator.js'
import { categorizePitchDeltaSemitones } from '../../../src/features/omr/omrPitchErrorAnalysis.js'

async function readScoreXml(scorePath) {
  const data = readFileSync(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  let rootPath = null
  if (container) {
    const xml = await container.async('string')
    rootPath = xml.match(/full-path="([^"]+)"/)?.[1] ?? null
  }
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
  }
  return zip.file(rootPath).async('string')
}

const generatedMusicXml = readFileSync(
  new URL('./dense-generated.xml', import.meta.url),
  'utf8',
)
const groundTruthMusicXml = await readScoreXml(
  `${process.env.HOME}/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.mxl`,
)

const report = evaluateOmrAccuracy({
  generatedMusicXml,
  groundTruthMusicXml,
  options: { exampleLimit: 99999 },
})

const wrong = report.debug?.wrongPitches ?? []

const hist = {}
const large = { total: 0, octave: 0, other: 0 }
for (const match of wrong) {
  const d = match.pitchDeltaSemitones ?? 0
  const cat = categorizePitchDeltaSemitones(d)
  hist[cat] = (hist[cat] ?? 0) + 1
  const mag = Math.abs(d)
  if (mag >= 12) {
    large.total += 1
    if (mag === 12 || mag === 24 || mag === 36) {
      large.octave += 1
    } else {
      large.other += 1
    }
  }
}

console.log('wrong pitch count', wrong.length)
console.log('histogram', hist)
console.log('large interval (>=12 semitones)', large)
console.log('sample large errors:')
for (const match of wrong.filter((m) => Math.abs(m.pitchDeltaSemitones) >= 12).slice(0, 15)) {
  console.log(
    `  m${match.truth?.measureNumber} truth=${match.truth?.label} gen=${match.generated?.label} d=${match.pitchDeltaSemitones}`,
  )
}
