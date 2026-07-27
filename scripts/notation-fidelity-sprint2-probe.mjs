#!/usr/bin/env node
/**
 * OMR Notation Fidelity Sprint 2 real-score trace.
 *
 * Captures the detector/event handoff without changing production output, then
 * compares before/after MusicXML, rendered rhythm geometry, and parsed playback
 * semantics. The frozen semantic evaluator is read only.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotes,
  buildStaffLaneRhythmMarks,
  buildStaffLaneStems,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/notation-fidelity-sprint-2')
const DOWNLOADS = join(homedir(), 'Downloads')
const SOURCES = [
  {
    id: 'piano-articulation-scan',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
    ),
    output: 'articulation',
  },
  {
    id: 'minecraft',
    pdf: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.pdf'),
    output: 'minecraft',
  },
  {
    id: 'evangelion',
    pdf: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'),
    output: 'evangelion',
  },
  {
    id: 'gymnopedie',
    pdf: join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'),
    output: 'gymnopedie',
  },
  {
    id: 'minuet-clean-engraved',
    pdf: join(ROOT, 'public/fixtures/demo-minuet-in-g.pdf'),
    output: 'minuet',
  },
]

function simplifyNote(note) {
  return {
    midi: note.midi ?? null,
    naturalMidi: note.naturalMidi ?? null,
    clef: note.clef ?? null,
    cx: note.cx ?? null,
    cy: note.cy ?? null,
    hollow: note.hollow ?? null,
    stem: note.stem
      ? {
          direction: note.stem.direction ?? note.stem,
          length: note.stem.length ?? null,
        }
      : null,
    beams: note.beams ?? 0,
    beamStrength: note.beamStrength ?? 0,
    dotted: Boolean(note.dotted),
    accidental: note.accidental ?? null,
    pitchAlteration: note.pitchAlteration ?? null,
    tieStart: Boolean(note.tieStart),
    tieStop: Boolean(note.tieStop),
    slurStart: Boolean(note.slurStart),
    slurStop: Boolean(note.slurStop),
    articulation: note.articulation ?? note.accentArticulation ?? null,
  }
}

function simplifyPageResult(source, pageResult, error = null) {
  return {
    source: source.id,
    pdf: source.pdf,
    status: error ? 'rejected' : 'ready',
    error: error
      ? {
          code: error.code ?? null,
          message: error.message,
        }
      : null,
    stats: pageResult?.stats ?? null,
    measures: (pageResult?.measureRhythms ?? []).map((measure) => ({
      measureNumber: measure.measureNumber,
      page: measure.page,
      systemIndex: measure.systemIndex,
      events: (measure.events ?? []).map((event) => ({
        type: event.type,
        startDivision: event.startDivision ?? null,
        durationDivisions: event.durationDivisions ?? null,
        durationType: event.durationType ?? null,
        dotted: Boolean(event.dotted),
        beams: event.beams ?? 0,
        notes: (event.notes ?? []).map(simplifyNote),
      })),
    })),
  }
}

async function captureSource(source) {
  const rendered = await renderPdfToPages(source.pdf, {
    rootDir: ROOT,
    maxPages: 1,
  })
  const extractPageText = await makePdfTextExtractor(source.pdf, { rootDir: ROOT })
  let pageResult = null
  let error = null
  try {
    await runPdfOmrPipeline(source.pdf, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.numPages,
      maxPages: 1,
      title: `${source.id}-notation-trace`,
      analyzePage(imageData, context) {
        pageResult = processOmrPageAnalysis(imageData, context)
        return pageResult
      },
    })
  } catch (caught) {
    error = caught
  }
  return simplifyPageResult(source, pageResult, error)
}

function countTag(xml, pattern) {
  return xml.match(pattern)?.length ?? 0
}

function xmlCounts(xml) {
  return {
    notes: countTag(xml, /<note(?:\s|>)/g),
    eighths: countTag(xml, /<type>eighth<\/type>/g),
    sixteenths: countTag(xml, /<type>sixteenth<\/type>/g),
    quarters: countTag(xml, /<type>quarter<\/type>/g),
    halves: countTag(xml, /<type>half<\/type>/g),
    wholes: countTag(xml, /<type>whole<\/type>/g),
    dots: countTag(xml, /<dot\s*\/>/g),
    beams: countTag(xml, /<beam /g),
    beamBegins: countTag(xml, />begin<\/beam>/g),
    beamContinues: countTag(xml, />continue<\/beam>/g),
    beamEnds: countTag(xml, />end<\/beam>/g),
    ties: countTag(xml, /<tie /g),
    slurs: countTag(xml, /<slur /g),
    staccatos: countTag(xml, /<staccato\s*\/>/g),
    accents: countTag(xml, /<accent\s*\/>/g),
  }
}

function playbackSignature(timing) {
  return timing.notes.map((note) => [
    note.midi,
    note.quarterTime,
    note.durationQuarters,
    note.tieStart,
    note.tieStop,
    note.staccato,
    note.accent,
  ])
}

function renderedRhythmCounts(xml) {
  const groups = buildVisualLaneGroups(parseMusicXml(xml, 'notation-probe.musicxml'))
  const geometry = buildStaffGeometry(detectStaves(groups))
  const notes = buildStaffLaneNotes(groups, geometry)
  const stems = buildStaffLaneStems(groups, geometry, { notes })
  const marks = buildStaffLaneRhythmMarks(notes, stems)
  return {
    visualNotes: notes.length,
    hollowNotes: notes.filter((note) => note.hollow).length,
    stemlessNotes: notes.filter((note) => note.stemless).length,
    beamSpans: marks.beams.length,
    flags: marks.flags.length,
    dots: marks.dots.length,
  }
}

function summarizeCases(cases) {
  const summary = {
    total: cases.length,
    correctBefore: 0,
    correctAfter: 0,
    byFailureLayerBefore: {},
    byFailureLayerAfter: {},
    byCategory: {},
  }
  for (const entry of cases) {
    if (entry.correctBefore) summary.correctBefore += 1
    if (entry.correctAfter) summary.correctAfter += 1
    summary.byFailureLayerBefore[entry.failureLayerBefore] =
      (summary.byFailureLayerBefore[entry.failureLayerBefore] ?? 0) + 1
    summary.byFailureLayerAfter[entry.failureLayerAfter] =
      (summary.byFailureLayerAfter[entry.failureLayerAfter] ?? 0) + 1
    const category = summary.byCategory[entry.category] ?? {
      total: 0,
      correctBefore: 0,
      correctAfter: 0,
    }
    category.total += 1
    if (entry.correctBefore) category.correctBefore += 1
    if (entry.correctAfter) category.correctAfter += 1
    summary.byCategory[entry.category] = category
  }
  return summary
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const rawDetection = []
  for (const source of SOURCES) {
    rawDetection.push(await captureSource(source))
  }
  await writeFile(
    join(OUT, 'raw-detection-trace.json'),
    `${JSON.stringify(rawDetection, null, 2)}\n`,
  )

  const outputComparisons = {}
  for (const source of SOURCES.filter((entry) => entry.output !== 'minuet')) {
    const beforeXml = await readFile(
      join(OUT, 'before', `${source.output}.musicxml`),
      'utf8',
    )
    const afterXml = await readFile(
      join(OUT, 'after', `${source.output}.musicxml`),
      'utf8',
    )
    const beforeTiming = parseMusicXml(beforeXml, `${source.output}-before.musicxml`)
    const afterTiming = parseMusicXml(afterXml, `${source.output}-after.musicxml`)
    outputComparisons[source.id] = {
      before: xmlCounts(beforeXml),
      after: xmlCounts(afterXml),
      playbackSemanticEqual:
        JSON.stringify(playbackSignature(beforeTiming)) ===
        JSON.stringify(playbackSignature(afterTiming)),
      durationSecondsBefore: beforeTiming.durationSeconds,
      durationSecondsAfter: afterTiming.durationSeconds,
      renderedAfter: renderedRhythmCounts(afterXml),
    }
  }

  const minuetXml = await readFile(
    join(ROOT, 'public/fixtures/demo-minuet-in-g.musicxml'),
    'utf8',
  )
  outputComparisons['minuet-clean-engraved'] = {
    source: xmlCounts(minuetXml),
    renderedAfter: renderedRhythmCounts(minuetXml),
  }

  const caseFile = JSON.parse(
    await readFile(
      join(ROOT, 'benchmarks/omr-notation-fidelity-validation/sprint2-cases.json'),
      'utf8',
    ),
  )
  const acceptance = {
    version: 1,
    sprint: 'omr-notation-fidelity-sprint-2',
    focus: 'note-values-dots-beams',
    caseSummary: summarizeCases(caseFile.cases ?? []),
    outputComparisons,
  }
  await writeFile(
    join(OUT, 'acceptance.json'),
    `${JSON.stringify(acceptance, null, 2)}\n`,
  )
  console.log(JSON.stringify(acceptance, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
