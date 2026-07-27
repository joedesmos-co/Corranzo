/**
 * Dump per-measure vector rhythm diagnostics for representative measures.
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/rhythm-sprint-2-rca')

function collectMeasures(result, measureFilter) {
  const measures = []
  const seen = new Set()
  const walk = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 10) return
    if (Array.isArray(obj)) {
      for (const entry of obj) walk(entry, depth + 1)
      return
    }
    if (
      obj.measureNumber != null &&
      (obj.events || obj.vectorRhythmDiagnostics) &&
      !seen.has(obj)
    ) {
      seen.add(obj)
      if (!measureFilter || measureFilter.includes(obj.measureNumber)) {
        measures.push(obj)
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') walk(value, depth + 1)
    }
  }
  walk(result)
  return measures
}

function summarizeMeasure(m) {
  return {
    measureNumber: m.measureNumber,
    noteCount: m.notes?.length ?? m.vectorNoteMatching?.vectorNoteCount,
    eventCount: m.events?.length,
    events: (m.events || []).map((e) => ({
      type: e.type,
      start: e.startDivision,
      dur: e.durationDivisions,
      dtype: e.durationType,
      dotted: e.dotted,
      clef: e.notes?.[0]?.clef,
      midi: e.notes?.map((n) => n.midi),
      beams: e.notes?.map((n) => n.beams),
      beamStrength: e.notes?.map((n) => n.beamStrength),
      noteDurationType: e.notes?.map((n) => n.durationType),
      hollow: e.notes?.map((n) => n.hollow),
      hollowGlyph: e.notes?.map((n) => n.hollowGlyph),
      stemLen: e.notes?.map((n) => n.stem?.length),
      positionInMeasure: e.positionInMeasure,
      flags: {
        beamDurationAdjusted: Boolean(e.beamDurationAdjusted),
        durationClamped: Boolean(e.durationClamped),
        sameClefBeatQuarterAdjusted: Boolean(e.sameClefBeatQuarterAdjusted),
        terminalSameClefChordQuarterAdjusted: Boolean(e.terminalSameClefChordQuarterAdjusted),
        unsupportedUpperChordOverhangAdjusted: Boolean(e.unsupportedUpperChordOverhangAdjusted),
        openingBassSubdivisionAdjusted: Boolean(e.openingBassSubdivisionAdjusted),
        clefVoiceExtended: Boolean(e.clefVoiceExtended || e.perClefExtended),
        penultimateHalfAdjusted: Boolean(e.penultimateHalfAdjusted),
      },
    })),
    noteheads: (m.notes || m.vectorRhythmDiagnostics?.noteheadRhythm || []).map((n) => ({
      midi: n.midi,
      clef: n.clef,
      beams: n.beams,
      beamStrength: n.beamStrength,
      durationType: n.durationType,
      durationDivisions: n.durationDivisions,
      hollow: n.hollow,
      hollowGlyph: n.hollowGlyph,
      stemLen: n.stem?.length,
      dotted: n.dotted,
      positionInMeasure: n.positionInMeasure,
      cx: n.cx,
    })),
    rhythmDiagSummary: m.vectorRhythmDiagnostics
      ? {
          maxBeams: m.vectorRhythmDiagnostics.maxBeams,
          flaggedCount: m.vectorRhythmDiagnostics.flaggedCount,
          beamAdjustedEventCount: (m.events || []).filter((e) => e.beamDurationAdjusted).length,
          clampedEventCount: (m.events || []).filter((e) => e.durationClamped).length,
        }
      : null,
  }
}

async function runOne(id, instrumentId, measureFilter) {
  const pdfPath = join(ROOT, `benchmarks/omr-fixtures/${id}/${id}.pdf`)
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages: 1 })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const result = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: 1,
    preprocessPages: true,
    instrumentId,
    title: id,
  })

  const measures = collectMeasures(result, measureFilter).map(summarizeMeasure)
  const dump = {
    id,
    resultKeys: Object.keys(result || {}),
    measureCountFound: measures.length,
    measures,
  }
  writeFileSync(join(OUT, `${id}.diag.json`), `${JSON.stringify(dump, null, 2)}\n`)
  console.log(`\n==== ${id} measures=${measures.length} ====`)
  for (const m of measures) {
    console.log(`\n-- m${m.measureNumber} notes=${m.noteCount} events=${m.eventCount}`)
    for (const e of m.events || []) {
      const flagKeys = Object.entries(e.flags || [])
        .filter(([, v]) => v)
        .map(([k]) => k)
      console.log(
        `  ${e.type} start=${e.start} dur=${e.dur} ${e.dtype}${e.dotted ? '.' : ''} clef=${e.clef} midi=${JSON.stringify(e.midi)} noteDur=${JSON.stringify(e.noteDurationType)} beams=${JSON.stringify(e.beams)} bStr=${JSON.stringify(e.beamStrength)} stem=${JSON.stringify(e.stemLen)} hollow=${JSON.stringify(e.hollowGlyph ?? e.hollow)} pos=${e.positionInMeasure?.toFixed?.(3) ?? e.positionInMeasure} flags=${flagKeys.join(',') || '-'}`,
      )
    }
    if (m.noteheads?.length) {
      console.log('  noteheads:')
      for (const n of m.noteheads) {
        console.log(
          `    midi=${n.midi} clef=${n.clef} type=${n.durationType} beams=${n.beams} bStr=${n.beamStrength} stem=${n.stemLen} hollowG=${n.hollowGlyph} dotted=${n.dotted} pos=${n.positionInMeasure?.toFixed?.(3)}`,
        )
      }
    }
  }
  return dump
}

const targets = [
  ['piano-grand-voices-vector', 'piano', [1, 2, 3]],
  ['piano-dense-advanced-vector', 'piano', [2, 3, 4]],
  ['guitar-tab-sparse-vector', 'guitar', [2, 3, 6]],
  ['piano-rhythm-tuplets-vector', 'piano', [2, 3, 7]],
]

for (const [id, inst, ms] of targets) {
  await runOne(id, inst, ms)
}
console.log('\ndone')
