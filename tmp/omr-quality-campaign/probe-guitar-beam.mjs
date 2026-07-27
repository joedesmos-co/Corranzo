import { runPdfOmrPipeline } from '/Users/ryland/Documents/scoreflow/src/features/omr/runPdfOmrPipeline.js'
import { makePdfTextExtractor, makeRenderPageCallback, renderPdfToPages } from '/Users/ryland/Documents/scoreflow/scripts/lib/renderPdfPages.mjs'

const pdfPath = 'benchmarks/omr-fixtures/guitar-standard-chords-vector/guitar-standard-chords-vector.pdf'
const rendered = await renderPdfToPages(pdfPath, { rootDir: process.cwd(), maxPages: 2 })
const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: process.cwd() })
const result = await runPdfOmrPipeline(pdfPath, {
  renderPage: makeRenderPageCallback(rendered.pages),
  extractPageText,
  numPages: rendered.numPages,
  maxPages: 2,
  preprocessPages: true,
  instrumentId: 'guitar',
  title: 'guitar-standard-chords-vector',
})
for (const measure of result.measureRhythms ?? result.measures ?? []) {
  const applied = (measure.events ?? []).filter((event) => event.beamTopologyApplied)
  if (applied.length) {
    console.log('measure', measure.measureNumber, 'appliedEvents:', applied.length)
    for (const event of applied) {
      console.log('  start', event.startDivision, 'dur', event.durationDivisions, 'type', event.durationType,
        'group', event.beamTopologyGroupId, 'conf', event.beamTopologyConfidence,
        'adjusted', event.beamTopologyDurationAdjusted,
        'midis', (event.notes ?? []).map((note) => note.midi).join(','))
    }
  }
}
