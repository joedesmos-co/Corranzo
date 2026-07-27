/**
 * Call processOmrPageAnalysis and dump rhythm evidence for target measures.
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import { getInstrument } from '../../src/features/instruments/instruments.js'
import {
  makePdfTextExtractor,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/rhythm-sprint-2-rca')

function summarize(m) {
  return {
    measureNumber: m.measureNumber,
    events: (m.events || []).map((e) => ({
      type: e.type,
      start: e.startDivision,
      dur: e.durationDivisions,
      dtype: e.durationType,
      dotted: e.dotted,
      clef: e.notes?.[0]?.clef,
      midi: e.notes?.map((n) => n.midi),
      noteDur: e.notes?.map((n) => n.durationType),
      beams: e.notes?.map((n) => n.beams),
      bStr: e.notes?.map((n) => n.beamStrength),
      stem: e.notes?.map((n) => n.stem?.length),
      hollowG: e.notes?.map((n) => n.hollowGlyph),
      pos: e.positionInMeasure,
      adj: Object.fromEntries(
        Object.entries({
          beam: e.beamDurationAdjusted,
          clamp: e.durationClamped,
          clefExt: e.clefVoiceExtended,
          penult: e.penultimateHalfAdjusted,
          beatQ: e.sameClefBeatQuarterAdjusted,
          termQ: e.terminalSameClefChordQuarterAdjusted,
          bassOpen: e.openingBassSubdivisionAdjusted,
          overhang: e.unsupportedUpperChordOverhangAdjusted,
          combined: e.combinedGrandStaffOpeningAdjusted,
        }).filter(([, v]) => v),
      ),
    })),
    noteheads: (m.notes || []).map((n) => ({
      midi: n.midi,
      clef: n.clef,
      type: n.durationType,
      beams: n.beams,
      bStr: n.beamStrength,
      stem: n.stem?.length,
      hollowG: n.hollowGlyph,
      dotted: n.dotted,
      pos: n.positionInMeasure,
    })),
  }
}

async function analyze(id, instrumentId, wantMeasures) {
  const pdfPath = join(ROOT, `benchmarks/omr-fixtures/${id}/${id}.pdf`)
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages: 1 })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const pageText = await extractPageText(null, 1)
  const instrument = getInstrument(instrumentId)
  const page = rendered.pages[0]
  const imageData = { width: page.width, height: page.height, data: page.data }
  const result = processOmrPageAnalysis(imageData, {
    page: 1,
    pageText: pageText.items || pageText,
    instrument,
    dense: id.includes('dense'),
  })

  const all = result.measureRhythms || result.measures || []
  const measures = all.filter((m) => wantMeasures.includes(m.measureNumber)).map(summarize)
  writeFileSync(
    join(OUT, `${id}.page-diag.json`),
    `${JSON.stringify({ id, source: result.source, stats: result.stats, measures }, null, 2)}\n`,
  )
  console.log(`\n==== ${id} source=${result.source} allMeasures=${all.length} ====`)
  for (const m of measures) {
    console.log(`\n-- m${m.measureNumber}`)
    for (const e of m.events) {
      console.log(
        `  ${e.type} @${e.start} d=${e.dur} ${e.dtype}${e.dotted ? '.' : ''} clef=${e.clef} midi=${JSON.stringify(e.midi)} noteDur=${JSON.stringify(e.noteDur)} beams=${JSON.stringify(e.beams)} bStr=${JSON.stringify(e.bStr)} stem=${JSON.stringify(e.stem)} hollow=${JSON.stringify(e.hollowG)} pos=${Number(e.pos).toFixed(3)} adj=${JSON.stringify(e.adj)}`,
      )
    }
    console.log(
      '  NH:',
      m.noteheads
        .map(
          (n) =>
            `${n.midi}/${n.clef}:${n.type} b=${n.beams}/${n.bStr} stem=${n.stem} pos=${Number(n.pos).toFixed(3)}`,
        )
        .join(' | '),
    )
  }
}

await analyze('piano-grand-voices-vector', 'piano', [1, 2, 3])
await analyze('piano-dense-advanced-vector', 'piano', [2, 3, 4])
await analyze('piano-rhythm-tuplets-vector', 'piano', [2, 3, 7])
await analyze('guitar-tab-sparse-vector', 'guitar', [2, 3, 6])
console.log('\ndone')
