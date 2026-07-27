#!/usr/bin/env node
/**
 * Phase 1 acceptance-audit drill-down.
 *
 * Identifies, per source:
 * - every false-beamed note pair (truth unbeamed, candidate beamed)
 * - every remaining beam mismatch signature pair
 * - dot changes among matched pairs (baseline vs candidate vs truth)
 * - written duration-type changes between baseline and candidate
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DOWNLOADS = join(homedir(), 'Downloads')
const CAMPAIGN = join(ROOT, 'tmp/omr-quality-campaign')

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

function normalizedBeamValue(value) {
  return String(value ?? '')
    .replace('forward hook', 'forward-hook')
    .replace('backward hook', 'backward-hook')
}

function beamSignature(note) {
  return JSON.stringify(
    (note.beams ?? []).map((beam) => [Number(beam.number ?? 1), normalizedBeamValue(beam.value)]),
  )
}

function notesForMeasure(score, measure) {
  return score.notes
    .filter(
      (note) => note.measureNumber === measure.number && !note.isRest && note.midi != null,
    )
    .map((note) => ({ ...note, relativeOnset: note.quarterTime - measure.startQuarters }))
}

function greedyNotePairs(truthNotes, generatedNotes) {
  const usedGenerated = new Set()
  const pairs = []
  for (const truthNote of truthNotes) {
    let bestIndex = -1
    let bestDistance = Infinity
    for (let index = 0; index < generatedNotes.length; index += 1) {
      const candidate = generatedNotes[index]
      const distance = Math.abs(candidate.relativeOnset - truthNote.relativeOnset)
      if (
        usedGenerated.has(index) ||
        candidate.midi !== truthNote.midi ||
        candidate.staff !== truthNote.staff ||
        distance > 0.25 ||
        distance >= bestDistance
      ) {
        continue
      }
      bestIndex = index
      bestDistance = distance
    }
    if (bestIndex >= 0) {
      usedGenerated.add(bestIndex)
      pairs.push([truthNote, generatedNotes[bestIndex]])
    }
  }
  return pairs
}

function describeNote(note) {
  return {
    midi: note.midi,
    onset: note.relativeOnset,
    staff: note.staff,
    type: note.noteType ?? note.type ?? null,
    dur: note.durationQuarters ?? note.duration ?? null,
    dotted: Boolean(note.dotted ?? note.dots),
    beams: (note.beams ?? []).map((beam) => `${beam.number}:${normalizedBeamValue(beam.value)}`),
  }
}

async function auditSource(id, truthPath) {
  const [truthXml, baselineXml, candidateXml, report] = await Promise.all([
    readScoreXml(truthPath),
    readFile(join(CAMPAIGN, 'baseline/generated', `${id}.musicxml`), 'utf8'),
    readFile(
      join(CAMPAIGN, 'attempts/phase1-primary-beam/generated', `${id}.musicxml`),
      'utf8',
    ),
    readFile(
      join(CAMPAIGN, 'attempts/phase1-primary-beam/reports', `${id}.json`),
      'utf8',
    ).then(JSON.parse),
  ])
  const truth = parseMusicXml(truthXml, 'truth')
  const baseline = parseMusicXml(baselineXml, 'baseline')
  const candidate = parseMusicXml(candidateXml, 'candidate')

  const falseBeams = []
  const mismatches = []
  const dotChanges = []
  const durTypeChanges = []

  for (const alignment of report.measures ?? []) {
    if (
      alignment.alignment !== 'match' ||
      alignment.truthMeasureNumbers?.length !== 1 ||
      alignment.generatedMeasureNumbers?.length !== 1
    ) {
      continue
    }
    const truthMeasure = truth.measures.find(
      (measure) => measure.number === alignment.truthMeasureNumbers[0],
    )
    const generatedMeasure = candidate.measures.find(
      (measure) => measure.number === alignment.generatedMeasureNumbers[0],
    )
    const baselineMeasure = baseline.measures.find(
      (measure) => measure.number === alignment.generatedMeasureNumbers[0],
    )
    if (!truthMeasure || !generatedMeasure || !baselineMeasure) {
      continue
    }
    const truthNotes = notesForMeasure(truth, truthMeasure)
    const candNotes = notesForMeasure(candidate, generatedMeasure)
    const baseNotes = notesForMeasure(baseline, baselineMeasure)

    for (const [truthNote, candNote] of greedyNotePairs(truthNotes, candNotes)) {
      if (!truthNote.beams?.length && candNote.beams?.length) {
        falseBeams.push({
          measure: truthMeasure.number,
          truth: describeNote(truthNote),
          candidate: describeNote(candNote),
        })
      }
      if (Boolean(truthNote.dotted ?? truthNote.dots) !== Boolean(candNote.dotted ?? candNote.dots)) {
        dotChanges.push({
          measure: truthMeasure.number,
          kind: 'truth-vs-candidate',
          truth: describeNote(truthNote),
          candidate: describeNote(candNote),
        })
      }
    }
    for (const [truthNote, candNote] of greedyNotePairs(
      truthNotes.filter((note) => note.beams?.length),
      candNotes,
    )) {
      if (beamSignature(truthNote) !== beamSignature(candNote)) {
        mismatches.push({
          measure: truthMeasure.number,
          truth: describeNote(truthNote),
          candidate: describeNote(candNote),
        })
      }
    }
    // Baseline vs candidate written-duration-type drift among identical-pitch pairs
    for (const [baseNote, candNote] of greedyNotePairs(baseNotes, candNotes)) {
      const baseType = baseNote.noteType ?? baseNote.type ?? null
      const candType = candNote.noteType ?? candNote.type ?? null
      const baseDot = Boolean(baseNote.dotted ?? baseNote.dots)
      const candDot = Boolean(candNote.dotted ?? candNote.dots)
      if (baseType !== candType || baseDot !== candDot) {
        durTypeChanges.push({
          measure: generatedMeasure.number,
          midi: baseNote.midi,
          onset: baseNote.relativeOnset,
          baseline: `${baseType}${baseDot ? '.' : ''}`,
          candidate: `${candType}${candDot ? '.' : ''}`,
        })
      }
    }
  }
  return { falseBeams, mismatches, dotChanges, durTypeChanges }
}

async function main() {
  const only = process.argv[2] ?? null
  for (const [id, truthPath] of Object.entries(SOURCES)) {
    if (only && id !== only) {
      continue
    }
    const result = await auditSource(id, truthPath)
    const hasContent =
      result.falseBeams.length ||
      result.mismatches.length ||
      result.dotChanges.length ||
      result.durTypeChanges.length
    if (!hasContent) {
      continue
    }
    console.log(`\n=== ${id} ===`)
    console.log(`falseBeams: ${result.falseBeams.length}`)
    for (const entry of result.falseBeams) {
      console.log(
        `  m${entry.measure} midi=${entry.truth.midi} onset=${entry.truth.onset} staff=${entry.truth.staff}` +
          ` truth=${entry.truth.type}${entry.truth.dotted ? '.' : ''} beams=${JSON.stringify(entry.truth.beams)}` +
          ` cand=${entry.candidate.type}${entry.candidate.dotted ? '.' : ''} beams=${JSON.stringify(entry.candidate.beams)}`,
      )
    }
    console.log(`dotChanges(truth-vs-candidate): ${result.dotChanges.length}`)
    for (const entry of result.dotChanges.slice(0, 20)) {
      console.log(
        `  m${entry.measure} midi=${entry.truth.midi} onset=${entry.truth.onset}` +
          ` truth=${entry.truth.type}${entry.truth.dotted ? '.' : ''}` +
          ` cand=${entry.candidate.type}${entry.candidate.dotted ? '.' : ''}`,
      )
    }
    console.log(`durTypeChanges(baseline->candidate): ${result.durTypeChanges.length}`)
    for (const entry of result.durTypeChanges.slice(0, 40)) {
      console.log(
        `  m${entry.measure} midi=${entry.midi} onset=${entry.onset} ${entry.baseline} -> ${entry.candidate}`,
      )
    }
    console.log(`beamMismatches: ${result.mismatches.length} (showing up to 25)`)
    for (const entry of result.mismatches.slice(0, 25)) {
      console.log(
        `  m${entry.measure} midi=${entry.truth.midi} onset=${entry.truth.onset}` +
          ` truth=${JSON.stringify(entry.truth.beams)} cand=${JSON.stringify(entry.candidate.beams)}`,
      )
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
