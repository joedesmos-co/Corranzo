import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
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

const pdf = (id) => new Uint8Array(readFileSync(join(ROOT, 'benchmarks/omr-fixtures', id, `${id}.pdf`)))
const reference = (id) => readFileSync(join(ROOT, 'benchmarks/omr-fixtures', id, `${id}.musicxml`), 'utf8')

describe.skipIf(!createCanvas)('guitar browser rhythm evidence', () => {
  it('classifies the mixed notation rhythm exactly (16 eighth, 24 quarter)', async () => {
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

  it('recovers the paired TAB onset rhythm and complete measure fill', async () => {
    const result = await recognizeGuitarTabPdf(pdf('guitar-paired-chords-vector'), {
      pdfjsLib: pdfjsLegacy,
      createCanvas,
    })
    expect(result.events).toHaveLength(116)
    expect(result.summary.rhythm.onsets).toBe(32)
    expect(result.summary.rhythm.onsets_confident).toBe(32)
    expect(result.summary.rhythm.measures_complete).toBe(8)
    expect(result.summary.rhythm.measures_total).toBe(8)
    expect(result.summary.rhythm_recovered).toBe(true)
    const assessment = assessGuitarTabRecognition(result)
    expect(assessment.rhythmRecovered).toBe(true)
    // Ties/rests/voices are not audited yet; rhythm evidence is not a
    // production practice-ready signal.
    expect(assessment.practiceReady).toBe(false)
    expect(assessment.issues).toContain('ties-rests-voice-audit-required')
  })

  it('keeps sparse TAB pitch-only (no noteheads => no invented duration)', async () => {
    const result = await recognizeGuitarTabPdf(pdf('guitar-tab-sparse-vector'), {
      pdfjsLib: pdfjsLegacy,
      createCanvas,
    })
    expect(result.events).toHaveLength(32)
    expect(result.events.every((event) => event.rhythm?.duration == null)).toBe(true)
    expect(result.summary.rhythm_recovered).toBe(false)
    expect(assessGuitarTabRecognition(result).pitchOnly).toBe(true)
  })

  it('does not claim the techniques fixture is complete (reference ties unsupported)', async () => {
    const result = await recognizeGuitarTabPdf(pdf('guitar-techniques-paired-vector'), {
      pdfjsLib: pdfjsLegacy,
      createCanvas,
    })
    expect(result.events).toHaveLength(32)
    expect(result.summary.rhythm_recovered).toBe(true)
    expect(reference('guitar-techniques-paired-vector')).toMatch(/<tie\b/)
    expect(assessGuitarTabRecognition(result).practiceReady).toBe(false)
  })
})
