import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  notationNoteheads,
  recognizeGuitarTabPdf,
  analyzeNotationRhythm,
  assessGuitarTabRecognition,
} from '../src/features/vision/guitarTabCore.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let createCanvas = null
try {
  createCanvas = (await import('@napi-rs/canvas')).createCanvas
} catch {
  createCanvas = null
}

const item = (text, bbox) => ({ text, bbox })
const pdf = (id) => new Uint8Array(readFileSync(join(ROOT, 'benchmarks/omr-fixtures', id, `${id}.pdf`)))

describe('guitar notation notehead text runs', () => {
  it('keeps a single glyph at its measured box', () => {
    const [head] = notationNoteheads([item('\ue0a4', [10, 0, 20, 10])])
    expect(head).toMatchObject({ kind: 'quarter', base: 1, cx: 15, cy: 5, w: 10, split: false })
  })

  it('splits multiple glyphs with no spaces into equal advances', () => {
    const heads = notationNoteheads([item('\ue0a4\ue0a4\ue0a4', [0, 0, 30, 10])])
    expect(heads.map((head) => head.cx)).toEqual([5, 15, 25])
    expect(heads.every((head) => head.split)).toBe(true)
  })

  it('uses a standalone advance and splits a spaced run', () => {
    const heads = notationNoteheads([
      item('\ue0a4 \ue0a4 \ue0a4', [0, 0, 60, 10]),
      item('\ue0a4', [100, 0, 110, 10]),
    ])
    expect(heads.map((head) => head.cx)).toEqual([5, 30, 55, 105])
  })

  it('respects a translated/scaled bbox', () => {
    const heads = notationNoteheads([item('\ue0a4\ue0a4', [200, 40, 220, 60])])
    expect(heads.map((head) => head.cx)).toEqual([205, 215])
    expect(heads[0].box).toEqual([200, 40, 210, 60])
  })

  it('keeps every glyph in a mixed-width run and marks it split', () => {
    const heads = notationNoteheads([
      item('\ue0a2\ue0a4', [0, 0, 30, 10]),
      item('\ue0a4', [100, 0, 110, 10]),
    ])
    expect(heads).toHaveLength(3)
    expect(heads[0]).toMatchObject({ kind: 'half', base: 2, split: true })
    expect(heads[1]).toMatchObject({ kind: 'quarter', base: 1, split: true })
    expect(heads[2]).toMatchObject({ kind: 'quarter', base: 1, split: false })
  })

  it('keeps adjacent chord runs separate', () => {
    const heads = notationNoteheads([
      item('\ue0a4', [10, 10, 20, 20]),
      item('\ue0a4', [10, 20, 20, 30]),
      item('\ue0a4\ue0a4', [30, 10, 50, 20]),
    ])
    expect(heads).toHaveLength(4)
    expect(heads.map((head) => head.cx)).toEqual([15, 15, 35, 45])
  })
})

describe.skipIf(!createCanvas)('guitar mixed-rhythm extraction uncertainty', () => {
  it('recovers 21 noteheads and 15 evidenced onsets; measure 3 stays unknown', async () => {
    const result = await recognizeGuitarTabPdf(pdf('guitar-mixed-rhythm-vector'), {
      pdfjsLib: pdfjsLegacy,
      createCanvas,
    })
    expect(result.events).toHaveLength(60)
    expect(result.summary.rhythm.noteheads).toBe(21)
    expect(result.summary.rhythm.onsets).toBe(21)
    expect(result.summary.rhythm.onsets_confident).toBe(15)
    expect(result.summary.rhythm.measures_complete).toBe(3)
    expect(result.summary.rhythm.measures_total).toBe(4)
    expect(result.summary.rhythm_recovered).toBe(false)
    const unknown = result.events.filter((event) => event.rhythm?.duration == null)
    expect(unknown.length).toBeGreaterThan(0)
    expect(unknown.every((event) => event.measure === 3)).toBe(true)
    const assessment = assessGuitarTabRecognition(result)
    expect(assessment.pitchOnly).toBe(true)
    expect(assessment.practiceReady).toBe(false)
    expect(assessment.issues).toContain('rhythm-unrecovered')
    expect(assessment.issues).toContain('measure-duration-invalid')
  })

  it('writes measured types only for validated measures and footnotes the unknown one', async () => {
    const result = await recognizeGuitarTabPdf(pdf('guitar-mixed-rhythm-vector'), {
      pdfjsLib: pdfjsLegacy,
      createCanvas,
    })
    expect(result.xml).toContain('<type>quarter</type>')
    expect(result.xml).toContain('<type>eighth</type>')
    expect(result.xml).toContain('duration not recovered')
    const measure3 = /<measure number="3">([\s\S]*?)<\/measure>/.exec(result.xml)?.[1] ?? ''
    expect(measure3).toContain('duration not recovered')
    expect(measure3).not.toContain('<type>')
  })

  it('keeps the notation-only mixed fixture at 16 eighths and 24 quarters', async () => {
    const rhythm = await analyzeNotationRhythm(pdf('guitar-standard-chords-vector'), {
      pdfjsLib: pdfjsLegacy,
      createCanvas,
    })
    expect(rhythm.rows).toHaveLength(40)
    expect(rhythm.rows.every((row) => row.confident)).toBe(true)
    const counts = rhythm.rows.reduce((acc, row) => {
      acc[row.duration] = (acc[row.duration] ?? 0) + 1
      return acc
    }, {})
    expect(counts).toEqual({ 1: 24, 0.5: 16 })
  })
})
