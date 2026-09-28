import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRenderPageCallback, renderPdfToPages } from '../scripts/lib/renderPdfPages.mjs'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  GUITAR_PITCH_CONTRACT_VERSION,
  soundingFromTab,
  validateGuitarMusicXml,
} from '../src/features/omr/guitar/pitchContract.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'benchmarks/omr-fixtures')

const CLEF_OCTAVE_CHANGE = 'guitar-clef-octave-change-double-counts-transposition'
const TRANSPOSE = 'guitar-transpose-would-subtract-offset-twice'
const STRING_FRET = 'guitar-string-fret-disagrees-with-sounding-pitch'

/** Position glyphs in the shape the vector OMR pipeline consumes. */
async function makePdfTextExtractor(pdfPath) {
  const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_pdfSource, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1, rotation: 0 })
    const content = await page.getTextContent()
    return (content.items ?? [])
      .map((item) => ({
        text: item.str ?? '',
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 0,
        fontName: item.fontName ?? '',
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      }))
      .filter((item) => item.text.trim().length > 0)
  }
}

/**
 * Transcriptions are memoized per fixture. The vector pipeline is CPU-heavy
 * (a few seconds per page) and the rest of the suite runs in parallel, so
 * repeating a transcription both wastes time and pushes unrelated suites past
 * their hook timeout.
 */
const transcribeCache = new Map()

async function transcribe(id, { maxPages = 1 } = {}) {
  const cached = transcribeCache.get(id)
  if (cached) return cached
  const pdfPath = join(FIXTURES, id, `${id}.pdf`)
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages })
  const extractPageText = await makePdfTextExtractor(pdfPath)
  const result = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages,
    instrumentId: 'guitar',
    title: id,
  })
  const value = { xml: result.musicXml, id, pdfPath }
  transcribeCache.set(id, value)
  return value
}

/**
 * End-to-end guard for the pitch contract.
 *
 * The Phase 0 audit found the emitter stored guitar *written* pitch and left
 * the octave to a `<clef-octave-change>` that Corranzo's own parser ignores.
 * That convention mismatch made 41% of the notes in BWV 997 wrong by exactly
 * +12 semitones and made guitar playback an octave sharp, while the entire test
 * suite stayed green.
 *
 * These tests run the real pipeline over real guitar scores and assert the
 * emitted file satisfies the contract, so a future regression fails loudly
 * instead of quietly halving pitch accuracy.
 */
describe('guitar pitch contract end-to-end', () => {
  it.each([
    ['standard notation', 'guitar-standard-chords-vector'],
    ['paired notation + TAB', 'guitar-paired-chords-vector'],
    ['TAB only', 'guitar-tab-sparse-vector'],
  ])('emits a contract-conforming score for %s', async (_label, id) => {
    const { xml } = await transcribe(id)
    const rules = validateGuitarMusicXml(xml).violations.map((violation) => violation.rule)
    expect(rules).not.toContain(CLEF_OCTAVE_CHANGE)
    expect(rules).not.toContain(TRANSPOSE)
  })

  it('keeps every emitted string/fret physically consistent with its pitch', async () => {
    const { xml } = await transcribe('guitar-paired-chords-vector')
    const report = validateGuitarMusicXml(xml)
    const mismatches = report.violations
      .filter((violation) => violation.rule === STRING_FRET)
      .map((violation) => violation.detail)
    expect(mismatches).toEqual([])
  })

  it('emits sounding pitch that overlaps ground truth instead of sitting an octave above it', async () => {
    const id = 'guitar-standard-chords-vector'
    const { xml } = await transcribe(id)
    const truthPath = join(FIXTURES, id, `${id}.musicxml`)

    const report = validateGuitarMusicXml(xml)
    expect(report.version).toBe(GUITAR_PITCH_CONTRACT_VERSION)
    expect(report.ok).toBe(true)

    const generated = parseMusicXml(xml, 'generated.musicxml')
    const truth = parseMusicXml(readFileSync(truthPath, 'utf8'), truthPath)

    const generatedMidi = generated.notes
      .filter((note) => !note.isRest && Number.isFinite(note.midi))
      .map((note) => note.midi)
    const truthMidi = new Set(
      truth.notes.filter((note) => !note.isRest && Number.isFinite(note.midi)).map((note) => note.midi),
    )
    expect(generatedMidi.length).toBeGreaterThan(0)
    expect(truthMidi.size).toBeGreaterThan(0)

    // If the emitter stored written pitch, essentially every generated note
    // would land an octave above anything in the sounding-range truth.
    const truthMax = Math.max(...truthMidi)
    const anOctaveTooHigh = generatedMidi.filter((midi) => midi > truthMax + 1).length
    expect(anOctaveTooHigh).toBe(0)

    const shared = generatedMidi.filter((midi) => truthMidi.has(midi))
    expect(shared.length / generatedMidi.length).toBeGreaterThan(0.5)
  })

  it('derives the same pitch from a tab position as from written notation', () => {
    // String 5 open is A2; written A3 in treble sounds A2. The two routes to one
    // pitch must agree, which is what makes staff/TAB pairing sound correct
    // rather than merely looking plausible.
    expect(soundingFromTab(5, 0)).toBe(57 - 12)
  })
})
