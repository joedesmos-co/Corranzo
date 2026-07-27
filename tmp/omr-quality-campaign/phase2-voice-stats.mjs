#!/usr/bin/env node
/** Count staff/voice usage in truth vs generated across the 12 campaign sources. */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { normalizeSemanticNotes } from '../../src/features/omr/semanticMusicXmlEvaluator.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DOWNLOADS = join(homedir(), 'Downloads')
const ATTEMPT = join(ROOT, 'tmp/omr-quality-campaign/attempts/phase1-primary-beam')

const SOURCES = {
  minecraft: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.mxl'),
  evangelion: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.mxl'),
  gymnopedie: join(DOWNLOADS, 'gymnopedie-no-1-satie.mxl'),
  'piano-articulation-scan': join(
    ROOT,
    'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml',
  ),
  'piano-grand-voices-vector': join(
    ROOT,
    'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml',
  ),
  'piano-rhythm-tuplets-vector': join(
    ROOT,
    'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml',
  ),
  'piano-dense-advanced-vector': join(
    ROOT,
    'benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml',
  ),
  'la-campanella': join(DOWNLOADS, 'etude-s-1413-in-g-minor-la-campanella-liszt.mxl'),
  'fantaisie-impromptu': join(DOWNLOADS, 'fantaisie-impromptu-in-c-minor-chopin.mxl'),
  'moonlight-3': join(DOWNLOADS, 'sonate-no-14-moonlight-3rd-movement.mxl'),
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

function voiceStats(notes) {
  // A staff is "multi-voice" in a measure when 2+ voices sound notes there.
  const byMeasureStaff = new Map()
  for (const note of notes) {
    if (note.isRest) continue
    const key = `${note.measureNumber}|${note.staff}`
    if (!byMeasureStaff.has(key)) byMeasureStaff.set(key, new Set())
    byMeasureStaff.get(key).add(note.voice)
  }
  let multiVoiceMeasureStaffs = 0
  for (const voices of byMeasureStaff.values()) {
    if (voices.size > 1) multiVoiceMeasureStaffs += 1
  }
  return { measureStaffs: byMeasureStaff.size, multiVoiceMeasureStaffs }
}

for (const [id, truthPath] of Object.entries(SOURCES)) {
  const truthXml = await readScoreXml(truthPath)
  const generatedXml = await readFile(join(ATTEMPT, 'generated', `${id}.musicxml`), 'utf8')
  const truthNotes = normalizeSemanticNotes(parseMusicXml(truthXml, 't'), { includeRests: false })
  const generatedNotes = normalizeSemanticNotes(parseMusicXml(generatedXml, 'g'), { includeRests: false })
  const truthStats = voiceStats(truthNotes)
  const generatedStats = voiceStats(generatedNotes)
  console.log(
    `${id.padEnd(30)} truth ${String(truthStats.multiVoiceMeasureStaffs).padStart(3)}/${String(truthStats.measureStaffs).padStart(3)} multi-voice staff-measures | generated ${String(generatedStats.multiVoiceMeasureStaffs).padStart(3)}/${String(generatedStats.measureStaffs).padStart(3)}`,
  )
}
