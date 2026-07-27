#!/usr/bin/env node
/**
 * Audit empty generated staves in aligned measures:
 * - fix candidates: truth staff is empty too (whole-measure rest in truth)
 * - regression risk: truth staff has notes (under-detection) — a whole rest
 *   would add an extra-rest defect on top of existing missing-note defects.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { normalizeSemanticNotes } from '../../src/features/omr/semanticMusicXmlEvaluator.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DOWNLOADS = homedir() + '/Downloads'
const ATTEMPT = join(ROOT, 'tmp/omr-quality-campaign/attempts/phase1-primary-beam')

const SOURCES = {
  minecraft: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.mxl'),
  evangelion: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.mxl'),
  gymnopedie: join(DOWNLOADS, 'gymnopedie-no-1-satie.mxl'),
  'piano-articulation-scan': join(ROOT, 'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml'),
  'piano-grand-voices-vector': join(ROOT, 'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml'),
  'piano-rhythm-tuplets-vector': join(ROOT, 'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml'),
  'piano-dense-advanced-vector': join(ROOT, 'benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml'),
  'la-campanella': join(DOWNLOADS, 'etude-s-1413-in-g-minor-la-campanella-liszt.mxl'),
  'fantaisie-impromptu': join(DOWNLOADS, 'fantaisie-impromptu-in-c-minor-chopin.mxl'),
  'moonlight-3': join(DOWNLOADS, 'sonate-no-14-moonlight-3rd-movement.mxl'),
  'hungarian-dance-no5': join(DOWNLOADS, 'hungarian-dance-no5.mxl'),
  'carol-of-the-bells': join(DOWNLOADS, 'carol-of-the-bells.mxl'),
}

async function readScoreXml(path) {
  const data = await readFile(path)
  if (!path.toLowerCase().endsWith('.mxl')) return data.toString('utf8')
  const zip = await JSZip.loadAsync(data)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const rootPath = container?.match(/full-path="([^"]+)"/)?.[1]
  return zip.file(rootPath).async('string')
}

let totalFix = 0
let totalRisk = 0
for (const [id, truthPath] of Object.entries(SOURCES)) {
  const [truthXml, generatedXml, report] = await Promise.all([
    readScoreXml(truthPath),
    readFile(join(ATTEMPT, 'generated', `${id}.musicxml`), 'utf8'),
    readFile(join(ATTEMPT, 'reports', `${id}.json`), 'utf8').then(JSON.parse),
  ])
  const truthNotes = normalizeSemanticNotes(parseMusicXml(truthXml, 't'), { includeRests: true })
  const generatedNotes = normalizeSemanticNotes(parseMusicXml(generatedXml, 'g'), { includeRests: true })
  let fixCandidates = 0
  let riskCandidates = 0
  const riskExamples = []
  for (const measure of report.measures ?? []) {
    if (measure.alignment !== 'match') continue
    if (measure.truthMeasureNumbers?.length !== 1 || measure.generatedMeasureNumbers?.length !== 1) continue
    const tm = measure.truthMeasureNumbers[0]
    const gm = measure.generatedMeasureNumbers[0]
    const truthMeasure = truthNotes.filter((n) => n.measureNumber === tm)
    const generatedMeasure = generatedNotes.filter((n) => n.measureNumber === gm)
    // Skip measures the generator produced nothing at all for.
    if (!generatedMeasure.length) continue
    for (const staff of [1, 2]) {
      const generatedStaff = generatedMeasure.filter((n) => n.staff === staff)
      if (generatedStaff.length > 0) continue
      const truthStaffNotes = truthMeasure.filter((n) => n.staff === staff && !n.isRest)
      const truthStaffRests = truthMeasure.filter((n) => n.staff === staff && n.isRest)
      if (truthStaffNotes.length === 0 && truthStaffRests.length > 0) {
        fixCandidates += 1
      } else if (truthStaffNotes.length > 0) {
        riskCandidates += 1
        if (riskExamples.length < 5) riskExamples.push(`m${tm}->g${gm} s${staff} truthNotes=${truthStaffNotes.length}`)
      }
    }
  }
  totalFix += fixCandidates
  totalRisk += riskCandidates
  if (fixCandidates || riskCandidates) {
    console.log(
      `${id.padEnd(30)} fix-candidates=${String(fixCandidates).padStart(3)} regression-risk=${String(riskCandidates).padStart(3)}`,
      riskExamples.length ? ` risks: ${riskExamples.join(', ')}` : '',
    )
  }
}
console.log(`\nTOTAL fix-candidates=${totalFix} regression-risk=${totalRisk}`)
