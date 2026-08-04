#!/usr/bin/env node
/**
 * Phase 1 — export every semantic mismatch for the frozen 9-fixture corpus.
 * Does not modify the evaluator. Writes tmp/omr-semantic-repair/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { textGlyphsToImage } from '../src/features/omr/processVectorOmrPage.js'
import { normalizeLegacyMusicFontGlyphs } from '../src/features/omr/normalizeLegacyMusicFontGlyphs.js'
import { normalizeNoncanonicalArticulationGlyphs } from '../src/features/omr/normalizeNoncanonicalArticulationGlyphs.js'
import {
  evaluateSemanticMusicXml,
  normalizeSemanticNotes,
} from '../src/features/omr/semanticMusicXmlEvaluator.js'
import {
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVALUATOR_VERSION,
  resolveSemanticEvalOptions,
} from '../src/features/omr/semanticEvalTolerances.js'
import {
  buildMeasureFingerprint,
  alignMeasureSequences,
} from '../src/features/omr/semanticMeasureAlignment.js'
import {
  matchSemanticEvents,
  summarizeChordIntegrity,
} from '../src/features/omr/semanticEventMatching.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOTEHEAD_GLYPHS = new Set(['\ue0a2', '\ue0a3', '\ue0a4'])
const OUT = process.env.OMR_INVENTORY_OUT
  ? resolve(ROOT, process.env.OMR_INVENTORY_OUT)
  : join(ROOT, 'tmp/omr-semantic-repair')
mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'generated'), { recursive: true })
mkdirSync(join(OUT, 'crops'), { recursive: true })

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
      .toString()
      .trim()
  } catch {
    return null
  }
}

function expandHome(pathValue) {
  if (!pathValue) return pathValue
  if (pathValue.startsWith('~/')) return join(homedir(), pathValue.slice(2))
  return pathValue
}

function resolveFixturePath(relativePath, searchPaths) {
  for (const root of searchPaths) {
    const candidate = resolve(expandHome(root), relativePath)
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function readScoreXml(scorePath) {
  if (/\.mxl$/i.test(scorePath)) {
    const zip = await JSZip.loadAsync(readFileSync(scorePath))
    const entry =
      Object.keys(zip.files).find((name) => /score\.xml$/i.test(name)) ??
      Object.keys(zip.files).find((name) => /\.xml$/i.test(name) && !name.includes('META-INF'))
    if (!entry) throw new Error(`No MusicXML entry in ${scorePath}`)
    return zip.file(entry).async('string')
  }
  return readFileSync(scorePath, 'utf8')
}

function noteFields(note) {
  if (!note) return null
  return {
    id: note.id ?? null,
    midi: note.midi ?? null,
    label: note.label ?? null,
    onsetQuarters: note.onsetQuarters ?? null,
    durationQuarters: note.durationQuarters ?? null,
    voice: note.rawVoice ?? note.voice ?? null,
    staff: note.staff ?? null,
    isRest: Boolean(note.isRest),
    isChord: Boolean(note.isChord),
    tieStart: Boolean(note.tieStart),
    tieStop: Boolean(note.tieStop),
    dots: note.dots ?? 0,
    accidental: note.accidental ?? null,
    stemDirection: note.stemDirection ?? null,
    beams: note.beams ?? null,
    staccato: Boolean(note.staccato),
    accent: Boolean(note.accent),
  }
}

function inferClusterHint(row) {
  const code = row.code
  const pitchDelta = row.pitchDeltaSemitones
  const onsetDiff = row.onsetDiffQuarters
  const durationDiff = row.durationDiffQuarters

  if (code === 'incorrect-chord') return 'chord-grouping'
  if (code === 'missing-note' || code === 'extra-note') {
    if (row.alignmentSymptom) return 'alignment-symptom-from-onset-or-pitch'
    return 'missing-or-extra-extraction'
  }
  if (code === 'incorrect-pitch') {
    if (Math.abs(pitchDelta) === 12) return 'staff-octave-assignment'
    if (Math.abs(pitchDelta) === 1 || Math.abs(pitchDelta) === 2) return 'accidental-or-staff-position'
    return 'staff-pitch-assignment'
  }
  if (code === 'onset-mismatch') {
    if (onsetDiff != null && onsetDiff >= 0.9 && onsetDiff <= 1.1) return 'voice-onset-beat-shift'
    return 'voice-onset-assignment'
  }
  if (
    code === 'duration-mismatch' ||
    code === 'missing-dot' ||
    code === 'dotted-rhythm-error' ||
    code === 'tuplet-mismatch'
  ) {
    return 'duration-inference'
  }
  if (code === 'missing-tie' || code === 'incorrect-tie' || code === 'tie-vs-slur') {
    return 'sustain-tie'
  }
  if (code?.includes('staccato') || code?.includes('accent') || code?.includes('articulation')) {
    return 'articulation'
  }
  if (code?.includes('measure') || code === 'split-measure' || code === 'merged-measure') {
    return 'measure-structure'
  }
  if (durationDiff != null && Math.abs(durationDiff) > 0 && code !== 'incorrect-pitch') {
    return 'duration-inference'
  }
  return 'other'
}

function inferLikelyStage(clusterHint, code) {
  const map = {
    'chord-grouping': 'chord-association / coalesceSameOnsetChordEvents',
    'staff-octave-assignment': 'staff/clef pitch mapping',
    'accidental-or-staff-position': 'accidental association / staff position',
    'staff-pitch-assignment': 'staff/pitch assignment',
    'voice-onset-beat-shift': 'onset resnap / voice serialization',
    'voice-onset-assignment': 'voice/onset assignment',
    'duration-inference': 'duration rewrite (glyph→gap→beam→normalize)',
    'missing-or-extra-extraction': 'notehead detection / filtering',
    'alignment-symptom-from-onset-or-pitch': 'downstream alignment symptom',
    'sustain-tie': 'vector tie pairing / emission',
    articulation: 'articulation glyph association',
    'measure-structure': 'measure segmentation',
    other: 'unknown / late MusicXML',
  }
  return map[clusterHint] ?? `defect:${code}`
}

function collectStructuredMismatches(
  fixtureId,
  truthXml,
  generatedXml,
  options,
  pitchCalibrationSamples = [],
) {
  const resolved = resolveSemanticEvalOptions(options)
  const truthTiming = parseMusicXml(truthXml, `${fixtureId}.truth.musicxml`)
  const generatedTiming = parseMusicXml(generatedXml, `${fixtureId}.omr.musicxml`)
  const truthNotes = normalizeSemanticNotes(truthTiming, resolved)
  const generatedNotes = normalizeSemanticNotes(generatedTiming, resolved)
  const truthMeasures = truthTiming?.measures ?? []
  const generatedMeasures = generatedTiming?.measures ?? []

  const groupByIndex = (notes, measures) => {
    const byIndex = new Map(measures.map((_, index) => [index, []]))
    const byNumber = new Map(measures.map((measure, index) => [measure.number, index]))
    for (const note of notes) {
      const index = byNumber.get(note.measureNumber)
      if (index == null) continue
      byIndex.get(index).push(note)
    }
    return byIndex
  }

  const truthByIndex = groupByIndex(truthNotes, truthMeasures)
  const generatedByIndex = groupByIndex(generatedNotes, generatedMeasures)

  const alignment = alignMeasureSequences(
    truthMeasures.map((measure, index) =>
      buildMeasureFingerprint(measure, truthByIndex.get(index) ?? []),
    ),
    generatedMeasures.map((measure, index) =>
      buildMeasureFingerprint(measure, generatedByIndex.get(index) ?? []),
    ),
    resolved,
  )

  const rows = []

  for (const link of alignment.pairs ?? []) {
    const truthNums = (link.truthMeasureNumbers ?? []).filter((n) => n != null)
    const generatedNums = (link.generatedMeasureNumbers ?? []).filter((n) => n != null)
    const truthMeasure = truthNums[0] ?? null
    const generatedMeasure = generatedNums[0] ?? null

    if (link.kind !== 'match') {
      rows.push({
        fixture: fixtureId,
        code:
          link.kind === 'missing'
            ? 'missing-measure'
            : link.kind === 'extra'
              ? 'extra-measure'
              : link.kind === 'split'
                ? 'split-measure'
                : link.kind === 'merge'
                  ? 'merged-measure'
                  : `measure-${link.kind}`,
        class: 'measure-structure',
        measure: truthMeasure ?? generatedMeasure,
        truthMeasure,
        generatedMeasure,
        truthMeasures: truthNums,
        generatedMeasures: generatedNums,
        expected: null,
        generated: null,
        source: 'measure-alignment',
      })
      // For unmatched measures, emit missing/extra notes like the evaluator.
      if (link.kind === 'missing') {
        for (const truthIndex of link.truthIndexes ?? []) {
          for (const note of truthByIndex.get(truthIndex) ?? []) {
            if (note.isRest) continue
            rows.push({
              fixture: fixtureId,
              code: 'missing-note',
              class: 'pitch',
              measure: note.measureNumber,
              truthMeasure: note.measureNumber,
              generatedMeasure: null,
              expected: noteFields(note),
              generated: null,
              source: 'unmatched-measure',
              alignmentSymptom: true,
            })
          }
        }
      }
      if (link.kind === 'extra') {
        for (const generatedIndex of link.generatedIndexes ?? []) {
          for (const note of generatedByIndex.get(generatedIndex) ?? []) {
            if (note.isRest) continue
            rows.push({
              fixture: fixtureId,
              code: 'extra-note',
              class: 'pitch',
              measure: note.measureNumber,
              truthMeasure: null,
              generatedMeasure: note.measureNumber,
              expected: null,
              generated: noteFields(note),
              source: 'unmatched-measure',
              alignmentSymptom: true,
            })
          }
        }
      }
      continue
    }

    if (truthMeasure == null || generatedMeasure == null) continue

    const truthIndex = link.truthIndexes?.[0]
    const generatedIndex = link.generatedIndexes?.[0]
    const truth = truthByIndex.get(truthIndex) ?? []
    const generated = generatedByIndex.get(generatedIndex) ?? []
    const matched = matchSemanticEvents(truth, generated, resolved)
    const chords = summarizeChordIntegrity(
      matched.matches,
      matched.missing,
      matched.extra,
      resolved,
    )

    for (const pair of matched.matches) {
      if (!pair.truth.isRest && !pair.generated.isRest) {
        pitchCalibrationSamples.push({
          fixture: fixtureId,
          code: 'pitch-calibration-sample',
          class: 'pitch',
          measure: truthMeasure,
          truthMeasure,
          generatedMeasure,
          expected: noteFields(pair.truth),
          generated: noteFields(pair.generated),
          pitchDeltaSemitones: pair.pitchDeltaSemitones,
          pitchCorrect: Boolean(pair.pitchCorrect),
          source: 'event-match-calibration',
        })
      }
      const failures = []
      if (!pair.pitchCorrect && !pair.truth.isRest) failures.push('incorrect-pitch')
      if (!pair.onsetCorrect) failures.push('onset-mismatch')
      if (!pair.durationCorrect && !pair.truth.isRest) failures.push('duration-mismatch')
      if (!pair.voiceCorrect) failures.push('voice-mismatch')
      if (!pair.staffCorrect) failures.push('staff-mismatch')
      if (
        Boolean(pair.truth.tieStart) !== Boolean(pair.generated.tieStart) ||
        Boolean(pair.truth.tieStop) !== Boolean(pair.generated.tieStop)
      ) {
        if (
          pair.truth.tieStart ||
          pair.truth.tieStop ||
          pair.generated.tieStart ||
          pair.generated.tieStop
        ) {
          failures.push(
            (pair.truth.tieStart || pair.truth.tieStop) &&
              !(pair.generated.tieStart || pair.generated.tieStop)
              ? 'missing-tie'
              : 'incorrect-tie',
          )
        }
      }
      for (const code of failures) {
        rows.push({
          fixture: fixtureId,
          code,
          class:
            code.includes('pitch') || code.includes('staff')
              ? 'pitch'
              : code.includes('tie')
                ? 'sustain'
                : code.includes('voice')
                  ? 'measure-structure'
                  : 'rhythm',
          measure: truthMeasure,
          truthMeasure,
          generatedMeasure,
          expected: noteFields(pair.truth),
          generated: noteFields(pair.generated),
          pitchDeltaSemitones: pair.pitchDeltaSemitones,
          onsetDiffQuarters: pair.onsetDiffQuarters,
          durationDiffQuarters: pair.durationDiffQuarters,
          source: 'event-match',
        })
      }
    }

    for (const note of matched.missing) {
      rows.push({
        fixture: fixtureId,
        code: note.isRest ? 'missing-rest' : 'missing-note',
        class: note.isRest ? 'rhythm' : 'pitch',
        measure: truthMeasure,
        truthMeasure,
        generatedMeasure,
        expected: noteFields(note),
        generated: null,
        source: 'event-match',
      })
    }
    for (const note of matched.extra) {
      rows.push({
        fixture: fixtureId,
        code: note.isRest ? 'extra-rest' : 'extra-note',
        class: note.isRest ? 'rhythm' : 'pitch',
        measure: truthMeasure,
        truthMeasure,
        generatedMeasure,
        expected: null,
        generated: noteFields(note),
        source: 'event-match',
      })
    }

    for (const example of chords.examples ?? []) {
      rows.push({
        fixture: fixtureId,
        code: 'incorrect-chord',
        class: 'measure-structure',
        measure: truthMeasure,
        truthMeasure,
        generatedMeasure,
        expectedChordMidis: example.truth ?? null,
        generatedChordMidis: example.generated ?? null,
        source: 'chord-integrity',
      })
    }
  }

  return rows
}

function rounded(value, digits = 3) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const DIATONIC_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
const CLEF_BOTTOM = {
  treble: { step: 'E', octave: 4 },
  bass: { step: 'G', octave: 2 },
}

function pitchLabelParts(label) {
  const match = /^([A-G])(?:#{1,2}|b{1,2})?(-?\d+)$/.exec(String(label ?? ''))
  if (!match) return null
  return { step: match[1], octave: Number(match[2]) }
}

function diatonicNumber(parts) {
  if (!parts || DIATONIC_STEP[parts.step] == null || !Number.isFinite(parts.octave)) return null
  return parts.octave * 7 + DIATONIC_STEP[parts.step]
}

function staffPositionForPitch(label, clefSign) {
  const pitch = diatonicNumber(pitchLabelParts(label))
  const bottom = diatonicNumber(CLEF_BOTTOM[clefSign] ?? CLEF_BOTTOM.treble)
  return Number.isFinite(pitch) && Number.isFinite(bottom) ? pitch - bottom : null
}

function pixelIsInk(data, width, x, y, threshold = 170) {
  if (!data?.length || x < 0 || y < 0 || x >= width) return false
  const offset = (y * width + x) * 4
  const alpha = data[offset + 3] ?? 255
  if (alpha < 16) return false
  const luminance =
    (data[offset] ?? 255) * 0.2126 +
    (data[offset + 1] ?? 255) * 0.7152 +
    (data[offset + 2] ?? 255) * 0.0722
  return luminance < threshold
}

function compactInkBounds(imageData, note, gapPx) {
  if (!imageData?.data?.length || !Number.isFinite(note?.cx) || !Number.isFinite(note?.cy)) {
    return null
  }
  const radiusX = Math.max(5, Math.round(gapPx * 0.9))
  const radiusY = Math.max(4, Math.round(gapPx * 0.75))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let y = Math.max(0, Math.floor(note.cy - radiusY)); y <= Math.min(imageData.height - 1, Math.ceil(note.cy + radiusY)); y += 1) {
    for (let x = Math.max(0, Math.floor(note.cx - radiusX)); x <= Math.min(imageData.width - 1, Math.ceil(note.cx + radiusX)); x += 1) {
      if (!pixelIsInk(imageData.data, imageData.width, x, y)) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (!Number.isFinite(x0)) return null
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

function ledgerCandidatesForNote(imageData, note, lineYs) {
  if (!lineYs?.length || !Number.isFinite(note?.cx) || !Number.isFinite(note?.yNorm)) return []
  const sorted = [...lineYs].sort((a, b) => a - b)
  const gapNorm = (sorted[sorted.length - 1] - sorted[0]) / 4
  if (!(gapNorm > 0)) return []
  const candidates = []
  const above = note.yNorm < sorted[0] - gapNorm * 0.35
  const below = note.yNorm > sorted[sorted.length - 1] + gapNorm * 0.35
  if (!above && !below) return candidates
  const boundary = above ? sorted[0] : sorted[sorted.length - 1]
  const direction = above ? -1 : 1
  const count = Math.min(8, Math.max(1, Math.ceil(Math.abs(note.yNorm - boundary) / gapNorm)))
  const halfWidth = Math.max(5, Math.round(gapNorm * imageData.height * 0.9))
  for (let index = 1; index <= count; index += 1) {
    const yNorm = boundary + direction * gapNorm * index
    const y = Math.round(yNorm * imageData.height)
    let ink = 0
    let total = 0
    for (let x = Math.max(0, Math.round(note.cx - halfWidth)); x <= Math.min(imageData.width - 1, Math.round(note.cx + halfWidth)); x += 1) {
      total += 1
      if (
        pixelIsInk(imageData.data, imageData.width, x, y - 1) ||
        pixelIsInk(imageData.data, imageData.width, x, y) ||
        pixelIsInk(imageData.data, imageData.width, x, y + 1)
      ) {
        ink += 1
      }
    }
    candidates.push({
      direction: above ? 'above' : 'below',
      index,
      yNorm: rounded(yNorm, 6),
      distanceFromAnchorInStaffSpaces: rounded(Math.abs(note.yNorm - yNorm) / gapNorm, 3),
      horizontalInkRatio: total ? rounded(ink / total, 3) : null,
      supported: total ? ink / total >= 0.45 : false,
    })
  }
  return candidates
}

function normalizedPageGlyphs(pageText, imageData) {
  const legacy = normalizeLegacyMusicFontGlyphs(pageText ?? [])
  const articulations = normalizeNoncanonicalArticulationGlyphs(legacy.items)
  return textGlyphsToImage(articulations.items, imageData)
}

function nearestNoteheadGlyph(note, noteheadGlyphs) {
  if (!Number.isFinite(note?.cx) || !Number.isFinite(note?.cy)) return null
  let best = null
  let bestDistance = Infinity
  for (const glyph of noteheadGlyphs) {
    const dx = Math.abs(glyph.x - note.cx)
    const dy = Math.abs(glyph.y - note.cy)
    const distance = dx + dy * 2
    if (distance < bestDistance) {
      best = glyph
      bestDistance = distance
    }
  }
  if (!best) return null
  const tolerance = Math.max(2, (best.height || best.width || 4) * 0.45)
  return bestDistance <= tolerance ? best : null
}

function capturePagePitchGeometry(imageData, context, pageResult, geometryByNote) {
  const noteheadGlyphs = normalizedPageGlyphs(context.pageText, imageData).filter((glyph) =>
    NOTEHEAD_GLYPHS.has(glyph.text),
  )
  const sourceItem = context.pageText?.find(
    (item) => Number.isFinite(item?.pageWidth) && Number.isFinite(item?.pageHeight),
  )
  const projection = sourceItem
    ? {
        kind: 'pdf-text-origin-to-analysis-image',
        scaleX: rounded(imageData.width / sourceItem.pageWidth, 6),
        scaleY: rounded(imageData.height / sourceItem.pageHeight, 6),
        yAxisInverted: true,
        fullPdfTextMatrixAvailable: false,
      }
    : null

  for (const measure of pageResult.measureRhythms ?? []) {
    for (const event of measure.events ?? []) {
      if (event.type !== 'note') continue
      for (const note of event.notes ?? []) {
        const glyph = nearestNoteheadGlyph(note, noteheadGlyphs)
        const lineYs = note?.pitchMapping?.lineYs ?? []
        const gapNorm = lineYs.length >= 2
          ? (Math.max(...lineYs) - Math.min(...lineYs)) / 4
          : null
        const gapPx = Number.isFinite(gapNorm) ? gapNorm * imageData.height : 0
        const rawAnchorYNorm = Number.isFinite(glyph?.y)
          ? glyph.y / imageData.height
          : Number.isFinite(note.cy)
            ? note.cy / imageData.height
            : note.yNorm
        const heightNorm = glyph?.height ? glyph.height / imageData.height : null
        const selectedAnchorYNorm = note.yNorm ?? rawAnchorYNorm
        const sortedLines = [...lineYs].sort((a, b) => a - b)
        const generatedStaffPosition = sortedLines.length && gapNorm > 0
          ? Math.round(((sortedLines[sortedLines.length - 1] - selectedAnchorYNorm) / gapNorm) * 2)
          : null
        const box = glyph
          ? {
              x: rounded(glyph.x - glyph.width / 2, 3),
              y: rounded(glyph.y - glyph.height, 3),
              width: rounded(glyph.width, 3),
              height: rounded(glyph.height, 3),
            }
          : compactInkBounds(imageData, note, gapPx)
        geometryByNote.set(note, {
          source: glyph ? 'pdf-text-glyph' : note.source ?? 'raster-or-path',
          glyphIdentity: glyph ? `U+${glyph.text.codePointAt(0).toString(16).toUpperCase()}` : null,
          glyphText: glyph?.text ?? null,
          glyphKind: note.noteheadGlyph ?? null,
          fontName: glyph?.fontName ?? null,
          boundingBox: box,
          rawPdfTextBaselineYNorm: rounded(rawAnchorYNorm, 6),
          fullBoundingBoxCenterYNorm: box
            ? rounded((box.y + box.height / 2) / imageData.height, 6)
            : null,
          selectedAnchorYNorm: rounded(selectedAnchorYNorm, 6),
          anchorAdjustmentInGlyphHeights:
            Number.isFinite(heightNorm) && heightNorm > 0
              ? rounded((rawAnchorYNorm - selectedAnchorYNorm) / heightNorm, 4)
              : null,
          glyphHeightToStaffSpaceRatio:
            Number.isFinite(heightNorm) && gapNorm > 0 ? rounded(heightNorm / gapNorm, 4) : null,
          staffLineCoordinates: sortedLines.map((value) => rounded(value, 6)),
          localStaffSpacing: rounded(gapNorm, 6),
          generatedStaffPosition,
          nearestLedgerLineCandidates: ledgerCandidatesForNote(imageData, note, lineYs),
          vectorTransform: projection,
          anchorDiagnostics: note.noteheadAnchor ?? null,
        })
      }
    }
  }
}

function nearestBeamHead(beamStemGraph, note) {
  if (!Number.isFinite(note?.cx) || !Number.isFinite(note?.cy)) return null
  let best = null
  let bestDistance = Infinity
  for (const head of beamStemGraph?.noteheads ?? []) {
    const distance =
      Math.abs((head.cx ?? 0) - note.cx) + Math.abs((head.cy ?? 0) - note.cy)
    if (distance < bestDistance && distance <= 14) {
      best = head
      bestDistance = distance
    }
  }
  return best
}

function indexPipelineMeasures(capturedPages, scoreGraph, geometryByNote = new WeakMap()) {
  const graphByMeasure = new Map(
    (scoreGraph?.measures ?? []).map((measure) => [measure.measureNumber, measure]),
  )
  const byMeasure = new Map()

  for (const pageResult of capturedPages) {
    for (const measure of pageResult.measureRhythms ?? []) {
      const graph = graphByMeasure.get(measure.measureNumber) ?? null
      const notes = []
      for (let eventIndex = 0; eventIndex < (measure.events ?? []).length; eventIndex += 1) {
        const event = measure.events[eventIndex]
        if (event.type !== 'note') continue
        for (let noteIndex = 0; noteIndex < (event.notes ?? []).length; noteIndex += 1) {
          const note = event.notes[noteIndex]
          const beamHead = nearestBeamHead(measure.beamStemGraph, note)
          const candidateId =
            beamHead?.id ??
            `p${measure.page ?? pageResult.pageEntry?.page ?? 'x'}-m${measure.measureNumber}-c${eventIndex}-${noteIndex}`
          const glyphId = Number.isFinite(note.cx) && Number.isFinite(note.cy)
            ? `vector-glyph:p${measure.page ?? pageResult.pageEntry?.page ?? 'x'}:m${measure.measureNumber}:x${Math.round(note.cx)}:y${Math.round(note.cy)}`
            : null
          notes.push({
            eventIndex,
            noteIndex,
            event,
            note,
            beamHead,
            candidateId,
            glyphId,
            onsetQuarters: (event.startDivision ?? 0) / 4,
            durationQuarters: (event.durationDivisions ?? 0) / 4,
            staff: note.clef === 'bass' ? 2 : 1,
            voice: note.clef === 'bass' ? 2 : 1,
            pitchGeometry: geometryByNote.get(note) ?? null,
          })
        }
      }
      byMeasure.set(measure.measureNumber, {
        measure,
        graph,
        page: measure.page ?? pageResult.pageEntry?.page ?? null,
        system: measure.systemIndex ?? null,
        notes,
        noteMatching: measure.vectorNoteMatching ?? null,
        chordDiagnostics: measure.vectorChordDiagnostics ?? null,
        rhythmDiagnostics: measure.vectorRhythmDiagnostics ?? null,
        reconstruction: measure.musicalEventReconstructionDiagnostics ?? null,
        accidentalDiagnostics: measure.vectorAccidentalDiagnostics ?? null,
        keySignature: pageResult.keySignature ?? null,
      })
    }
  }
  return byMeasure
}

function noteContextScore(context, generated) {
  if (!generated) return Infinity
  let score = 0
  if (Number.isFinite(generated.midi) && context.note.midi !== generated.midi) score += 100
  score += Math.abs(context.onsetQuarters - (generated.onsetQuarters ?? 0)) * 12
  score += Math.abs(context.durationQuarters - (generated.durationQuarters ?? 0)) * 2
  if (generated.staff != null && context.staff !== generated.staff) score += 8
  return score
}

function exactChordContexts(measureContext, generatedMidis) {
  if (!measureContext || !Array.isArray(generatedMidis)) return []
  const target = [...generatedMidis].sort((a, b) => a - b).join(',')
  const events = new Map()
  for (const context of measureContext.notes) {
    if (!events.has(context.eventIndex)) events.set(context.eventIndex, [])
    events.get(context.eventIndex).push(context)
  }
  for (const contexts of events.values()) {
    const midis = contexts.map((entry) => entry.note.midi).sort((a, b) => a - b).join(',')
    if (midis === target) return contexts
  }
  return []
}

function resolveRowContexts(row, measureContext) {
  if (!measureContext) return []
  if (row.code === 'incorrect-chord') {
    const exact = exactChordContexts(measureContext, row.generatedChordMidis)
    if (exact.length) return exact
    const target = new Set(row.generatedChordMidis ?? [])
    const byEvent = new Map()
    for (const context of measureContext.notes) {
      if (!byEvent.has(context.eventIndex)) byEvent.set(context.eventIndex, [])
      byEvent.get(context.eventIndex).push(context)
    }
    const closest = [...byEvent.values()]
      .map((contexts) => ({
        contexts,
        overlap: contexts.filter((context) => target.has(context.note.midi)).length,
        sizeDelta: Math.abs(contexts.length - target.size),
      }))
      .sort((left, right) => right.overlap - left.overlap || left.sizeDelta - right.sizeDelta)[0]
    return closest?.overlap > 0 ? closest.contexts : []
  }
  if (row.generated) {
    const ranked = measureContext.notes
      .map((context) => ({ context, score: noteContextScore(context, row.generated) }))
      .sort((left, right) => left.score - right.score)
    return ranked.length ? [ranked[0].context] : []
  }
  if (row.expected) {
    const sameOnset = measureContext.notes.filter(
      (context) =>
        Math.abs(context.onsetQuarters - (row.expected.onsetQuarters ?? 0)) <= 0.26 &&
        (row.expected.staff == null || context.staff === row.expected.staff),
    )
    return sameOnset.slice(0, 8)
  }
  return []
}

function firstDivergenceForRow(row, contexts, measureContext) {
  const primary = contexts[0] ?? null
  const expectedMidi = row.expected?.midi
  const generatedMidi = row.generated?.midi
  const rawNaturalMidi = primary?.note?.naturalMidi

  if (row.code === 'incorrect-pitch') {
    if (Number.isFinite(expectedMidi) && rawNaturalMidi === expectedMidi) {
      return {
        stage: 'accidental_state',
        rule: 'local/key/measure accidental application',
        evidence: 'Detected staff position was correct before pitch alteration.',
        confidence: 0.95,
      }
    }
    if (Math.abs((generatedMidi ?? 0) - (expectedMidi ?? 0)) === 12) {
      return {
        stage: 'staff_assignment',
        rule: 'grand-staff clef/ledger mapping',
        evidence: 'Pitch differs by exactly one octave at the detected notehead.',
        confidence: 0.9,
      }
    }
    return {
      stage: 'pitch_mapping',
      rule: 'staff position / clef / ledger mapping',
      evidence: `Detector natural MIDI ${rawNaturalMidi ?? 'unknown'} already differs from expected ${expectedMidi ?? 'unknown'}.`,
      confidence: primary ? 0.85 : 0.55,
    }
  }

  if (row.code === 'staff-mismatch') {
    return {
      stage: 'staff_assignment',
      rule: 'clef/staff lane classification',
      evidence: 'Generated note reached event construction on the wrong staff.',
      confidence: 0.95,
    }
  }
  if (row.code === 'voice-mismatch') {
    return {
      stage: 'voice_assignment',
      rule: 'clef voice serialization / stem lane ownership',
      evidence: 'Pitch and timing matched before the emitted voice differed.',
      confidence: 0.95,
    }
  }

  if (row.code === 'incorrect-chord') {
    const expectedCount = row.expectedChordMidis?.length ?? 0
    const generatedCount = row.generatedChordMidis?.length ?? 0
    if (expectedCount === generatedCount && expectedCount > 0) {
      return {
        stage: 'pitch_mapping',
        rule: 'pitch error masquerading as chord-integrity error',
        evidence: 'Chord cardinality is intact; only pitch membership differs.',
        confidence: 0.9,
      }
    }
    return {
      stage: 'chord_grouping',
      rule:
        generatedCount > expectedCount
          ? 'nearby notes/voices merged or duplicated'
          : 'chord tones split, dropped, or assigned to an adjacent onset',
      evidence: `Expected ${expectedCount} chord tones and emitted ${generatedCount}.`,
      confidence: contexts.length ? 0.85 : 0.65,
    }
  }

  if (row.code === 'onset-mismatch') {
    return {
      stage: 'rhythm_packing',
      rule: 'position snap / lane gap packing / dense onset resnap',
      evidence: `Candidate survived with onset ${row.generated?.onsetQuarters}; expected ${row.expected?.onsetQuarters}.`,
      confidence: primary ? 0.85 : 0.6,
    }
  }
  if (
    row.code === 'duration-mismatch' ||
    row.code === 'missing-dot' ||
    row.code === 'dotted-rhythm-error' ||
    row.code === 'tuplet-mismatch'
  ) {
    return {
      stage: 'duration_inference',
      rule: 'glyph/beam inference followed by gap extension and normalization',
      evidence: `Detector duration ${primary?.note?.durationDivisions ?? 'unknown'} divisions; event duration ${primary?.event?.durationDivisions ?? 'unknown'} divisions.`,
      confidence: primary ? 0.85 : 0.55,
    }
  }
  if (row.code === 'missing-note') {
    const detected = measureContext?.noteMatching?.detectedNoteheads ?? null
    const emitted = measureContext?.noteMatching?.emittedNoteheads ?? null
    if (Number.isFinite(detected) && Number.isFinite(emitted) && detected > emitted) {
      return {
        stage: 'note_ownership',
        rule: 'dedupe/group/filter after detection',
        evidence: `${detected} noteheads detected but only ${emitted} emitted in the measure.`,
        confidence: 0.9,
      }
    }
    return {
      stage: 'symbol_detection',
      rule: 'notehead not detected or measure alignment lost it',
      evidence: 'No emitted candidate matches the expected pitch/onset.',
      confidence: row.alignmentSymptom ? 0.45 : 0.7,
    }
  }
  if (row.code === 'extra-note') {
    return {
      stage: 'symbol_detection',
      rule: 'duplicate/false notehead or note ownership duplication',
      evidence: 'An emitted candidate has no semantic truth counterpart.',
      confidence: primary ? 0.75 : 0.5,
    }
  }
  if (row.code?.includes('tie')) {
    return {
      stage: 'sustain_association',
      rule: 'tie candidate ownership / MusicXML emission',
      evidence: 'Note event exists but tie state differs.',
      confidence: 0.85,
    }
  }
  return {
    stage: inferLikelyStage(inferClusterHint(row), row.code),
    rule: 'first demonstrable divergence not available below measure level',
    evidence: row.message ?? null,
    confidence: 0.4,
  }
}

function enrichRow(row, pipelineMeasures = new Map()) {
  const clusterHint = inferClusterHint(row)
  const measureContext =
    pipelineMeasures.get(row.generatedMeasure) ??
    pipelineMeasures.get(row.truthMeasure) ??
    pipelineMeasures.get(row.measure) ??
    null
  const contexts = resolveRowContexts(row, measureContext)
  const primary = contexts[0] ?? null
  const ownership = primary?.beamHead?.beamOwnership ?? null
  const firstDivergence = firstDivergenceForRow(row, contexts, measureContext)
  const candidateIds = [...new Set(contexts.map((context) => context.candidateId).filter(Boolean))]
  const glyphIds = [...new Set(contexts.map((context) => context.glyphId).filter(Boolean))]
  const eventMidis = primary?.event?.notes?.map((note) => note.midi).filter(Number.isFinite) ?? []
  const geometry = primary?.pitchGeometry ?? null
  const expectedPitchParts = pitchLabelParts(row.expected?.label)
  const generatedPitchParts = pitchLabelParts(row.generated?.label)
  const expectedDiatonic = diatonicNumber(expectedPitchParts)
  const generatedDiatonic = diatonicNumber(generatedPitchParts)
  const activeClef = primary?.note?.pitchMapping?.clefSign ?? primary?.note?.clef ?? null
  const expectedStaffPosition = staffPositionForPitch(row.expected?.label, activeClef)
  const generatedStaffPosition = geometry?.generatedStaffPosition ??
    staffPositionForPitch(row.generated?.label, activeClef)
  const lineYs = geometry?.staffLineCoordinates ?? primary?.note?.pitchMapping?.lineYs ?? []
  const lineGap = geometry?.localStaffSpacing ??
    (lineYs.length >= 2 ? (Math.max(...lineYs) - Math.min(...lineYs)) / 4 : null)
  const rawY = geometry?.rawPdfTextBaselineYNorm
  const glyphHeightNorm = geometry?.boundingBox?.height && measureContext?.measure?.imageHeight
    ? geometry.boundingBox.height / measureContext.measure.imageHeight
    : null
  const expectedAnchorYNorm =
    Number.isFinite(expectedStaffPosition) && lineYs.length && lineGap > 0
      ? Math.max(...lineYs) - (expectedStaffPosition * lineGap) / 2
      : null
  const idealAnchorAdjustmentInGlyphHeights =
    Number.isFinite(rawY) && Number.isFinite(expectedAnchorYNorm) && glyphHeightNorm > 0
      ? (rawY - expectedAnchorYNorm) / glyphHeightNorm
      : Number.isFinite(rawY) && Number.isFinite(expectedAnchorYNorm) &&
          geometry?.glyphHeightToStaffSpaceRatio > 0 && lineGap > 0
        ? (rawY - expectedAnchorYNorm) /
          (geometry.glyphHeightToStaffSpaceRatio * lineGap)
        : null
  const pitchCategories = []
  if (row.code === 'incorrect-pitch') {
    const expectedMidi = row.expected?.midi
    const emittedMidi = row.generated?.midi
    const naturalMidi = primary?.note?.naturalMidi
    const alternateMidi = primary?.note?.pitchMapping?.alternateMidi
    if (Number.isFinite(expectedMidi) && naturalMidi === expectedMidi && emittedMidi !== expectedMidi) {
      pitchCategories.push('accidental-error')
    }
    if (Number.isFinite(expectedMidi) && alternateMidi === expectedMidi) {
      pitchCategories.push('wrong-clef-or-staff-ownership')
    }
    if (row.expected?.staff != null && row.generated?.staff != null && row.expected.staff !== row.generated.staff) {
      pitchCategories.push('wrong-staff-ownership')
    }
    if (Number.isFinite(expectedPitchParts?.octave) && Number.isFinite(generatedPitchParts?.octave) && expectedPitchParts.octave !== generatedPitchParts.octave) {
      pitchCategories.push('octave-displacement')
    }
    if (geometry?.nearestLedgerLineCandidates?.length) {
      pitchCategories.push('ledger-line-ownership')
    }
    if (
      geometry?.source === 'pdf-text-glyph' &&
      Number.isFinite(expectedStaffPosition) &&
      generatedStaffPosition !== expectedStaffPosition &&
      Math.abs((generatedStaffPosition ?? 0) - expectedStaffPosition) <= 2 &&
      Number.isFinite(idealAnchorAdjustmentInGlyphHeights) &&
      idealAnchorAdjustmentInGlyphHeights >= -0.1 &&
      idealAnchorAdjustmentInGlyphHeights <= 0.75
    ) {
      pitchCategories.push('glyph-center-offset')
    }
    if (Number.isFinite(expectedDiatonic) && Number.isFinite(generatedDiatonic) && expectedDiatonic !== generatedDiatonic) {
      pitchCategories.push('wrong-staff-step-anchor')
    }
    if (!pitchCategories.length) pitchCategories.push('evaluator-alignment-symptom-or-unresolved')
  }
  return {
    ...row,
    page: measureContext?.page ?? null,
    system: measureContext?.system ?? null,
    staff: row.expected?.staff ?? row.generated?.staff ?? primary?.staff ?? null,
    voice: row.expected?.voice ?? row.generated?.voice ?? primary?.voice ?? null,
    expectedNotes: row.expected ? [row.expected] : (row.expectedChordMidis ?? []),
    generatedNotes: row.generated ? [row.generated] : (row.generatedChordMidis ?? []),
    expectedPitch: row.expected?.label ?? row.expected?.midi ?? null,
    generatedPitch: row.generated?.label ?? row.generated?.midi ?? null,
    expectedOnset: row.expected?.onsetQuarters ?? null,
    generatedOnset: row.generated?.onsetQuarters ?? null,
    expectedDuration: row.expected?.durationQuarters ?? null,
    generatedDuration: row.generated?.durationQuarters ?? null,
    expectedChord: row.expectedChordMidis ?? (row.expected?.isChord ? [row.expected.midi] : null),
    generatedChord:
      row.generatedChordMidis ??
      (row.generated?.isChord ? (eventMidis.length ? eventMidis : [row.generated.midi]) : null),
    pitchDifference: row.pitchDeltaSemitones ?? null,
    semitoneDifference: row.pitchDeltaSemitones ?? null,
    diatonicStaffStepDifference:
      Number.isFinite(expectedDiatonic) && Number.isFinite(generatedDiatonic)
        ? generatedDiatonic - expectedDiatonic
        : null,
    octaveDifference:
      Number.isFinite(expectedPitchParts?.octave) && Number.isFinite(generatedPitchParts?.octave)
        ? generatedPitchParts.octave - expectedPitchParts.octave
        : null,
    activeClef,
    activeKeySignature: measureContext?.keySignature ?? null,
    noteheadBoundingBox: geometry?.boundingBox ?? null,
    noteheadPathOrGlyphSource: geometry?.source ?? primary?.note?.source ?? null,
    computedNoteheadCenter: geometry
      ? {
          selectedYNorm: geometry.selectedAnchorYNorm,
          rawPdfTextBaselineYNorm: geometry.rawPdfTextBaselineYNorm,
          fullBoundingBoxCenterYNorm: geometry.fullBoundingBoxCenterYNorm,
          anchorAdjustmentInGlyphHeights: geometry.anchorAdjustmentInGlyphHeights,
          idealAnchorAdjustmentInGlyphHeights: rounded(idealAnchorAdjustmentInGlyphHeights, 4),
          glyphHeightToStaffSpaceRatio: geometry.glyphHeightToStaffSpaceRatio,
          anchorDiagnostics: geometry.anchorDiagnostics,
        }
      : null,
    staffLineCoordinates: lineYs,
    nearestLedgerLineCandidates: geometry?.nearestLedgerLineCandidates ?? [],
    selectedStaffAnchor: geometry?.selectedAnchorYNorm ?? primary?.note?.yNorm ?? null,
    generatedStaffPosition,
    expectedStaffPosition,
    vectorTransform: geometry?.vectorTransform ?? null,
    fontOrGlyphIdentity: geometry
      ? {
          fontName: geometry.fontName,
          glyphIdentity: geometry.glyphIdentity,
          glyphKind: geometry.glyphKind,
        }
      : null,
    pitchErrorCategories: pitchCategories,
    expectedChordMembership: row.expected?.isChord ?? null,
    generatedChordMembership: row.generated?.isChord ?? null,
    expectedAccidental: row.expected?.accidental ?? null,
    generatedAccidental: row.generated?.accidental ?? null,
    expectedStemDirection: row.expected?.stemDirection ?? null,
    generatedStemDirection:
      row.generated?.stemDirection ?? primary?.note?.stem?.direction ?? ownership?.stemDirection ?? null,
    expectedBeamState: row.expected?.beams ?? null,
    generatedBeamState: row.generated?.beams ?? primary?.note?.beams ?? ownership?.beamCount ?? null,
    noteCandidateIds: candidateIds,
    glyphIds,
    stemOwnership: ownership
      ? {
          attachedStemId: ownership.attachedStemId ?? null,
          stemDirection: ownership.stemDirection ?? null,
          likelyVoiceId: ownership.likelyVoiceId ?? null,
          likelyVoiceRole: ownership.likelyVoiceRole ?? null,
          confidence: ownership.stemConfidence ?? ownership.confidence ?? null,
        }
      : null,
    beamOwnership: ownership
      ? {
          attachedBeamIds: ownership.attachedBeamIds ?? [],
          beamGroupId: ownership.beamGroupId ?? null,
          beamCount: ownership.beamCount ?? null,
          expectedDivisions: ownership.expectedDivisions ?? null,
          confidence: ownership.beamConfidence ?? ownership.confidence ?? null,
        }
      : null,
    accidentalProvenance: primary?.note?.pitchAlteration ?? null,
    confidenceScores: {
      candidate: primary?.note?.confidence ?? null,
      pitch: primary?.note?.pitchConfidence ?? null,
      rhythm: primary?.note?.rhythmConfidence ?? primary?.event?.confidence ?? null,
      measure: measureContext?.measure?.confidence ?? null,
      stem: ownership?.stemConfidence ?? null,
      beam: ownership?.beamConfidence ?? null,
    },
    noteheadGlyphClassification: primary?.note?.noteheadGlyph ?? null,
    generatedConfidence: primary?.note?.confidence ?? null,
    durationProvenance: {
      detectedType: primary?.note?.durationType ?? null,
      detectedDivisions: primary?.note?.durationDivisions ?? null,
      emittedDivisions: primary?.event?.durationDivisions ?? null,
      dotted: Boolean(primary?.note?.dotted),
      beams: primary?.note?.beams ?? null,
      beamStrength: primary?.note?.beamStrength ?? null,
      packing: primary?.note?.rhythmPacking ?? null,
    },
    pitchProvenance: {
      naturalMidi: primary?.note?.naturalMidi ?? null,
      emittedMidi: primary?.note?.midi ?? null,
      clef: primary?.note?.clef ?? null,
      pitchMapping: primary?.note?.pitchMapping ?? null,
      alteration: primary?.note?.pitchAlteration ?? null,
    },
    chordGroupingProvenance: {
      eventIndex: primary?.eventIndex ?? null,
      eventOnsetDivisions: primary?.event?.startDivision ?? null,
      eventMidis,
      eventNoteCount: primary?.event?.notes?.length ?? null,
      measureDiagnostics: measureContext?.chordDiagnostics ?? null,
      reconstruction: measureContext?.reconstruction ?? null,
    },
    staffAssignmentProvenance: {
      detectedClef: primary?.note?.clef ?? null,
      detectedStaffRole: primary?.note?.pitchMapping?.staffRole ?? null,
      emittedStaff: primary?.staff ?? null,
      graphStaffLane:
        measureContext?.graph?.nodes?.find((node) => node.id === primary?.candidateId)?.staffLane ?? null,
    },
    clusterHint,
    firstPipelineStageWhereDivergenceAppears: firstDivergence,
    likelyPipelineStage: firstDivergence.stage,
    provenanceNote: contexts.length
      ? 'Joined to detector/event geometry by measure, MIDI, onset, duration, staff, and nearest notehead coordinates.'
      : 'No unique generated candidate exists; divergence is classified from measure-level detector/emission counts.',
  }
}

function toCsv(rows) {
  const cols = [
    'fixture',
    'code',
    'class',
    'measure',
    'staff',
    'voice',
    'expectedPitch',
    'generatedPitch',
    'expectedOnset',
    'generatedOnset',
    'expectedDuration',
    'generatedDuration',
    'pitchDeltaSemitones',
    'onsetDiffQuarters',
    'durationDiffQuarters',
    'clusterHint',
    'likelyPipelineStage',
    'source',
  ]
  const esc = (value) => {
    const text = value == null ? '' : String(value)
    return /["',\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return [cols.join(','), ...rows.map((row) => cols.map((col) => esc(row[col])).join(','))].join(
    '\n',
  )
}

function loadFixtures() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'))
  const roots = (manifest.fixtureSearchPaths ?? ['benchmarks/omr-fixtures']).map((path) =>
    path.startsWith('~/') || path.startsWith('/') ? expandHome(path) : join(ROOT, path),
  )
  const fixtures = (manifest.fixtures ?? []).filter((fixture) => {
    if (!fixture.truth || !fixture.pdf) return false
    if (fixture.expectedRejectionCodes) return false
    if (!fixture.thresholds) return false
    if (String(fixture.tier ?? '').startsWith('real-')) return false
    if (String(fixture.tier ?? '').startsWith('legacy')) return false
    return true
  })
  return { fixtures, roots }
}

async function main() {
  const only = (process.env.ONLY_FIXTURE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const { fixtures, roots } = loadFixtures()
  const selected = only.length
    ? fixtures.filter((fixture) => only.includes(fixture.id))
    : fixtures

  const allRows = []
  const allPitchCalibrationSamples = []
  const fixtureSummaries = []

  for (const fixture of selected) {
    const pdfPath = resolveFixturePath(fixture.pdf, roots)
    const truthPath = resolveFixturePath(fixture.truth, roots)
    console.error(`Inventory ${fixture.id}...`)
    if (!pdfPath || !truthPath) {
      fixtureSummaries.push({ id: fixture.id, ok: false, error: 'missing files' })
      continue
    }
    try {
      const generatedPath = join(OUT, 'generated', `${fixture.id}.musicxml`)
      let musicXml = null
      let pipelineMeasures = new Map()
      if (process.env.REUSE_GENERATED === '1' && existsSync(generatedPath)) {
        musicXml = readFileSync(generatedPath, 'utf8')
      } else {
        const capturedPages = []
        const geometryByNote = new WeakMap()
        const rendered = await renderPdfToPages(pdfPath, {
          rootDir: ROOT,
          maxPages: fixture.maxPages ?? 4,
        })
        const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
        const omr = await runPdfOmrPipeline(pdfPath, {
          renderPage: makeRenderPageCallback(rendered.pages),
          extractPageText,
          numPages: rendered.numPages,
          maxPages: fixture.maxPages ?? 4,
          preprocessPages: true,
          instrumentId: fixture.instrumentId ?? 'piano',
          title: fixture.id,
          includeScoreGraph: true,
          analyzePage: async (imageData, context) => {
            const pageResult = processOmrPageAnalysis(imageData, context)
            capturePagePitchGeometry(imageData, context, pageResult, geometryByNote)
            capturedPages.push(pageResult)
            return pageResult
          },
        })
        if (!omr?.musicXml) {
          fixtureSummaries.push({ id: fixture.id, ok: false, error: 'no MusicXML' })
          continue
        }
        musicXml = omr.musicXml
        pipelineMeasures = indexPipelineMeasures(
          capturedPages,
          omr.diagnostics?.scoreGraphFull,
          geometryByNote,
        )
        writeFileSync(generatedPath, musicXml)
        writeFileSync(
          join(OUT, 'generated', `${fixture.id}.pipeline.json`),
          JSON.stringify(
            {
              scoreGraph: omr.diagnostics?.scoreGraphFull ?? null,
              measures: [...pipelineMeasures.entries()].map(([measureNumber, context]) => ({
                measureNumber,
                page: context.page,
                system: context.system,
                noteCount: context.notes.length,
                noteMatching: context.noteMatching,
                chordDiagnostics: context.chordDiagnostics,
                rhythmDiagnostics: context.rhythmDiagnostics,
                reconstruction: context.reconstruction,
                accidentalDiagnostics: context.accidentalDiagnostics,
              })),
            },
            null,
            2,
          ),
        )
      }
      if (!musicXml) {
        fixtureSummaries.push({ id: fixture.id, ok: false, error: 'no MusicXML' })
        continue
      }
      const truthXml = await readScoreXml(truthPath)
      const report = evaluateSemanticMusicXml({
        groundTruthMusicXml: truthXml,
        generatedMusicXml: musicXml,
        groundTruthFileName: basename(truthPath),
        generatedFileName: `${fixture.id}.omr.musicxml`,
        options: { mode: 'written' },
        meta: { gitCommit: gitCommit() },
      })
      writeFileSync(
        join(OUT, 'generated', `${fixture.id}.semantic.json`),
        JSON.stringify(report, null, 2),
      )

      const fixturePitchCalibrationSamples = []
      const structured = collectStructuredMismatches(
        fixture.id,
        truthXml,
        musicXml,
        { mode: 'written' },
        fixturePitchCalibrationSamples,
      ).map((row) => enrichRow(row, pipelineMeasures))
      allPitchCalibrationSamples.push(
        ...fixturePitchCalibrationSamples.map((row) => enrichRow(row, pipelineMeasures)),
      )

      // Also keep compact evaluator defects for interpretation / articulation etc.
      for (const measure of report.measures ?? []) {
        for (const defect of measure.defects ?? []) {
          const already = structured.some(
            (row) =>
              row.code === defect.code &&
              row.measure === (defect.measureNumber ?? measure.measureNumber),
          )
          if (already) continue
          if (
            [
              'incorrect-pitch',
              'onset-mismatch',
              'duration-mismatch',
              'missing-note',
              'extra-note',
              'missing-rest',
              'extra-rest',
              'incorrect-chord',
              'missing-tie',
              'incorrect-tie',
              'voice-mismatch',
              'staff-mismatch',
            ].includes(defect.code)
          ) {
            continue
          }
          structured.push(
            enrichRow(
              {
                fixture: fixture.id,
                code: defect.code,
                class: defect.class,
                measure: defect.measureNumber ?? measure.measureNumber,
                message: defect.message,
                expected: null,
                generated: null,
                source: 'evaluator-compact',
              },
              pipelineMeasures,
            ),
          )
        }
      }

      allRows.push(...structured)
      const byCode = {}
      for (const row of structured) {
        byCode[row.code] = (byCode[row.code] ?? 0) + 1
      }
      fixtureSummaries.push({
        id: fixture.id,
        ok: true,
        overall: report.overall?.score ?? report.overall ?? null,
        classes: report.classes ?? null,
        mismatchCount: structured.length,
        byCode,
        noteCounts: {
          truth: report.totals?.truthNoteCount ?? null,
          generated: report.totals?.generatedNoteCount ?? null,
        },
      })
      console.error(`  mismatches=${structured.length}`)
    } catch (error) {
      fixtureSummaries.push({
        id: fixture.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
      console.error(`  FAIL`, error)
    }
  }

  const byCode = {}
  const byCluster = {}
  const byFixture = {}
  for (const row of allRows) {
    byCode[row.code] = (byCode[row.code] ?? 0) + 1
    byCluster[row.clusterHint] = (byCluster[row.clusterHint] ?? 0) + 1
    byFixture[row.fixture] = (byFixture[row.fixture] ?? 0) + 1
  }

  const payload = {
    kind: 'omr-semantic-mismatch-inventory',
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    gitCommit: gitCommit(),
    createdAt: new Date().toISOString(),
    fixtureCount: selected.length,
    mismatchCount: allRows.length,
    byCode,
    byCluster,
    byFixture,
    fixtures: fixtureSummaries,
    mismatches: allRows,
  }

  const provenanceCoverage = {
    withPage: allRows.filter((row) => row.page != null).length,
    withCandidateIds: allRows.filter((row) => row.noteCandidateIds?.length).length,
    withGlyphIds: allRows.filter((row) => row.glyphIds?.length).length,
    withStemOwnership: allRows.filter((row) => row.stemOwnership).length,
    withBeamOwnership: allRows.filter((row) => row.beamOwnership).length,
    withAccidentalProvenance: allRows.filter((row) => row.accidentalProvenance).length,
    withFirstDivergence: allRows.filter(
      (row) => row.firstPipelineStageWhereDivergenceAppears?.stage,
    ).length,
  }
  payload.provenanceCoverage = provenanceCoverage

  writeFileSync(join(OUT, 'error_inventory.json'), JSON.stringify(payload, null, 2))
  writeFileSync(join(OUT, 'mismatches.json'), JSON.stringify(payload, null, 2))
  writeFileSync(join(OUT, 'mismatches.csv'), toCsv(allRows))

  const md = [
    '# Phase 1 — Semantic Mismatch Inventory',
    '',
    `- Commit: \`${gitCommit()}\``,
    `- Evaluator: frozen ${SEMANTIC_EVALUATOR_VERSION} / schema ${SEMANTIC_EVAL_SCHEMA_VERSION}`,
    `- Fixtures: ${fixtureSummaries.filter((f) => f.ok).length}/${selected.length}`,
    `- Total structured mismatches: **${allRows.length}**`,
    '',
    '## Counts by defect code',
    '',
    '| Code | Count |',
    '|---|---|',
    ...Object.entries(byCode)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => `| ${code} | ${count} |`),
    '',
    '## Counts by inferred cluster hint',
    '',
    '| Cluster hint | Count |',
    '|---|---|',
    ...Object.entries(byCluster)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => `| ${code} | ${count} |`),
    '',
    '## Per-fixture',
    '',
    '| Fixture | Mismatches | Notes T/G | Top codes |',
    '|---|---|---|---|',
    ...fixtureSummaries.map((fixture) => {
      if (!fixture.ok) return `| ${fixture.id} | FAIL | — | ${fixture.error} |`
      const top = Object.entries(fixture.byCode ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([code, count]) => `${code}:${count}`)
        .join(', ')
      return `| ${fixture.id} | ${fixture.mismatchCount} | ${fixture.noteCounts?.truth}/${fixture.noteCounts?.generated} | ${top} |`
    }),
    '',
    '## Pipeline provenance coverage',
    '',
    ...Object.entries(provenanceCoverage).map(
      ([field, count]) => `- ${field}: ${count}/${allRows.length}`,
    ),
    '',
    'Candidate-backed rows are joined to detected noteheads, staff/pitch mapping, stem/beam ownership, chord events, rhythm packing, and MusicXML.',
    'Missing symbols and interpretation-only defects retain measure-level provenance because no generated note candidate exists.',
    '',
    'Machine-readable: `error_inventory.json`, `mismatches.csv`.',
    '',
  ].join('\n')
  writeFileSync(join(OUT, 'PHASE_1_MISMATCH_INVENTORY.md'), md)

  const pitchRows = allRows.filter((row) => row.code === 'incorrect-pitch')
  const pitchCategoryCounts = {}
  const pitchFixtureCounts = {}
  for (const row of pitchRows) {
    pitchFixtureCounts[row.fixture] = (pitchFixtureCounts[row.fixture] ?? 0) + 1
    for (const category of row.pitchErrorCategories ?? ['unresolved']) {
      pitchCategoryCounts[category] = (pitchCategoryCounts[category] ?? 0) + 1
    }
  }
  const pitchPayload = {
    kind: 'omr-font-aware-pitch-error-inventory',
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    gitCommit: gitCommit(),
    createdAt: payload.createdAt,
    fixtureCount: selected.length,
    incorrectPitchCount: pitchRows.length,
    categoryCounts: pitchCategoryCounts,
    fixtureCounts: pitchFixtureCounts,
    mismatches: pitchRows,
  }
  writeFileSync(join(OUT, 'pitch_error_inventory.json'), JSON.stringify(pitchPayload, null, 2))
  writeFileSync(
    join(OUT, 'pitch_anchor_samples.json'),
    JSON.stringify(
      {
        kind: 'omr-font-aware-pitch-anchor-calibration-samples',
        evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
        schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
        gitCommit: gitCommit(),
        sampleCount: allPitchCalibrationSamples.length,
        samples: allPitchCalibrationSamples,
      },
      null,
      2,
    ),
  )
  const pitchMd = [
    '# Phase 1 — Font-aware pitch error inventory',
    '',
    `- Commit: \`${gitCommit()}\``,
    `- Evaluator: frozen ${SEMANTIC_EVALUATOR_VERSION} / schema ${SEMANTIC_EVAL_SCHEMA_VERSION}`,
    `- Fixtures: ${fixtureSummaries.filter((fixture) => fixture.ok).length}/${selected.length}`,
    `- Incorrect-pitch mismatches: **${pitchRows.length}**`,
    '',
    '## Mechanism counts',
    '',
    '| Mechanism | Mismatches |',
    '|---|---:|',
    ...Object.entries(pitchCategoryCounts)
      .sort((left, right) => right[1] - left[1])
      .map(([category, count]) => `| ${category} | ${count} |`),
    '',
    'Categories can overlap when the same note is both outside the staff and vertically mis-anchored.',
    '',
    '## Complete record map',
    '',
    '| # | Fixture | Page/System | Staff/Voice | Measure | Expected → generated | Δ semitones / steps / octaves | Clef | Source | Font/glyph | Box | Anchor raw → selected → expected | Staff position generated → expected | Ledger support | Accidental provenance | Confidence | First divergence | Categories |',
    '|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...pitchRows.map((row, index) => {
      const box = row.noteheadBoundingBox
      const center = row.computedNoteheadCenter
      const ledger = row.nearestLedgerLineCandidates ?? []
      const supportedLedger = ledger.filter((candidate) => candidate.supported).length
      const glyph = row.fontOrGlyphIdentity
      const divergence = row.firstPipelineStageWhereDivergenceAppears
      return [
        `| ${index + 1}`,
        row.fixture,
        `${row.page ?? '—'}/${row.system ?? '—'}`,
        `${row.staff ?? '—'}/${row.voice ?? '—'}`,
        row.measure ?? '—',
        `${row.expectedPitch ?? '—'} → ${row.generatedPitch ?? '—'}`,
        `${row.semitoneDifference ?? '—'} / ${row.diatonicStaffStepDifference ?? '—'} / ${row.octaveDifference ?? '—'}`,
        row.activeClef ?? '—',
        row.noteheadPathOrGlyphSource ?? '—',
        glyph ? `${glyph.fontName ?? '—'} ${glyph.glyphIdentity ?? '—'} ${glyph.glyphKind ?? '—'}` : '—',
        box ? `${box.x},${box.y} ${box.width}×${box.height}` : '—',
        center ? `${center.rawPdfTextBaselineYNorm ?? '—'} → ${center.selectedYNorm ?? '—'} → factor ${center.idealAnchorAdjustmentInGlyphHeights ?? '—'}` : '—',
        `${row.generatedStaffPosition ?? '—'} → ${row.expectedStaffPosition ?? '—'}`,
        `${supportedLedger}/${ledger.length}`,
        row.accidentalProvenance?.source ?? row.accidentalProvenance?.type ?? '—',
        row.confidenceScores?.pitch ?? row.generatedConfidence ?? '—',
        divergence ? `${divergence.stage} (${divergence.confidence})` : '—',
        (row.pitchErrorCategories ?? []).join(', '),
      ].join(' | ') + ' |'
    }),
    '',
    'The machine-readable companion `pitch_error_inventory.json` contains the complete staff-line coordinate arrays, ledger candidates, vector projection, note candidate/glyph IDs, ownership, accidental provenance, and confidence objects for every row.',
    '',
  ].join('\n')
  writeFileSync(join(OUT, 'PHASE_1_PITCH_ERROR_INVENTORY.md'), pitchMd)
  console.error(`Wrote ${allRows.length} mismatches to ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
