#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import {
  processVectorPageSystems,
  textGlyphsToImage,
} from '../../src/features/omr/processVectorOmrPage.js'
import { normalizeLegacyMusicFontGlyphs } from '../../src/features/omr/normalizeLegacyMusicFontGlyphs.js'
import { normalizeNoncanonicalArticulationGlyphs } from '../../src/features/omr/normalizeNoncanonicalArticulationGlyphs.js'
import {
  OMR_DIAGNOSTIC_FLAG,
  setOmrDiagnosticFlag,
} from '../../src/features/omr/omrDiagnosticFlags.js'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const root = resolve(import.meta.dirname, '../..')
const fixtureDir = join(root, 'benchmarks/omr-fixtures/piano-dense-advanced-vector')
const pdfPath = join(fixtureDir, 'piano-dense-advanced-vector.pdf')
const truthPath = join(fixtureDir, 'piano-dense-advanced-vector.musicxml')
const outputPath = join(import.meta.dirname, 'dense-current-stage-trace.json')
const generatedPath = join(import.meta.dirname, 'dense-current.musicxml')
const noteheadGlyphs = new Set(['\ue0a2', '\ue0a3', '\ue0a4'])
const accidentalGlyphs = new Set(['\ue260', '\ue261', '\ue262', '\ue263', '\ue264'])

setOmrDiagnosticFlag(OMR_DIAGNOSTIC_FLAG.PROVENANCE, true)

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return value ?? null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizedPageGlyphs(pageText, imageData) {
  const legacy = normalizeLegacyMusicFontGlyphs(pageText ?? [])
  const articulations = normalizeNoncanonicalArticulationGlyphs(legacy.items)
  return textGlyphsToImage(articulations.items, imageData)
}

function glyphRecord(glyph, index) {
  return {
    index,
    id: `pdf-glyph-${index}`,
    text: glyph.text ?? null,
    codepoint: glyph.text
      ? `U+${glyph.text.codePointAt(0).toString(16).toUpperCase()}`
      : null,
    fontName: glyph.fontName ?? null,
    x: round(glyph.x),
    y: round(glyph.y),
    width: round(glyph.width),
    height: round(glyph.height),
    transform: glyph.transform ?? null,
    legacyMusicFontNormalized: Boolean(glyph.legacyMusicFontNormalized),
    originalLegacyText: glyph.originalLegacyText ?? null,
  }
}

function nearestGlyph(note, glyphs) {
  let selected = null
  let best = Infinity
  for (const glyph of glyphs) {
    if (!noteheadGlyphs.has(glyph.text)) continue
    const distance = Math.abs(note.cx - glyph.x) + Math.abs(note.cy - glyph.y) * 2
    if (distance < best) {
      selected = glyph
      best = distance
    }
  }
  return selected && best <= Math.max(4, (selected.height || selected.width || 4) * 0.6)
    ? selected
    : null
}

function compactAnchor(anchor) {
  if (!anchor) return null
  return {
    source: anchor.source ?? null,
    yNorm: round(anchor.yNorm),
    fallbackYNorm: round(anchor.fallbackYNorm),
    rawYNorm: round(anchor.rawYNorm),
    confidence: round(anchor.confidence),
    visualBounds: anchor.visualBounds ?? null,
    rejectedReason: anchor.rejectedReason ?? null,
    suppressedStaffOrLedgerRows: anchor.suppressedStaffOrLedgerRows ?? null,
    suppressedStemColumns: anchor.suppressedStemColumns ?? null,
    localStaffGapNorm: round(anchor.localStaffGapNorm),
    ledgerClassifier: anchor.ledgerClassifier ?? null,
    competingHeadCandidates: anchor.competingHeadCandidates ?? null,
  }
}

function compactPitchMapping(mapping) {
  if (!mapping) return null
  return {
    yNorm: round(mapping.yNorm),
    staffRole: mapping.staffRole ?? null,
    clef: mapping.clef ?? null,
    clefSign: mapping.clefSign ?? null,
    midi: mapping.midi ?? null,
    alternateMidi: mapping.alternateMidi ?? null,
    alternateClefSign: mapping.alternateClefSign ?? null,
    lineYs: (mapping.lineYs ?? []).map((value) => round(value)),
    ambiguous: Boolean(mapping.ambiguous),
  }
}

function compactNote(note, rawId, glyph, glyphIndex) {
  return {
    rawId,
    sourceGlyphId: glyph ? `pdf-glyph-${glyphIndex}` : null,
    sourceGlyph: glyph ? glyphRecord(glyph, glyphIndex) : null,
    source: note.source ?? null,
    cx: round(note.cx),
    cy: round(note.cy),
    xNorm: round(note.xNorm),
    yNorm: round(note.yNorm),
    originalGlyphOrigin: glyph
      ? { x: round(glyph.x), y: round(glyph.y) }
      : { x: round(note.cx), y: round(note.cy) },
    noteheadAnchor: compactAnchor(note.noteheadAnchor),
    pitchMapping: compactPitchMapping(note.pitchMapping),
    naturalMidi: note.naturalMidi ?? null,
    finalMidi: note.midi ?? null,
    clef: note.clef ?? null,
    alter: note.alter ?? null,
    pitchAlteration: note.pitchAlteration ?? null,
    accidental: note.accidental ?? null,
    measureNumber: note.measureNumber ?? null,
    positionInMeasure: round(note.positionInMeasure),
    voice: note.voice ?? null,
    durationType: note.durationType ?? null,
    durationDivisions: note.durationDivisions ?? null,
    noteheadGlyph: note.noteheadGlyph ?? null,
    noteheadFont: note.noteheadFont ?? null,
    stemDirection: note.stemDirection ?? note.stem?.direction ?? null,
    beams: note.beams ?? null,
    beamStrength: note.beamStrength ?? null,
  }
}

function compactEvent(event, eventIndex, noteIds) {
  return {
    eventIndex,
    type: event.type,
    startDivision: event.startDivision ?? null,
    onsetQuarters: Number.isFinite(event.startDivision) ? event.startDivision / 4 : null,
    durationDivisions: event.durationDivisions ?? null,
    durationQuarters: Number.isFinite(event.durationDivisions)
      ? event.durationDivisions / 4
      : null,
    durationType: event.durationType ?? null,
    voice: event.voice ?? null,
    chordColumnId: event.chordColumnId ?? event.columnId ?? null,
    cx: round(event.cx),
    positionInMeasure: round(event.positionInMeasure),
    notes: (event.notes ?? []).map((note) => ({
      rawId: noteIds.get(note) ?? null,
      midi: note.midi ?? null,
      naturalMidi: note.naturalMidi ?? null,
      clef: note.clef ?? null,
      voice: note.voice ?? null,
      cx: round(note.cx),
      cy: round(note.cy),
      alter: note.alter ?? null,
      accidental: note.accidental ?? null,
      pitchAlteration: note.pitchAlteration ?? null,
    })),
  }
}

const rendered = await renderPdfToPages(pdfPath, { rootDir: root, maxPages: 1 })
const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: root })
const captures = []

const omr = await runPdfOmrPipeline(pdfPath, {
  renderPage: makeRenderPageCallback(rendered.pages),
  extractPageText,
  numPages: rendered.numPages,
  maxPages: 1,
  preprocessPages: true,
  instrumentId: 'piano',
  title: 'piano-dense-advanced-vector',
  includeScoreGraph: true,
  analyzePage: async (imageData, context) => {
    const pageResult = processOmrPageAnalysis(imageData, {
      ...context,
      captureOmrV3Shadow: true,
      captureOmrV3RawSymbols: true,
    })
    const shadow = pageResult.omrV3ShadowInput
    const normalizedGlyphs = normalizedPageGlyphs(context.pageText, imageData)
    const normalizedPageText = normalizeNoncanonicalArticulationGlyphs(
      normalizeLegacyMusicFontGlyphs(context.pageText ?? []).items,
    ).items
    const vector = processVectorPageSystems({
      imageData,
      pageText: normalizedPageText,
      vectorCurves: context.vectorCurves ?? [],
      vectorAccidentalPaths: context.vectorAccidentalPaths ?? [],
      vectorAugmentationDotPaths: context.vectorAugmentationDotPaths ?? [],
      systems: shadow.systems,
      systemMeasureBoxes: shadow.systemMeasureBoxes,
      inheritedKeySignature: context.keySignature ?? null,
      inheritedTimeSignature: context.timeSignature ?? null,
      inkThreshold: pageResult.inkThreshold,
      captureDetectorObservations: true,
    })

    const glyphIndex = new Map(normalizedGlyphs.map((glyph, index) => [glyph, index]))
    const measures = []
    for (const record of vector.measureRecordsBySystem.flat()) {
      // Keep every generated measure because frozen alignment splits truth m1
      // into generated m1+m2, shifting later truth-to-generated numbering.
      if (record.measureNumber < 1 || record.measureNumber > 9) continue
      const rawNotes = record.detectorObservations?.noteheads ?? []
      const noteIds = new WeakMap()
      rawNotes.forEach((note, index) => noteIds.set(note, `m${record.measureNumber}-raw-${index}`))
      measures.push({
        measureNumber: record.measureNumber,
        page: record.page,
        systemIndex: record.systemIndex,
        keySignature: vector.keySignature,
        timeSignature: vector.timeSignature,
        rawCandidates: rawNotes.map((note, index) => {
          const glyph = nearestGlyph(note, normalizedGlyphs)
          return compactNote(
            note,
            `m${record.measureNumber}-raw-${index}`,
            glyph,
            glyph ? glyphIndex.get(glyph) : null,
          )
        }),
        accidentalDiagnostics: record.vectorAccidentalDiagnostics,
        finalEvents: (record.events ?? []).map((event, index) =>
          compactEvent(event, index, noteIds),
        ),
        vectorNoteMatching: record.vectorNoteMatching,
        vectorChordDiagnostics: record.vectorChordDiagnostics,
        adjacentSlotChordGroupingDiagnostics:
          record.adjacentSlotChordGroupingDiagnostics,
        rhythmProvenance: record.rhythmProvenance ?? null,
      })
    }
    captures.push({
      page: context.page,
      width: imageData.width,
      height: imageData.height,
      glyphs: normalizedGlyphs
        .map(glyphRecord)
        .filter((glyph) =>
          noteheadGlyphs.has(glyph.text) || accidentalGlyphs.has(glyph.text),
        ),
      vectorAccidentalPaths: context.vectorAccidentalPaths ?? [],
      measures,
    })
    return pageResult
  },
})

if (!omr?.musicXml) throw new Error('Dense fixture produced no MusicXML')
writeFileSync(generatedPath, omr.musicXml)
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      fixture: 'piano-dense-advanced-vector',
      pdfPath,
      truthPath,
      generatedPath,
      truthXml: readFileSync(truthPath, 'utf8'),
      generatedXml: omr.musicXml,
      captures,
      pipelineDiagnostics: {
        acceptance: omr.acceptance ?? null,
        stats: omr.stats ?? null,
        scoreGraph: omr.diagnostics?.scoreGraph ?? null,
      },
    },
    null,
    2,
  ),
)

process.stdout.write(`${outputPath}\n${generatedPath}\n`)
