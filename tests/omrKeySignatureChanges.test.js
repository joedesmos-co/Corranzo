import { describe, expect, it } from 'vitest'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import {
  detectVectorKeySignature,
  processVectorPageSystems,
  resolveVectorSystemKeySignatures,
} from '../src/features/omr/processVectorOmrPage.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const SHARP = '\ue262'
const FLAT = '\ue260'
const NATURAL = '\ue261'
const NOTEHEAD = '\ue0a4'

function measureBox(systemIndex) {
  const top = 0.08 + systemIndex * 0.22
  return {
    measureNumber: systemIndex + 1,
    page: 1,
    systemIndex,
    x0: 0.1,
    playableX0: 0.24,
    x1: 0.9,
    y0: top,
    y1: top + 0.18,
    staffLines: {
      treble: [top + 0.02, top + 0.04, top + 0.06, top + 0.08, top + 0.1],
      bass: [top + 0.12, top + 0.14, top + 0.16, top + 0.18, top + 0.2],
      splitY: top + 0.11,
    },
  }
}

function pdfTextGlyph(text, x, imageY) {
  return {
    text,
    x,
    y: 1000 - imageY,
    width: 10,
    height: 10,
    pageWidth: 1000,
    pageHeight: 1000,
    fontName: 'Bravura',
  }
}

function addFlatSignature(pageText, box, countPerStaff, xStart) {
  for (const staff of ['treble', 'bass']) {
    for (let index = 0; index < countPerStaff; index += 1) {
      pageText.push(
        pdfTextGlyph(
          FLAT,
          xStart + index * 10,
          box.staffLines[staff][Math.min(index, 4)] * 1000,
        ),
      )
    }
  }
}

function addNaturalCancellation(pageText, box, countPerStaff, xStart) {
  for (const staff of ['treble', 'bass']) {
    for (let index = 0; index < countPerStaff; index += 1) {
      pageText.push(
        pdfTextGlyph(
          NATURAL,
          xStart + index * 8,
          box.staffLines[staff][Math.min(index, 4)] * 1000,
        ),
      )
    }
  }
}

function internalKeyScenario({
  internalFlats = 5,
  confirmingFlats = 5,
  cancellationNaturals = 5,
} = {}) {
  const first = {
    ...measureBox(0),
    measureNumber: 1,
    measureIndex: 0,
    x0: 0.1,
    playableX0: 0.2,
    x1: 0.4,
  }
  const internal = {
    ...measureBox(0),
    measureNumber: 2,
    measureIndex: 1,
    x0: 0.4,
    playableX0: 0.4,
    x1: 0.7,
  }
  const nextSystem = {
    ...measureBox(1),
    measureNumber: 3,
    measureIndex: 0,
    x0: 0.1,
    playableX0: 0.24,
    x1: 0.9,
  }
  const pageText = []
  for (const [box, noteX] of [
    [first, 300],
    [internal, 510],
    [nextSystem, 300],
  ]) {
    const noteY = box.staffLines.treble[4] * 1000 - 10
    pageText.push(pdfTextGlyph(NOTEHEAD, noteX, noteY))
  }
  addNaturalCancellation(pageText, internal, cancellationNaturals, 405)
  addFlatSignature(pageText, internal, internalFlats, 455)
  addFlatSignature(pageText, nextSystem, confirmingFlats, 150)
  const imageData = {
    width: 1000,
    height: 1000,
    data: new Uint8ClampedArray(1000 * 1000 * 4).fill(255),
  }
  return processVectorPageSystems({
    imageData,
    pageText,
    systems: [{}, {}],
    systemMeasureBoxes: [[first, internal], [nextSystem]],
    inheritedKeySignature: { fifths: 5, mode: 'major', confidence: 0.9 },
    inheritedTimeSignature: { beats: 4, beatType: 4, confidence: 0.9 },
  })
}

describe('vector system key-signature state', () => {
  it('promotes sustained key changes and cancellation but rejects an isolated outlier', () => {
    const resolved = resolveVectorSystemKeySignatures(
      [
        { fifths: 2, confidence: 0.9 },
        { fifths: 3, confidence: 0.9 },
        { fifths: 2, confidence: 0.9 },
        { fifths: 0, confidence: 0 },
        { fifths: 0, confidence: 0 },
        { fifths: -1, confidence: 0.9 },
        { fifths: -1, confidence: 0.9 },
      ],
      { fifths: 2, mode: 'major', confidence: 0.9 },
    )

    expect(resolved.systems.map((entry) => entry.keySignature.fifths)).toEqual([
      2, 2, 2, 0, 0, -1, -1,
    ])
    expect(resolved.changes.map((entry) => [entry.systemIndex, entry.toFifths])).toEqual([
      [3, 0],
      [5, -1],
    ])
  })

  it('prefers typed text glyphs over duplicate/misclassified path evidence', () => {
    const box = measureBox(0)
    const glyphs = Array.from({ length: 12 }, (_, index) => ({
      text: FLAT,
      x: 130 + (index % 6) * 10,
      y: 110 + Math.floor(index / 6) * 80,
    }))
    const paths = Array.from({ length: 4 }, (_, index) => ({
      bounds: { x0: 140 + index, x1: 145 + index, y0: 100, y1: 170, width: 5, height: 70 },
      archDirection: 'above',
    }))

    expect(detectVectorKeySignature(glyphs, { width: 1000, height: 1000 }, box, paths).fifths).toBe(-6)
  })

  it('rejects a sustained same-sign undercount without cancellation naturals', () => {
    const resolved = resolveVectorSystemKeySignatures(
      [
        { fifths: -4, confidence: 0.9, counts: { flats: 8, naturals: 0 } },
        { fifths: -3, confidence: 0.9, counts: { flats: 6, naturals: 0 } },
        { fifths: -3, confidence: 0.9, counts: { flats: 6, naturals: 0 } },
        { fifths: -4, confidence: 0.9, counts: { flats: 8, naturals: 0 } },
      ],
      { fifths: -4, mode: 'major', confidence: 0.9 },
    )

    expect(resolved.systems.map((entry) => entry.keySignature.fifths)).toEqual([-4, -4, -4, -4])
    expect(resolved.changes).toEqual([])
  })

  it('applies a sustained system cancellation to pitch and serializes the zero key', () => {
    const boxes = [0, 1, 2, 3].map(measureBox)
    const pageText = []
    for (const box of boxes) {
      const noteY = box.staffLines.treble[4] * 1000 - 10 // F4, one space above E4.
      pageText.push(pdfTextGlyph(NOTEHEAD, 400, noteY))
      if (box.systemIndex < 2) {
        pageText.push(pdfTextGlyph(SHARP, 150, box.staffLines.treble[1] * 1000))
        pageText.push(pdfTextGlyph(SHARP, 150, box.staffLines.bass[1] * 1000))
      }
    }
    const imageData = {
      width: 1000,
      height: 1000,
      data: new Uint8ClampedArray(1000 * 1000 * 4).fill(255),
    }
    const result = processVectorPageSystems({
      imageData,
      pageText,
      systems: boxes.map(() => ({})),
      systemMeasureBoxes: boxes.map((box) => [box]),
      inheritedKeySignature: null,
      inheritedTimeSignature: { beats: 4, beatType: 4, confidence: 0.9 },
    })

    const records = result.measureRecordsBySystem.flat()
    expect(result.initialKeySignature.fifths).toBe(1)
    expect(result.endingKeySignature.fifths).toBe(0)
    expect(
      records.map(
        (record) => record.events[0].notes[0].pitchAlteration.keySignatureFifths,
      ),
    ).toEqual([1, 1, 0, 0])
    expect(records[2].keySignatureChange).toMatchObject({ fifths: 0 })

    const xml = buildOmrMusicXml({
      measures: records,
      musical: { keySignature: result.initialKeySignature },
      includeDisclaimer: false,
    })
    expect(xml).toContain('<key><fifths>1</fifths>')
    expect(xml).toContain('<key><fifths>0</fifths>')
    expect(parseMusicXml(xml, 'key-change.musicxml').keySignatures.map((entry) => entry.fifths)).toEqual([1, 0])
  })

  it('applies an initial reliable key established after an empty opening system', () => {
    const boxes = [0, 1, 2].map(measureBox)
    const pageText = []
    for (const box of boxes) {
      const noteY = box.staffLines.treble[4] * 1000 - 10
      pageText.push(pdfTextGlyph(NOTEHEAD, 400, noteY))
      if (box.systemIndex > 0) {
        pageText.push(pdfTextGlyph(SHARP, 150, box.staffLines.treble[1] * 1000))
        pageText.push(pdfTextGlyph(SHARP, 150, box.staffLines.bass[1] * 1000))
      }
    }
    const imageData = {
      width: 1000,
      height: 1000,
      data: new Uint8ClampedArray(1000 * 1000 * 4).fill(255),
    }
    const result = processVectorPageSystems({
      imageData,
      pageText,
      systems: boxes.map(() => ({})),
      systemMeasureBoxes: boxes.map((box) => [box]),
      inheritedKeySignature: null,
      inheritedTimeSignature: { beats: 4, beatType: 4, confidence: 0.9 },
    })
    const records = result.measureRecordsBySystem.flat()

    expect(
      records.map(
        (record) => record.events[0].notes[0].pitchAlteration.keySignatureFifths,
      ),
    ).toEqual([0, 1, 1])
    expect(records[1].keySignatureChange).toBeUndefined()
  })

  it('applies a dense internal opposite-sign signature confirmed at the next system', () => {
    const result = internalKeyScenario()
    const records = result.measureRecordsBySystem.flat()

    expect(
      records.map(
        (record) => record.events[0].notes[0].pitchAlteration.keySignatureFifths,
      ),
    ).toEqual([5, -5, -5])
    expect(records[1].keySignatureChange).toMatchObject({ fifths: -5 })
    expect(records[1].events[0].startDivision).toBe(0)
    expect(result.endingKeySignature.fifths).toBe(-5)
    expect(result.keySignatureDiagnostics.internalChanges).toHaveLength(1)

    const xml = buildOmrMusicXml({
      measures: records,
      musical: { keySignature: result.initialKeySignature },
      includeDisclaimer: false,
    })
    expect(
      parseMusicXml(xml, 'internal-key-change.musicxml').keySignatures.map(
        (entry) => entry.fifths,
      ),
    ).toEqual([5, -5])
  })

  it('abstains from unconfirmed or sparse internal accidental prefixes', () => {
    const unconfirmed = internalKeyScenario({ confirmingFlats: 4 })
    expect(
      unconfirmed.measureRecordsBySystem.flat().map(
        (record) => record.events[0].notes[0].pitchAlteration.keySignatureFifths,
      ),
    ).toEqual([5, 5, 5])
    expect(unconfirmed.keySignatureDiagnostics.internalChanges).toEqual([])

    const sparse = internalKeyScenario({ internalFlats: 1, confirmingFlats: 1 })
    expect(
      sparse.measureRecordsBySystem.flat().map(
        (record) => record.events[0].notes[0].pitchAlteration.keySignatureFifths,
      ),
    ).toEqual([5, 5, 5])
    expect(sparse.keySignatureDiagnostics.internalChanges).toEqual([])

    const noCancellation = internalKeyScenario({ cancellationNaturals: 0 })
    expect(
      noCancellation.measureRecordsBySystem.flat().map(
        (record) => record.events[0].notes[0].pitchAlteration.keySignatureFifths,
      ),
    ).toEqual([5, 5, 5])
    expect(noCancellation.keySignatureDiagnostics.internalChanges).toEqual([])
  })
})
