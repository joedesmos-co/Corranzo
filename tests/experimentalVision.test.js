import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXPERIMENTAL_VISION_MODES,
  getExperimentalVisionMode,
  setExperimentalVisionMode,
  clearExperimentalVisionMode,
} from '../src/features/vision/experimentalVisionFlag.js'
import {
  recognizePianoVectorPdf,
  assessPianoVectorIr,
  toMusicXML,
} from '../src/features/vision/pianoVectorCore.js'
import { assessGuitarTabRecognition, durationFromEvidence } from '../src/features/vision/guitarTabCore.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
}
const PIANO_PDF = join(
  ROOT,
  'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.pdf',
)

describe('experimental vision flag', () => {
  it('is off by default and can be set/cleared explicitly', () => {
    clearExperimentalVisionMode()
    expect(getExperimentalVisionMode()).toBe(null)
    setExperimentalVisionMode(EXPERIMENTAL_VISION_MODES.PIANO)
    expect(getExperimentalVisionMode()).toBe(EXPERIMENTAL_VISION_MODES.PIANO)
    clearExperimentalVisionMode()
    expect(getExperimentalVisionMode()).toBe(null)
  })
})

describe('piano vector core', () => {
  it('recognizes a supported vector piano fixture without reference metadata', async () => {
    const data = new Uint8Array(readFileSync(PIANO_PDF))
    const ir = await recognizePianoVectorPdf(data, { pdfjsLib: pdfjsLegacy })
    expect(ir.route).toBe('vector')
    expect(ir.notes.length).toBeGreaterThan(0)
    expect(ir.meter).toEqual({ beats: 4, unit: 4 })
    expect(ir.key).toBe(0)
  })

  it('reports uncertain timing instead of claiming a complete practice score', async () => {
    const data = new Uint8Array(readFileSync(PIANO_PDF))
    const ir = await recognizePianoVectorPdf(data, { pdfjsLib: pdfjsLegacy })
    const assessment = assessPianoVectorIr(ir)
    // The committed fixture's rest duration is an eighth instead of the
    // reference quarter, so measure 6 does not fill 4/4. The gate must catch
    // this rather than turning it into a practice target.
    expect(assessment.issues).toContain('measure-duration-invalid')
    expect(assessment.practiceReady).toBe(false)
    expect(assessment.completeFidelity).toBe(false)
  })

  it('serializes an explicit accidental as <alter>', () => {
    const xml = toMusicXML({
      credits: [],
      key: -2,
      meter: { beats: 4, unit: 4 },
      clefs: { 0: 'treble' },
      notes: [{
        midi: 61, x: 10, measure: 0, staff: 0, type: 'quarter', dur_q: '1',
        chord_root: true, accidental: 1, key_fifths: -2,
      }],
      rests: [],
    })
    expect(xml).toContain('<alter>1</alter>')
    expect(xml).toContain('<key><fifths>-2</fifths></key>')
  })

  it('blocks practice when ties/slurs are present but not transcribed', () => {
    const assessment = assessPianoVectorIr({
      route: 'vector', notes: [{ midi: 60, measure: 0, staff: 0, dur_q: '1', chord_root: true }],
      rests: [], key: 0, meter: { beats: 4, unit: 4 }, curveCount: 1,
      unresolvedNotes: 0, unresolvedRests: 0,
    })
    expect(assessment.issues).toContain('ties-or-slurs-not-transcribed')
    expect(assessment.practiceReady).toBe(false)
  })
})

describe('guitar TAB assessment', () => {
  it('never promotes an evidence-recovered but unaudited score to practice', () => {
    const assessment = assessGuitarTabRecognition({
      events: new Array(116).fill({}),
      summary: {
        text_items: 100, events: 116, rhythm_recovered: true,
        rhythm: {
          rhythm_recovered: true, time_signature: '4/4',
          measures_complete: 8, measures_total: 8,
          voice_ownership: 'single-voice',
          staff_pairing: [{ staff: 0, onsets: 16, columns: 16, exact: true }],
        },
      },
    })
    expect(assessment.practiceReady).toBe(false)
    expect(assessment.completeFidelity).toBe(false)
    expect(assessment.rhythmRecovered).toBe(true)
    expect(assessment.issues).toContain('ties-rests-voice-audit-required')
  })

  it('classifies written durations from notehead + stem/beam/flag evidence', () => {
    const col = (bases) => ({ members: bases.map((base) => ({ base })) })
    const evidence = (overrides = {}) => ({ beams: 0, flags: 0, stem: true, ...overrides })
    expect(durationFromEvidence(col([1]), evidence()).duration).toBe(1)
    expect(durationFromEvidence(col([1]), evidence({ beams: 1 })).duration).toBe(0.5)
    expect(durationFromEvidence(col([1]), evidence({ beams: 2 })).duration).toBe(0.25)
    expect(durationFromEvidence(col([1]), evidence({ beams: 3 })).duration).toBe(0.125)
    expect(durationFromEvidence(col([4]), evidence()).duration).toBe(4)
    expect(durationFromEvidence(col([2]), evidence()).duration).toBe(2)
  })

  it('marks conflicting or ambiguous evidence as non-confident', () => {
    const col = (bases) => ({ members: bases.map((base) => ({ base })) })
    const conflict = durationFromEvidence(col([1]), { beams: 1, flags: 1, stem: true })
    expect(conflict.duration).toBe(0.5)
    expect(conflict.confident).toBe(false)
    const ambiguous = durationFromEvidence(col([1, 2]), { beams: 0, flags: 0, stem: true })
    expect(ambiguous.ambiguous).toBe(true)
    expect(ambiguous.confident).toBe(false)
    const noStem = durationFromEvidence(col([1]), { beams: 0, flags: 0, stem: false })
    expect(noStem.confident).toBe(false)
  })

  it('marks a pitch-only recognition explicitly', () => {
    const assessment = assessGuitarTabRecognition({
      events: new Array(32).fill({}),
      summary: {
        text_items: 100, events: 32,
        rhythm: { rhythm_recovered: false, measures_complete: 0, measures_total: 8 },
      },
    })
    expect(assessment.pitchOnly).toBe(true)
    expect(assessment.practiceReady).toBe(false)
    expect(assessment.issues).toContain('rhythm-unrecovered')
  })
})
