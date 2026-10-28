import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPage, notationRests, notationNoteheads, recognizeGuitarTabPdf } from '../src/features/vision/guitarTabCore.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let createCanvas = null
try {
  createCanvas = (await import('@napi-rs/canvas')).createCanvas
} catch {
  createCanvas = null
}

const pdf = (id) => new Uint8Array(readFileSync(join(ROOT, 'benchmarks/omr-fixtures', id, `${id}.pdf`)))

// SMuFL rest codepoints used by the benchmark font and by Bravura.
const glyph = (cp, x = 100) => ({
  text: String.fromCodePoint(cp),
  bbox: [x, 100, x + 24, 140],
})

describe('SMuFL rest evidence', () => {
  it('identifies whole, half, eighth and sixteenth rest glyphs from a real PDF text layer', async () => {
    expect(createCanvas).toBeTruthy()
    const doc = await pdfjsLegacy.getDocument({ data: pdf('guitar-rests-vector') }).promise
    const page = await extractPage(doc, 1, 150, createCanvas)
    const rests = notationRests(page.items)
    expect(rests.map((r) => [r.kind, r.base])).toEqual([
      ['whole', 4],
      ['half', 2],
      ['eighth', 0.5],
      ['sixteenth', 0.25],
    ])
    // Rest glyphs must never be mistaken for noteheads.
    expect(notationNoteheads(page.items)).toHaveLength(0)
  })

  it('recognizes a quarter rest (U+E4E5) from the text layer', () => {
    const rests = notationRests([glyph(0xe4e5)])
    expect(rests).toHaveLength(1)
    expect(rests[0].kind).toBe('quarter')
    expect(rests[0].base).toBe(1)
  })

  it('does not treat articulation or unrelated private-use glyphs as rests', () => {
    expect(notationRests([glyph(0xe4a0)])).toHaveLength(0) // staccato
    expect(notationRests([glyph(0xe0a4)])).toHaveLength(0) // quarter notehead
    expect(notationRests([glyph(0xe000)])).toHaveLength(0)
    expect(notationRests([{ text: 'mf', bbox: [0, 0, 10, 10] }])).toHaveLength(0)
  })

  it('does not invent rests on score fixtures that contain none', async () => {
    expect(createCanvas).toBeTruthy()
    for (const id of ['guitar-mixed-rhythm-vector', 'guitar-standard-chords-vector', 'guitar-paired-chords-vector']) {
      const result = await recognizeGuitarTabPdf(pdf(id), { pdfjsLib: pdfjsLegacy, createCanvas, dpi: 150 })
      expect(result.summary.rhythm.rests).toBe(0)
    }
  })
})
