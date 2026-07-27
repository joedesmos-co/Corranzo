#!/usr/bin/env node
/** Dump aligned truth vs generated note events for one measure of one source. */
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

const [, , id, truthMeasureArg, generatedMeasureArg] = process.argv
const truthMeasure = Number(truthMeasureArg)
const generatedMeasure = Number(generatedMeasureArg ?? truthMeasureArg)

const truthXml = await readScoreXml(SOURCES[id])
const generatedXml = await readFile(join(ATTEMPT, 'generated', `${id}.musicxml`), 'utf8')

function dump(label, xml, sourceId, measureNumber) {
  const notes = normalizeSemanticNotes(parseMusicXml(xml, sourceId), {
    includeRests: true,
  }).filter((note) => note.measureNumber === measureNumber)
  console.log(`\n=== ${label} m${measureNumber} (${notes.length} events) ===`)
  for (const note of notes) {
    console.log(
      `  s${note.staff} v${note.voice} onset=${note.onsetQuarters.toFixed(2)} ` +
        `dur=${note.durationQuarters.toFixed(2)} ` +
        (note.isRest ? 'REST' : `midi=${note.midi} (${note.label})`) +
        (note.isChord ? ' [chord]' : ''),
    )
  }
}

dump('TRUTH', truthXml, 'truth', truthMeasure)
dump('GENERATED', generatedXml, 'generated', generatedMeasure)
