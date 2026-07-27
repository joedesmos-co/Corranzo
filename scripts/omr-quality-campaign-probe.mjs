#!/usr/bin/env node
/**
 * Real-score acceptance audit for the autonomous OMR Quality Campaign.
 *
 * The frozen evaluator remains the scoring authority. This probe adds
 * target-specific audits for beam topology and invariant signatures that are
 * intentionally outside the evaluator's historical scored categories.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOWNLOADS = join(homedir(), 'Downloads')
const CAMPAIGN = join(ROOT, 'tmp/omr-quality-campaign')
const BASELINE = join(CAMPAIGN, 'baseline')

const SOURCES = {
  minecraft: join(
    DOWNLOADS,
    'beginner-minecraft-piano-themes-in-c-minecraft.mxl',
  ),
  evangelion: join(
    DOWNLOADS,
    'a-cruel-angels-thesis-neon-genesis-evangelion.mxl',
  ),
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
  'la-campanella': join(
    DOWNLOADS,
    'etude-s-1413-in-g-minor-la-campanella-liszt.mxl',
  ),
  'fantaisie-impromptu': join(
    DOWNLOADS,
    'fantaisie-impromptu-in-c-minor-chopin.mxl',
  ),
  'moonlight-3': join(
    DOWNLOADS,
    'sonate-no-14-moonlight-3rd-movement.mxl',
  ),
  'hungarian-dance-no5': join(DOWNLOADS, 'hungarian-dance-no5.mxl'),
  'carol-of-the-bells': join(DOWNLOADS, 'carol-of-the-bells.mxl'),
}

function argValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function readScoreXml(path) {
  const data = await readFile(path)
  if (!path.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const rootPath = container?.match(/full-path="([^"]+)"/)?.[1]
  if (!rootPath || !zip.file(rootPath)) {
    throw new Error(`MXL archive has no MusicXML root: ${path}`)
  }
  return zip.file(rootPath).async('string')
}

function exactTaxonomy(report) {
  const counts = {
    wrongNoteDuration: 0,
    wrongRestDuration: 0,
    missingRest: 0,
    inventedRest: 0,
    denseChordSeparation: 0,
    tupletGrouping: 0,
  }
  for (const measure of report.measures ?? []) {
    if (
      measure.alignment !== 'match' ||
      measure.truthMeasureNumbers?.length !== 1 ||
      measure.generatedMeasureNumbers?.length !== 1
    ) {
      continue
    }
    for (const defect of measure.defects ?? []) {
      if (
        ['duration-mismatch', 'dotted-rhythm-error', 'missing-dot', 'extra-dot']
          .includes(defect.code)
      ) {
        counts.wrongNoteDuration += 1
      } else if (defect.code === 'rest-duration-error') {
        counts.wrongRestDuration += 1
      } else if (defect.code === 'missing-rest') {
        counts.missingRest += 1
      } else if (defect.code === 'extra-rest') {
        counts.inventedRest += 1
      } else if (defect.code === 'incorrect-chord') {
        counts.denseChordSeparation += 1
      } else if (defect.code?.includes('tuplet')) {
        counts.tupletGrouping += 1
      }
    }
  }
  return counts
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0
  }
}

function normalizedBeamValue(value) {
  return String(value ?? '')
    .replace('forward hook', 'forward-hook')
    .replace('backward hook', 'backward-hook')
}

function beamSignature(note) {
  return JSON.stringify(
    (note.beams ?? []).map((beam) => [
      Number(beam.number ?? 1),
      normalizedBeamValue(beam.value),
    ]),
  )
}

function notesForMeasure(score, measure) {
  return score.notes
    .filter(
      (note) =>
        note.measureNumber === measure.number &&
        !note.isRest &&
        note.midi != null,
    )
    .map((note) => ({
      ...note,
      relativeOnset: note.quarterTime - measure.startQuarters,
    }))
}

function greedyNotePairs(truthNotes, generatedNotes) {
  const usedGenerated = new Set()
  const pairs = []
  for (const truthNote of truthNotes) {
    let bestIndex = -1
    let bestDistance = Infinity
    for (let index = 0; index < generatedNotes.length; index += 1) {
      const candidate = generatedNotes[index]
      const distance = Math.abs(
        candidate.relativeOnset - truthNote.relativeOnset,
      )
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

function beamAudit(truth, generated, report) {
  const result = {
    comparableNotes: 0,
    matchedBeamedTruthNotes: 0,
    correctBeamSignatures: 0,
    beamMismatches: 0,
    falseBeamedNotes: 0,
  }
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
    const generatedMeasure = generated.measures.find(
      (measure) => measure.number === alignment.generatedMeasureNumbers[0],
    )
    if (!truthMeasure || !generatedMeasure) {
      continue
    }
    const truthNotes = notesForMeasure(truth, truthMeasure)
    const generatedNotes = notesForMeasure(generated, generatedMeasure)
    for (const [truthNote, generatedNote] of greedyNotePairs(
      truthNotes,
      generatedNotes,
    )) {
      result.comparableNotes += 1
      if (!truthNote.beams?.length && generatedNote.beams?.length) {
        result.falseBeamedNotes += 1
      }
    }
    for (const [truthNote, generatedNote] of greedyNotePairs(
      truthNotes.filter((note) => note.beams?.length),
      generatedNotes,
    )) {
      result.matchedBeamedTruthNotes += 1
      if (beamSignature(truthNote) === beamSignature(generatedNote)) {
        result.correctBeamSignatures += 1
      } else {
        result.beamMismatches += 1
      }
    }
  }
  return result
}

function noteInventory(score) {
  return score.notes
    .filter((note) => !note.isRest && note.midi != null)
    .map((note) => note.midi)
}

function frozenNotationSignature(score) {
  return score.notes
    .filter((note) => !note.isRest && note.midi != null)
    .map((note) => [
      note.midi,
      note.tieStart,
      note.tieStop,
      note.slurStart,
      note.slurStop,
      note.staccato,
      note.accent,
      note.tenuto,
      note.marcato,
      note.fermata,
      note.accidental,
    ])
}

function sortedRows(rows) {
  return rows.map((row) => JSON.stringify(row)).sort()
}

function signatureAudit(baseline, candidate) {
  const beforeInventory = noteInventory(baseline)
  const afterInventory = noteInventory(candidate)
  return {
    noteCountBefore: beforeInventory.length,
    noteCountAfter: afterInventory.length,
    pitchAttackOrderEqual:
      JSON.stringify(beforeInventory) === JSON.stringify(afterInventory),
    pitchInventoryEqual:
      JSON.stringify([...beforeInventory].sort((a, b) => a - b)) ===
      JSON.stringify([...afterInventory].sort((a, b) => a - b)),
    frozenNotationSemanticsEqual:
      JSON.stringify(sortedRows(frozenNotationSignature(baseline))) ===
      JSON.stringify(sortedRows(frozenNotationSignature(candidate))),
  }
}

async function main() {
  const candidate = argValue(
    '--candidate',
    join(CAMPAIGN, 'attempts/phase1-primary-beam'),
  )
  const output = argValue('--output', join(candidate, 'comparison.json'))
  const aggregate = {
    baseline: {
      wrongNoteDuration: 0,
      wrongRestDuration: 0,
      missingRest: 0,
      inventedRest: 0,
      denseChordSeparation: 0,
      tupletGrouping: 0,
    },
    candidate: {
      wrongNoteDuration: 0,
      wrongRestDuration: 0,
      missingRest: 0,
      inventedRest: 0,
      denseChordSeparation: 0,
      tupletGrouping: 0,
    },
  }
  const beamTotals = {
    baseline: {
      comparableNotes: 0,
      matchedBeamedTruthNotes: 0,
      correctBeamSignatures: 0,
      beamMismatches: 0,
      falseBeamedNotes: 0,
    },
    candidate: {
      comparableNotes: 0,
      matchedBeamedTruthNotes: 0,
      correctBeamSignatures: 0,
      beamMismatches: 0,
      falseBeamedNotes: 0,
    },
  }
  const bySource = {}
  for (const [id, truthPath] of Object.entries(SOURCES)) {
    const [truthXml, baselineXml, candidateXml, baselineReport, candidateReport] =
      await Promise.all([
        readScoreXml(truthPath),
        readFile(join(BASELINE, 'generated', `${id}.musicxml`), 'utf8'),
        readFile(join(candidate, 'generated', `${id}.musicxml`), 'utf8'),
        readFile(join(BASELINE, 'reports', `${id}.json`), 'utf8').then(JSON.parse),
        readFile(join(candidate, 'reports', `${id}.json`), 'utf8').then(JSON.parse),
      ])
    const truth = parseMusicXml(truthXml, `${id}-truth.musicxml`)
    const baselineScore = parseMusicXml(
      baselineXml,
      `${id}-baseline.musicxml`,
    )
    const candidateScore = parseMusicXml(
      candidateXml,
      `${id}-candidate.musicxml`,
    )
    const baselineTaxonomy = exactTaxonomy(baselineReport)
    const candidateTaxonomy = exactTaxonomy(candidateReport)
    const baselineBeams = beamAudit(truth, baselineScore, baselineReport)
    const candidateBeams = beamAudit(truth, candidateScore, candidateReport)
    addCounts(aggregate.baseline, baselineTaxonomy)
    addCounts(aggregate.candidate, candidateTaxonomy)
    addCounts(beamTotals.baseline, baselineBeams)
    addCounts(beamTotals.candidate, candidateBeams)
    bySource[id] = {
      scores: {
        overall: [
          baselineReport.overallPercent,
          candidateReport.overallPercent,
        ],
        rhythm: [
          baselineReport.scorePercents.rhythm,
          candidateReport.scorePercents.rhythm,
        ],
        playback: [
          baselineReport.scorePercents.playback,
          candidateReport.scorePercents.playback,
        ],
      },
      taxonomy: {
        baseline: baselineTaxonomy,
        candidate: candidateTaxonomy,
      },
      beams: {
        baseline: baselineBeams,
        candidate: candidateBeams,
      },
      invariants: signatureAudit(baselineScore, candidateScore),
    }
  }
  const result = {
    authority:
      'Frozen semantic evaluator plus exact 1:1 aligned-measure topology audit.',
    candidate,
    aggregate: {
      ...aggregate,
      delta: Object.fromEntries(
        Object.keys(aggregate.baseline).map((key) => [
          key,
          aggregate.candidate[key] - aggregate.baseline[key],
        ]),
      ),
    },
    beamTotals: {
      ...beamTotals,
      delta: Object.fromEntries(
        Object.keys(beamTotals.baseline).map((key) => [
          key,
          beamTotals.candidate[key] - beamTotals.baseline[key],
        ]),
      ),
    },
    bySource,
  }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
  console.log(`Wrote ${output}`)
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
