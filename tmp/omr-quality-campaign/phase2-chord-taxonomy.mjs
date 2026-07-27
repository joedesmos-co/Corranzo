#!/usr/bin/env node
/**
 * Phase 2 chord-defect taxonomy rebuild.
 *
 * Recomputes the evaluator's own chord-integrity buckets per 1:1 aligned
 * measure (read-only reuse of matchSemanticEvents/summarizeChordIntegrity),
 * then reclassifies every mismatch example into structural vs non-structural
 * causes:
 *
 * - pitch-substitution: equal tone counts with midi substitutions (pitch
 *   recognition, not structure)
 * - missing-tone: lost midi absent from the entire generated measure (note
 *   detection loss)
 * - extra-tone: gained midi absent from the truth measure (false detection)
 * - sequentialized-candidate: lost midi present in the generated measure at a
 *   different onset — potential REAL chord-structure defect
 * - merged-candidate: gained midi present in the truth measure at a different
 *   onset — potential REAL structure defect
 * - voice-ownership: same midis at the same onset but in a different
 *   staff/voice bucket
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { normalizeSemanticNotes } from '../../src/features/omr/semanticMusicXmlEvaluator.js'
import {
  matchSemanticEvents,
  summarizeChordIntegrity,
} from '../../src/features/omr/semanticEventMatching.js'

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

function multisetDiff(left, right) {
  const counts = new Map()
  for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1)
  for (const value of right) counts.set(value, (counts.get(value) ?? 0) - 1)
  const onlyLeft = []
  const onlyRight = []
  for (const [value, count] of counts) {
    for (let i = 0; i < count; i += 1) onlyLeft.push(value)
    for (let i = 0; i < -count; i += 1) onlyRight.push(value)
  }
  return { onlyLeft, onlyRight }
}

function classifyExample(example, truthNotes, generatedNotes) {
  const { onlyLeft: lostMidis, onlyRight: gainedMidis } = multisetDiff(
    example.truth ?? [],
    example.generated ?? [],
  )
  // Bucket key is staff|voice|round(onset / chordOnsetToleranceQuarters=0.08)
  const onsetBucketQuarters = Number(String(example.key ?? '').split('|')[2]) * 0.08

  if (!lostMidis.length && !gainedMidis.length) {
    return 'voice-ownership'
  }
  if (lostMidis.length && lostMidis.length === gainedMidis.length) {
    return 'pitch-substitution'
  }
  const classifications = new Set()
  for (const midi of lostMidis) {
    const sameOnsetOtherLane = generatedNotes.some(
      (note) =>
        note.midi === midi && Math.abs(note.onsetQuarters - onsetBucketQuarters) <= 0.125,
    )
    if (sameOnsetOtherLane) {
      classifications.add('voice-ownership')
      continue
    }
    const elsewhere = generatedNotes.some((note) => note.midi === midi)
    classifications.add(elsewhere ? 'sequentialized-candidate' : 'missing-tone')
  }
  for (const midi of gainedMidis) {
    const truthSameOnsetOtherLane = truthNotes.some(
      (note) =>
        note.midi === midi && Math.abs(note.onsetQuarters - onsetBucketQuarters) <= 0.125,
    )
    if (truthSameOnsetOtherLane) {
      classifications.add('voice-ownership')
      continue
    }
    const truthElsewhere = truthNotes.some((note) => note.midi === midi)
    classifications.add(truthElsewhere ? 'merged-candidate' : 'extra-tone')
  }
  if (classifications.size === 1) {
    return [...classifications][0]
  }
  return [...classifications].sort().join('+')
}

async function main() {
  const totals = new Map()
  const structuralDetails = []
  let totalExamples = 0
  let multiVoiceExamples = 0
  for (const [id, truthPath] of Object.entries(SOURCES)) {
    const [truthXml, generatedXml, report] = await Promise.all([
      readScoreXml(truthPath),
      readFile(join(ATTEMPT, 'generated', `${id}.musicxml`), 'utf8'),
      readFile(join(ATTEMPT, 'reports', `${id}.json`), 'utf8').then(JSON.parse),
    ])
    const truthNotes = normalizeSemanticNotes(parseMusicXml(truthXml, 'truth'), {
      includeRests: false,
    })
    const generatedNotes = normalizeSemanticNotes(
      parseMusicXml(generatedXml, 'generated'),
      { includeRests: false },
    )
    const perSource = new Map()
    for (const measure of report.measures ?? []) {
      if (
        measure.alignment !== 'match' ||
        measure.truthMeasureNumbers?.length !== 1 ||
        measure.generatedMeasureNumbers?.length !== 1
      ) {
        continue
      }
      const truthMeasureNotes = truthNotes.filter(
        (note) => note.measureNumber === measure.truthMeasureNumbers[0],
      )
      const generatedMeasureNotes = generatedNotes.filter(
        (note) => note.measureNumber === measure.generatedMeasureNumbers[0],
      )
      const matched = matchSemanticEvents(truthMeasureNotes, generatedMeasureNotes, {})
      const chord = summarizeChordIntegrity(
        matched.matches,
        matched.missing,
        matched.extra,
        {},
      )
      const truthStaffVoices = new Map()
      for (const note of truthMeasureNotes) {
        if (!truthStaffVoices.has(note.staff)) truthStaffVoices.set(note.staff, new Set())
        truthStaffVoices.get(note.staff).add(note.voice)
      }
      const measureIsMultiVoice = [...truthStaffVoices.values()].some(
        (voices) => voices.size > 1,
      )
      for (const example of chord.examples) {
        totalExamples += 1
        if (measureIsMultiVoice) multiVoiceExamples += 1
        const kind = classifyExample(example, truthMeasureNotes, generatedMeasureNotes)
        perSource.set(kind, (perSource.get(kind) ?? 0) + 1)
        totals.set(kind, (totals.get(kind) ?? 0) + 1)
        if (kind.includes('sequentialized') || kind.includes('merged')) {
          const span = (notes) =>
            notes.reduce(
              (max, note) => Math.max(max, note.onsetQuarters + note.durationQuarters),
              0,
            )
          const truthSpan = span(truthMeasureNotes)
          const generatedSpan = span(generatedMeasureNotes)
          structuralDetails.push({
            id,
            truthMeasure: measure.truthMeasureNumbers[0],
            generatedMeasure: measure.generatedMeasureNumbers[0],
            key: example.key,
            truth: example.truth,
            generated: example.generated,
            kind,
            truthSpan: Number(truthSpan.toFixed(2)),
            generatedSpan: Number(generatedSpan.toFixed(2)),
            spanMismatch: Math.abs(truthSpan - generatedSpan) > 0.125,
          })
        }
      }
    }
    if (perSource.size) {
      console.log(`${id}:`, JSON.stringify(Object.fromEntries([...perSource].sort())))
    }
  }
  console.log('\nTOTAL incorrect-chord examples:', totalExamples)
  console.log('examples in truth-multi-voice measures:', multiVoiceExamples)
  console.log('TOTALS BY CLASS:', JSON.stringify(Object.fromEntries([...totals].sort()), null, 1))
  console.log('\nstructural candidates:', structuralDetails.length)
  for (const detail of structuralDetails) {
    console.log(' ', JSON.stringify(detail))
  }
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
