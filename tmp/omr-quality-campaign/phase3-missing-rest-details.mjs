#!/usr/bin/env node
/** Characterize aligned missing-rest defects: voice context, durations, gaps. */
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
  evangelion: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.mxl'),
  gymnopedie: join(DOWNLOADS, 'gymnopedie-no-1-satie.mxl'),
  'piano-rhythm-tuplets-vector': join(
    ROOT,
    'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml',
  ),
  'fantaisie-impromptu': join(DOWNLOADS, 'fantaisie-impromptu-in-c-minor-chopin.mxl'),
  'hungarian-dance-no5': join(DOWNLOADS, 'hungarian-dance-no5.mxl'),
  'carol-of-the-bells': join(DOWNLOADS, 'carol-of-the-bells.mxl'),
}

async function readScoreXml(path) {
  const data = await readFile(path)
  if (!path.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const rootPath = container?.match(/full-path="([^"]+)"/)?.[1]
  return zip.file(rootPath).async('string')
}

for (const [id, truthPath] of Object.entries(SOURCES)) {
  const [truthXml, generatedXml, report] = await Promise.all([
    readScoreXml(truthPath),
    readFile(join(ATTEMPT, 'generated', `${id}.musicxml`), 'utf8'),
    readFile(join(ATTEMPT, 'reports', `${id}.json`), 'utf8').then(JSON.parse),
  ])
  const truthNotes = normalizeSemanticNotes(parseMusicXml(truthXml, 't'), {
    includeRests: true,
  })
  const generatedNotes = normalizeSemanticNotes(parseMusicXml(generatedXml, 'g'), {
    includeRests: true,
  })
  const rows = []
  for (const measure of report.measures ?? []) {
    if (measure.alignment !== 'match') continue
    const missing = (measure.defects ?? []).filter((d) => d.code === 'missing-rest')
    if (!missing.length) continue
    const truthMeasureNumber = measure.truthMeasureNumbers[0]
    const generatedMeasureNumber = measure.generatedMeasureNumbers[0]
    const truthMeasure = truthNotes.filter((n) => n.measureNumber === truthMeasureNumber)
    const generatedMeasure = generatedNotes.filter(
      (n) => n.measureNumber === generatedMeasureNumber,
    )
    const truthRests = truthMeasure.filter((n) => n.isRest)
    const generatedRests = generatedMeasure.filter((n) => n.isRest)
    const staffVoices = new Map()
    for (const note of truthMeasure) {
      if (note.isRest) continue
      if (!staffVoices.has(note.staff)) staffVoices.set(note.staff, new Set())
      staffVoices.get(note.staff).add(note.voice)
    }
    const multiVoice = [...staffVoices.values()].some((v) => v.size > 1)
    rows.push({
      m: truthMeasureNumber,
      gm: generatedMeasureNumber,
      multiVoice,
      flags: missing.map((d) => d.message),
      truthRests: truthRests.map(
        (r) => `s${r.staff}v${r.voice}@${r.onsetQuarters.toFixed(2)}x${r.durationQuarters.toFixed(2)}`,
      ),
      generatedRests: generatedRests.map(
        (r) => `s${r.staff}v${r.voice}@${r.onsetQuarters.toFixed(2)}x${r.durationQuarters.toFixed(2)}`,
      ),
    })
  }
  if (!rows.length) continue
  console.log(`\n===== ${id} (${rows.length} aligned measures with missing-rest) =====`)
  const multiVoiceCount = rows.filter((r) => r.multiVoice).length
  console.log(`multi-voice truth measures: ${multiVoiceCount}/${rows.length}`)
  for (const row of rows.slice(0, 14)) {
    console.log(
      ` m${row.m}->g${row.gm}${row.multiVoice ? ' [MV]' : ''} truthRests=[${row.truthRests.join(' ')}] genRests=[${row.generatedRests.join(' ')}] :: ${row.flags.join('; ')}`,
    )
  }
}
