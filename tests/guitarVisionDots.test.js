import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeNotationRhythm } from '../src/features/vision/guitarTabCore.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let createCanvas = null
try {
  createCanvas = (await import('@napi-rs/canvas')).createCanvas
} catch {
  createCanvas = null
}

const pdf = (id) => new Uint8Array(readFileSync(join(ROOT, 'benchmarks/omr-fixtures', id, `${id}.pdf`)))

describe('dot evidence stays honest', () => {
  it('never invents dotted durations on ambiguous small ink', async () => {
    // The fixture places real notation noteheads next to small ink marks,
    // including marks that look like augmentation dots. The conservative
    // detector must not promote any of them: no dotted durations are
    // emitted until dot evidence is independently verified.
    expect(createCanvas).toBeTruthy()
    const rhythm = await analyzeNotationRhythm(pdf('guitar-dots-vector'), {
      pdfjsLib: pdfjsLegacy,
      createCanvas,
      dpi: 150,
    })
    expect(rhythm.rows).toHaveLength(5)
    expect(rhythm.rows.every((row) => row.dots === 0)).toBe(true)
    expect(rhythm.rows.every((row) => row.duration === 1)).toBe(true)
    expect(rhythm.rests).toBe(0)
  })

  it('keeps every scored fixture free of dot promotions', async () => {
    expect(createCanvas).toBeTruthy()
    for (const id of ['guitar-standard-chords-vector', 'guitar-mixed-rhythm-vector']) {
      const rhythm = await analyzeNotationRhythm(pdf(id), { pdfjsLib: pdfjsLegacy, createCanvas, dpi: 150 })
      expect(rhythm.rows.every((row) => row.dots === 0)).toBe(true)
    }
  })
})
