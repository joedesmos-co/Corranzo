#!/usr/bin/env node
/**
 * Chord-normalized Phase 1 beam audit.
 *
 * MusicXML encodes a chord's beams only on the first note of the chord group.
 * The original probe paired notes by midi, so identical visual beams were
 * miscounted as false beams / mismatches when truth and candidate ordered
 * chord tones differently. Here every note inherits its chord group's beam
 * signature before comparison, for truth, baseline, and candidate alike.
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

function beamSignatureOf(beams) {
  return JSON.stringify(
    (beams ?? []).map((beam) => [Number(beam.number ?? 1), normalizedBeamValue(beam.value)]),
  )
}

/** Assign every note its chord group's beam signature (chord base carries it). */
function chordNormalize(score) {
  const byPart = new Map()
  for (const note of score.notes) {
    if (note.isRest || note.midi == null) {
      continue
    }
    const list = byPart.get(note.partId) ?? []
    list.push(note)
    byPart.set(note.partId, list)
  }
  for (const list of byPart.values()) {
    let currentBase = null
    for (const note of list) {
      if (!note.isChord || currentBase == null) {
        currentBase = note
      }
      note.effectiveBeams =
        note.isChord && currentBase !== note ? currentBase.beams : note.beams
    }
  }
  return score
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

function beamAudit(truth, generated, report, detail = false, label = '') {
  const result = {
    comparableNotes: 0,
    matchedBeamedTruthNotes: 0,
    correctBeamSignatures: 0,
    beamMismatches: 0,
    falseBeamedNotes: 0,
  }
  const details = []
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
    for (const [truthNote, generatedNote] of greedyNotePairs(truthNotes, generatedNotes)) {
      result.comparableNotes += 1
      if (!truthNote.effectiveBeams?.length && generatedNote.effectiveBeams?.length) {
        result.falseBeamedNotes += 1
        if (detail) {
          details.push(
            `FALSE ${label} m${truthMeasure.number} midi=${truthNote.midi} onset=${truthNote.relativeOnset}` +
              ` truthType=${truthNote.noteType} candBeams=${beamSignatureOf(generatedNote.effectiveBeams)}`,
          )
        }
      }
    }
    for (const [truthNote, generatedNote] of greedyNotePairs(
      truthNotes.filter((note) => note.effectiveBeams?.length),
      generatedNotes,
    )) {
      result.matchedBeamedTruthNotes += 1
      if (
        beamSignatureOf(truthNote.effectiveBeams) ===
        beamSignatureOf(generatedNote.effectiveBeams)
      ) {
        result.correctBeamSignatures += 1
      } else {
        result.beamMismatches += 1
        if (detail) {
          details.push(
            `MISMATCH ${label} m${truthMeasure.number} midi=${truthNote.midi} onset=${truthNote.relativeOnset}` +
              ` truth=${beamSignatureOf(truthNote.effectiveBeams)} cand=${beamSignatureOf(generatedNote.effectiveBeams)}`,
          )
        }
      }
    }
  }
  return { result, details }
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0
  }
}

async function main() {
  const detailSource = process.argv[2] ?? null
  const totals = {
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
  for (const [id, truthPath] of Object.entries(SOURCES)) {
    const [truthXml, baselineXml, candidateXml, baselineReport, candidateReport] =
      await Promise.all([
        readScoreXml(truthPath),
        readFile(join(CAMPAIGN, 'baseline/generated', `${id}.musicxml`), 'utf8'),
        readFile(
          join(CAMPAIGN, 'attempts/phase1-primary-beam/generated', `${id}.musicxml`),
          'utf8',
        ),
        readFile(join(CAMPAIGN, 'baseline/reports', `${id}.json`), 'utf8').then(JSON.parse),
        readFile(
          join(CAMPAIGN, 'attempts/phase1-primary-beam/reports', `${id}.json`),
          'utf8',
        ).then(JSON.parse),
      ])
    const truth = chordNormalize(parseMusicXml(truthXml, 'truth'))
    const baseline = chordNormalize(parseMusicXml(baselineXml, 'baseline'))
    const candidate = chordNormalize(parseMusicXml(candidateXml, 'candidate'))
    const detail = detailSource === id
    const baseAudit = beamAudit(truth, baseline, baselineReport)
    const candAudit = beamAudit(truth, candidate, candidateReport, detail, id)
    addCounts(totals.baseline, baseAudit.result)
    addCounts(totals.candidate, candAudit.result)
    const b = baseAudit.result
    const c = candAudit.result
    if (b.matchedBeamedTruthNotes || c.falseBeamedNotes || b.falseBeamedNotes) {
      console.log(
        `${id}: correct ${b.correctBeamSignatures}->${c.correctBeamSignatures}` +
          ` mismatch ${b.beamMismatches}->${c.beamMismatches}` +
          ` false ${b.falseBeamedNotes}->${c.falseBeamedNotes}` +
          ` (beamed truth notes ${c.matchedBeamedTruthNotes})`,
      )
    }
    for (const line of candAudit.details) {
      console.log(`  ${line}`)
    }
  }
  console.log('\nTOTALS (chord-normalized):')
  console.log(`  baseline : ${JSON.stringify(totals.baseline)}`)
  console.log(`  candidate: ${JSON.stringify(totals.candidate)}`)
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
