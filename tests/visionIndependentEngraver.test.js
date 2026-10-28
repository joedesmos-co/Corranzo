import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs'
import { recognizePianoVectorPdf, assessPianoVectorIr } from '../src/features/vision/pianoVectorCore.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IDS = ['piano-grand-voices-verovio', 'piano-rhythm-tuplets-verovio', 'piano-pickup-crossstaff-verovio']

describe('independent Verovio engraving fallback', () => {
  for (const id of IDS) {
    it(`abstains on ${id} instead of inventing vector notes`, async () => {
      const data = new Uint8Array(readFileSync(join(
        ROOT, 'benchmarks/omr-independent-verovio', id, `${id}.pdf`,
      )))
      const ir = await recognizePianoVectorPdf(data, { pdfjsLib: pdfjsLegacy })
      expect(ir.route).toBe('image')
      expect(ir.notes).toHaveLength(0)
      const assessment = assessPianoVectorIr(ir)
      expect(assessment.route).toBe('image')
      expect(assessment.practiceReady).toBe(false)
      expect(assessment.issues).toContain('no-vector-notes')
    })
  }
})
