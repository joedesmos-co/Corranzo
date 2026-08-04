import { writeFileSync } from 'node:fs'
import { createCanvas } from '../../node_modules/@napi-rs/canvas/index.js'
import * as pdfjs from '../../node_modules/pdfjs-dist/legacy/build/pdf.mjs'
import {
  setPdfAnalysisCanvasFactory,
  setPdfjsLoader,
} from '../../src/features/score-follow/pdfPageAnalysis.js'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'

setPdfAnalysisCanvasFactory((width, height) => createCanvas(width, height))
setPdfjsLoader(async () => pdfjs)

const pdf = new URL(
  '../../benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.pdf',
  import.meta.url,
).pathname
const result = await runPdfOmrPipeline(pdf, {
  instrumentId: 'piano',
  title: 'piano-dense-advanced-vector-local-raster-probe',
  preprocessPages: true,
})
writeFileSync(
  new URL('./dense-local-raster-probe.json', import.meta.url),
  `${JSON.stringify({
    noteCount: result.noteCount,
    measureCount: result.measureCount,
    localRasterRecovery: result.diagnostics.localRasterRecovery,
  }, null, 2)}\n`,
)
