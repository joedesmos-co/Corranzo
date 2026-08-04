import { createCanvas } from '../../node_modules/@napi-rs/canvas/index.js'
import * as pdfjs from '../../node_modules/pdfjs-dist/legacy/build/pdf.mjs'
import {
  setPdfAnalysisCanvasFactory,
  setPdfjsLoader,
} from '../../src/features/score-follow/pdfPageAnalysis.js'

setPdfAnalysisCanvasFactory((width, height) => createCanvas(width, height))
setPdfjsLoader(async () => pdfjs)

await import('../../scripts/omr-semantic-corpus-eval.mjs')
