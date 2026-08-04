#!/usr/bin/env node
/**
 * Phase 1 — register-binned chord inventory for extreme-register campaign.
 * Diagnostic only; writes under tmp/omr-high-extreme/. Does not edit production.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import { textGlyphsToImage } from '../../src/features/omr/processVectorOmrPage.js'
import { normalizeLegacyMusicFontGlyphs } from '../../src/features/omr/normalizeLegacyMusicFontGlyphs.js'
import { normalizeNoncanonicalArticulationGlyphs } from '../../src/features/omr/normalizeNoncanonicalArticulationGlyphs.js'
import {
  evaluateSemanticMusicXml,
  normalizeSemanticNotes,
} from '../../src/features/omr/semanticMusicXmlEvaluator.js'
import {
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVALUATOR_VERSION,
  resolveSemanticEvalOptions,
} from '../../src/features/omr/semanticEvalTolerances.js'
import {
  buildMeasureFingerprint,
  alignMeasureSequences,
} from '../../src/features/omr/semanticMeasureAlignment.js'
import { matchSemanticEvents } from '../../src/features/omr/semanticEventMatching.js'
import { parseMusicXml } from '../../src/features/musicxml/parseMusicXml.js'
import { estimateLedgerLineCount } from '../../src/features/omr/pitchFromStaffPosition.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = resolve(
  process.env.OMR_HIGH_EXTREME_OUT ?? join(ROOT, 'tmp/omr-high-extreme'),
)
const NOTEHEAD_GLYPHS = new Set(['\ue0a2', '\ue0a3', '\ue0a4'])
const REGISTER_BINS = ['low-extreme', 'low-normal', 'middle', 'high-normal', 'high-extreme']

mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'generated'), { recursive: true })
mkdirSync(join(OUT, 'diagnostics'), { recursive: true })

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()
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

function midiToLabel(midi) {
  if (!Number.isFinite(midi)) return null
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const rounded = Math.round(midi)
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`
}

function rounded(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Register bin from written MIDI + optional staff/ledger geometry.
 * - low-extreme: needs ledger(s) below bass (midi < F2=41) or ledger-below count ≥ 1 on bass
 * - low-normal: bass staff ± immediate vicinity (F2–B3)
 * - middle: between-staff / ordinary mid range (C4–D#4)
 * - high-normal: treble staff ± immediate vicinity (E4–G5)
 * - high-extreme: needs ledger(s) above treble (midi ≥ A5=81) or ledger-above count ≥ 1 on treble
 */
function registerBinForTone(midi, { staff = null, ledger = null, clef = null } = {}) {
  if (ledger?.direction === 'below' && (ledger.count ?? 0) >= 1 && (clef === 'bass' || staff === 2)) {
    return 'low-extreme'
  }
  if (ledger?.direction === 'above' && (ledger.count ?? 0) >= 1 && (clef === 'treble' || staff === 1)) {
    return 'high-extreme'
  }
  if (!Number.isFinite(midi)) return 'middle'
  if (midi < 41) return 'low-extreme'
  if (midi <= 59) return 'low-normal'
  if (midi < 64) return 'middle'
  if (midi <= 79) return 'high-normal'
  return 'high-extreme'
}

const BIN_EXTREMITY = {
  'low-extreme': 4,
  'high-extreme': 4,
  'low-normal': 2,
  'high-normal': 2,
  middle: 1,
}

function chordRegisterBin(toneBins) {
  if (!toneBins.length) return 'middle'
  let best = toneBins[0]
  for (const bin of toneBins) {
    if ((BIN_EXTREMITY[bin] ?? 0) > (BIN_EXTREMITY[best] ?? 0)) best = bin
    else if (
      (BIN_EXTREMITY[bin] ?? 0) === (BIN_EXTREMITY[best] ?? 0) &&
      bin.includes('extreme') &&
      !best.includes('extreme')
    ) {
      best = bin
    }
  }
  // Prefer low-extreme over high-extreme when tied at max extremity and both present
  if (toneBins.includes('low-extreme')) return 'low-extreme'
  if (toneBins.includes('high-extreme')) return 'high-extreme'
  if (toneBins.includes('low-normal') && !toneBins.includes('high-normal')) return 'low-normal'
  if (toneBins.includes('high-normal') && !toneBins.includes('low-normal')) return 'high-normal'
  if (toneBins.includes('low-normal') && toneBins.includes('high-normal')) return 'middle'
  return best
}

function emptyBinMetrics() {
  return {
    chordEvents: 0,
    exactMatches: 0,
    exactChordAccuracy: 0,
    incorrectChordCount: 0,
    missingTones: 0,
    extraTones: 0,
    incorrectPitches: 0,
    octaveErrors: 0,
    staffAssignmentErrors: 0,
    duplicatePhysicalNoteheadOwnership: 0,
    droppedPhysicalNoteheadCandidates: 0,
  }
}

function pixelIsInk(data, width, x, y) {
  if (x < 0 || y < 0) return false
  const index = (y * width + x) * 4
  if (index < 0 || index + 2 >= data.length) return false
  return data[index] < 140 || data[index + 1] < 140 || data[index + 2] < 140
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
    for (
      let x = Math.max(0, Math.round(note.cx - halfWidth));
      x <= Math.min(imageData.width - 1, Math.round(note.cx + halfWidth));
      x += 1
    ) {
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
  for (const measure of pageResult.measureRhythms ?? []) {
    for (const event of measure.events ?? []) {
      if (event.type !== 'note') continue
      for (const note of event.notes ?? []) {
        const glyph = nearestNoteheadGlyph(note, noteheadGlyphs)
        const lineYs = note?.pitchMapping?.lineYs ?? []
        const gapNorm =
          lineYs.length >= 2 ? (Math.max(...lineYs) - Math.min(...lineYs)) / 4 : null
        const sortedLines = [...lineYs].sort((a, b) => a - b)
        const selectedAnchorYNorm = note.yNorm ?? (Number.isFinite(note.cy) ? note.cy / imageData.height : null)
        const generatedStaffPosition =
          sortedLines.length && gapNorm > 0 && Number.isFinite(selectedAnchorYNorm)
            ? Math.round(((sortedLines[sortedLines.length - 1] - selectedAnchorYNorm) / gapNorm) * 2)
            : null
        const ledgerEstimate =
          Number.isFinite(selectedAnchorYNorm) && lineYs.length
            ? estimateLedgerLineCount(selectedAnchorYNorm, lineYs)
            : { direction: null, count: 0 }
        geometryByNote.set(note, {
          source: glyph ? 'pdf-text-glyph' : note.source ?? 'raster-or-path',
          glyphIdentity: glyph ? `U+${glyph.text.codePointAt(0).toString(16).toUpperCase()}` : null,
          glyphText: glyph?.text ?? null,
          boundingBox: glyph
            ? {
                x: rounded(glyph.x - glyph.width / 2, 3),
                y: rounded(glyph.y - glyph.height, 3),
                width: rounded(glyph.width, 3),
                height: rounded(glyph.height, 3),
              }
            : null,
          selectedAnchorYNorm: rounded(selectedAnchorYNorm, 6),
          staffLineCoordinates: sortedLines.map((value) => rounded(value, 6)),
          localStaffSpacing: rounded(gapNorm, 6),
          generatedStaffPosition,
          ledgerEstimate,
          nearestLedgerLineCandidates: ledgerCandidatesForNote(imageData, note, lineYs),
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
    const distance = Math.abs((head.cx ?? 0) - note.cx) + Math.abs((head.cy ?? 0) - note.cy)
    if (distance < bestDistance && distance <= 14) {
      best = head
      bestDistance = distance
    }
  }
  return best
}

function indexPipelineMeasures(capturedPages, scoreGraph, geometryByNote = new WeakMap()) {
  const byMeasure = new Map()
  for (const pageResult of capturedPages) {
    for (const measure of pageResult.measureRhythms ?? []) {
      const notes = []
      const ownership = new Map()
      for (let eventIndex = 0; eventIndex < (measure.events ?? []).length; eventIndex += 1) {
        const event = measure.events[eventIndex]
        if (event.type !== 'note') continue
        for (let noteIndex = 0; noteIndex < (event.notes ?? []).length; noteIndex += 1) {
          const note = event.notes[noteIndex]
          const beamHead = nearestBeamHead(measure.beamStemGraph, note)
          const candidateId =
            note.candidateId ??
            note.symbolId ??
            beamHead?.id ??
            `p${measure.page ?? pageResult.pageEntry?.page ?? 'x'}-m${measure.measureNumber}-c${eventIndex}-${noteIndex}`
          const glyphId =
            Number.isFinite(note.cx) && Number.isFinite(note.cy)
              ? `vector-glyph:p${measure.page ?? pageResult.pageEntry?.page ?? 'x'}:m${measure.measureNumber}:x${Math.round(note.cx)}:y${Math.round(note.cy)}`
              : null
          const eventKey = `${event.startDivision ?? 0}@${note.clef ?? 'treble'}@${eventIndex}`
          if (!ownership.has(candidateId)) ownership.set(candidateId, [])
          ownership.get(candidateId).push(eventKey)
          const geometry = geometryByNote.get(note) ?? null
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
            voice: note.voice ?? (note.clef === 'bass' ? 2 : 1),
            pitchGeometry: geometry,
            chordColumnId: event.chordColumnId ?? event.columnId ?? `col:${eventIndex}`,
            stemOwnership: note.stemDirection ?? beamHead?.stemDirection ?? null,
            beamOwnership: beamHead?.beamOwnership ?? beamHead?.beamId ?? null,
          })
        }
      }
      const duplicateOwnership = [...ownership.entries()].filter(([, keys]) => keys.length > 1)
      byMeasure.set(measure.measureNumber, {
        measure,
        page: measure.page ?? pageResult.pageEntry?.page ?? null,
        system: measure.systemIndex ?? null,
        notes,
        noteMatching: measure.vectorNoteMatching ?? null,
        chordDiagnostics: measure.vectorChordDiagnostics ?? null,
        rhythmDiagnostics: measure.vectorRhythmDiagnostics ?? null,
        reconstruction: measure.musicalEventReconstructionDiagnostics ?? null,
        accidentalDiagnostics: measure.vectorAccidentalDiagnostics ?? null,
        keySignature: pageResult.keySignature ?? null,
        duplicateOwnershipCount: duplicateOwnership.length,
        duplicateOwnership: duplicateOwnership.slice(0, 20).map(([id, keys]) => ({ id, events: keys })),
        droppedCandidates:
          measure.vectorNoteMatching?.droppedCandidates ??
          measure.vectorNoteMatching?.rejectedNoteheads ??
          null,
      })
    }
  }
  return byMeasure
}

function chordBucketKey(note, tolerance) {
  const onset = Math.round(note.onsetQuarters / Math.max(tolerance, 0.01))
  return `${note.staff ?? 1}|${note.rawVoice ?? note.voice}|${onset}`
}

function parseBucketKey(key) {
  const [staff, voice, onsetBucket] = String(key).split('|')
  return {
    staff: Number(staff) || 1,
    voice: voice ?? null,
    onsetBucket: Number(onsetBucket),
  }
}

function setDiff(expected, generated) {
  const exp = [...expected]
  const gen = [...generated]
  const missing = []
  const matchedGen = new Set()
  for (const midi of exp) {
    const index = gen.findIndex((value, i) => value === midi && !matchedGen.has(i))
    if (index < 0) missing.push(midi)
    else matchedGen.add(index)
  }
  const extra = gen.filter((_, index) => !matchedGen.has(index))
  return { missing, extra }
}

function octaveErrors(expected, generated) {
  const remaining = [...generated]
  let count = 0
  for (const midi of expected) {
    const exact = remaining.findIndex((value) => value === midi)
    if (exact >= 0) {
      remaining.splice(exact, 1)
      continue
    }
    const octave = remaining.findIndex(
      (value) => Number.isFinite(value) && Math.abs(value - midi) % 12 === 0 && value !== midi,
    )
    if (octave >= 0) {
      count += 1
      remaining.splice(octave, 1)
    }
  }
  return count
}

function classifyFirstStage(record, measureContext) {
  const { missingChordTones, extraChordTones, exactPitchSetMatch, expectedMidis, generatedMidis } =
    record
  if (exactPitchSetMatch) {
    return { stage: 'none', reason: 'exact-chord-match', confidence: 1 }
  }
  if (record.alignmentSymptom) {
    return { stage: 'evaluator_alignment', reason: 'unmatched-measure-alignment', confidence: 0.7 }
  }
  const diag = measureContext?.chordDiagnostics
  if (diag?.fragmentedSameClef) {
    return {
      stage: 'chord_column_grouping',
      reason: 'fragmented-same-clef-onset',
      confidence: 0.8,
    }
  }
  if ((diag?.sequentialSameXCount ?? 0) > 0 && missingChordTones.length) {
    return {
      stage: 'chord_column_grouping',
      reason: 'sequential-same-x-steal',
      confidence: 0.75,
    }
  }
  if (missingChordTones.length > extraChordTones.length && generatedMidis.length < expectedMidis.length) {
    const dropped = measureContext?.droppedCandidates
    if (dropped && (Array.isArray(dropped) ? dropped.length : true)) {
      return {
        stage: 'notehead_detection',
        reason: 'missing-tones-with-dropped-candidates',
        confidence: 0.7,
      }
    }
    return {
      stage: 'notehead_detection_or_pitch_filter',
      reason: 'missing-chord-tones',
      confidence: 0.65,
    }
  }
  if (extraChordTones.length > missingChordTones.length) {
    return {
      stage: 'chord_column_grouping',
      reason: 'extra-chord-tones-or-voice-merge',
      confidence: 0.65,
    }
  }
  const hasOctave = octaveErrors(expectedMidis, generatedMidis) > 0
  if (hasOctave) {
    return { stage: 'pitch_mapping', reason: 'octave-displacement', confidence: 0.8 }
  }
  const ledgerish = (record.tones ?? []).some(
    (tone) => (tone.ledgerLinesAssigned?.length ?? 0) > 0 || (tone.ledgerEstimate?.count ?? 0) > 0,
  )
  if (ledgerish) {
    return {
      stage: 'ledger_line_ownership_or_pitch_anchor',
      reason: 'extreme-register-pitch-mismatch',
      confidence: 0.75,
    }
  }
  return { stage: 'pitch_mapping', reason: 'incorrect-chord-pitch-set', confidence: 0.55 }
}

function collectChordInventory(fixtureId, truthXml, generatedXml, pipelineMeasures, options) {
  const resolved = resolveSemanticEvalOptions(options)
  const tolerance = resolved.chordOnsetToleranceQuarters ?? 0.08
  const truthTiming = parseMusicXml(truthXml, `${fixtureId}.truth.musicxml`)
  const generatedTiming = parseMusicXml(generatedXml, `${fixtureId}.omr.musicxml`)
  const truthNotes = normalizeSemanticNotes(truthTiming, resolved).filter((note) => !note.isRest)
  const generatedNotes = normalizeSemanticNotes(generatedTiming, resolved).filter(
    (note) => !note.isRest,
  )
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

  const records = []

  for (const link of alignment.pairs ?? []) {
    const truthNums = (link.truthMeasureNumbers ?? []).filter((n) => n != null)
    const generatedNums = (link.generatedMeasureNumbers ?? []).filter((n) => n != null)
    const truthMeasure = truthNums[0] ?? null
    const generatedMeasure = generatedNums[0] ?? null
    const measureContext =
      pipelineMeasures.get(truthMeasure) ?? pipelineMeasures.get(generatedMeasure) ?? null

    if (link.kind !== 'match') {
      continue
    }
    if (truthMeasure == null || generatedMeasure == null) continue
    const truthIndex = link.truthIndexes?.[0]
    const generatedIndex = link.generatedIndexes?.[0]
    const truth = truthByIndex.get(truthIndex) ?? []
    const generated = generatedByIndex.get(generatedIndex) ?? []
    const matched = matchSemanticEvents(truth, generated, resolved)

    const buckets = new Map()
    const ensure = (key) => {
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          truthNotes: [],
          generatedNotes: [],
          matches: [],
        })
      }
      return buckets.get(key)
    }

    for (const pair of matched.matches) {
      if (pair.truth.isRest) continue
      const bucket = ensure(chordBucketKey(pair.truth, tolerance))
      bucket.truthNotes.push(pair.truth)
      bucket.generatedNotes.push(pair.generated)
      bucket.matches.push(pair)
    }
    for (const note of matched.missing) {
      if (note.isRest) continue
      ensure(chordBucketKey(note, tolerance)).truthNotes.push(note)
    }
    for (const note of matched.extra) {
      if (note.isRest) continue
      ensure(chordBucketKey(note, tolerance)).generatedNotes.push(note)
    }

    for (const bucket of buckets.values()) {
      const expectedMidis = bucket.truthNotes.map((note) => note.midi).filter(Number.isFinite).sort((a, b) => a - b)
      const generatedMidis = bucket.generatedNotes
        .map((note) => note.midi)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
      if (expectedMidis.length < 2 && generatedMidis.length < 2) continue

      const parsed = parseBucketKey(bucket.key)
      const { missing, extra } = setDiff(expectedMidis, generatedMidis)
      const exactPitchSetMatch =
        expectedMidis.length === generatedMidis.length &&
        expectedMidis.every((midi, index) => midi === generatedMidis[index])

      const staffErrors = bucket.matches.filter(
        (pair) =>
          pair.truth?.staff != null &&
          pair.generated?.staff != null &&
          pair.truth.staff !== pair.generated.staff,
      ).length

      // Attach geometry for generated notes in this onset/staff/voice neighborhood
      const genContexts = (measureContext?.notes ?? []).filter((context) => {
        const staffOk = context.staff === parsed.staff
        const onsetOk =
          Math.abs(context.onsetQuarters - (bucket.truthNotes[0]?.onsetQuarters ?? context.onsetQuarters)) <=
          tolerance * 2
        return staffOk && onsetOk
      })

      const toneBins = []
      const tones = []
      for (const note of bucket.truthNotes) {
        const context =
          genContexts.find((entry) => entry.note?.midi === note.midi) ??
          genContexts.find(
            (entry) =>
              Number.isFinite(entry.note?.midi) && Math.abs(entry.note.midi - note.midi) % 12 === 0,
          ) ??
          null
        const geometry = context?.pitchGeometry ?? null
        const ledger =
          geometry?.ledgerEstimate ??
          (geometry?.nearestLedgerLineCandidates?.length
            ? {
                direction: geometry.nearestLedgerLineCandidates[0].direction,
                count: geometry.nearestLedgerLineCandidates.length,
              }
            : null)
        const clef = note.staff === 2 ? 'bass' : 'treble'
        const bin = registerBinForTone(note.midi, {
          staff: note.staff,
          clef,
          ledger,
        })
        toneBins.push(bin)
        tones.push({
          role: 'expected',
          midi: note.midi,
          label: note.label ?? midiToLabel(note.midi),
          registerBin: bin,
          staff: note.staff ?? null,
          voice: note.rawVoice ?? note.voice ?? null,
          noteheadCandidateId: context?.candidateId ?? null,
          physicalGlyphPathId: context?.glyphId ?? null,
          noteheadCenter: context?.note
            ? { cx: rounded(context.note.cx, 3), cy: rounded(context.note.cy, 3), yNorm: rounded(context.note.yNorm, 6) }
            : null,
          ledgerLineCandidates: geometry?.nearestLedgerLineCandidates ?? [],
          ledgerLinesAssigned: (geometry?.nearestLedgerLineCandidates ?? []).filter((c) => c.supported),
          ledgerEstimate: ledger,
          stemOwnership: context?.stemOwnership ?? note.stemDirection ?? null,
          beamOwnership: context?.beamOwnership ?? null,
          chordColumnId: context?.chordColumnId ?? null,
          accidentals: {
            alter: note.alter ?? null,
            accidental: note.accidental ?? null,
            provenance: context?.note?.accidentalProvenance ?? context?.note?.accidentalSource ?? null,
          },
          pitchAnchorProvenance: geometry?.anchorDiagnostics ?? context?.note?.noteheadAnchor ?? null,
        })
      }

      for (const note of bucket.generatedNotes) {
        const context =
          genContexts.find((entry) => entry.note?.midi === note.midi) ??
          (measureContext?.notes ?? []).find((entry) => entry.note?.midi === note.midi) ??
          null
        const geometry = context?.pitchGeometry ?? null
        const ledger = geometry?.ledgerEstimate ?? null
        const clef = note.staff === 2 || context?.note?.clef === 'bass' ? 'bass' : 'treble'
        const bin = registerBinForTone(note.midi, { staff: note.staff, clef, ledger })
        tones.push({
          role: 'generated',
          midi: note.midi,
          label: note.label ?? midiToLabel(note.midi),
          registerBin: bin,
          staff: note.staff ?? context?.staff ?? null,
          voice: note.rawVoice ?? note.voice ?? context?.voice ?? null,
          noteheadCandidateId: context?.candidateId ?? null,
          physicalGlyphPathId: context?.glyphId ?? null,
          noteheadCenter: context?.note
            ? { cx: rounded(context.note.cx, 3), cy: rounded(context.note.cy, 3), yNorm: rounded(context.note.yNorm, 6) }
            : null,
          ledgerLineCandidates: geometry?.nearestLedgerLineCandidates ?? [],
          ledgerLinesAssigned: (geometry?.nearestLedgerLineCandidates ?? []).filter((c) => c.supported),
          ledgerEstimate: ledger,
          stemOwnership: context?.stemOwnership ?? note.stemDirection ?? null,
          beamOwnership: context?.beamOwnership ?? null,
          chordColumnId: context?.chordColumnId ?? null,
          accidentals: {
            alter: note.alter ?? null,
            accidental: note.accidental ?? null,
            provenance: context?.note?.accidentalProvenance ?? context?.note?.accidentalSource ?? null,
          },
          pitchAnchorProvenance: geometry?.anchorDiagnostics ?? context?.note?.noteheadAnchor ?? null,
        })
      }

      const registerBin = chordRegisterBin(toneBins)
      const primaryTruth = bucket.truthNotes[0] ?? null
      const primaryGen = bucket.generatedNotes[0] ?? null
      const record = {
        fixture: fixtureId,
        page: measureContext?.page ?? null,
        system: measureContext?.system ?? null,
        staff: parsed.staff,
        measure: truthMeasure,
        voice: parsed.voice,
        clef: parsed.staff === 2 ? 'bass' : 'treble',
        keySignature: measureContext?.keySignature ?? null,
        onset: primaryTruth?.onsetQuarters ?? primaryGen?.onsetQuarters ?? null,
        expectedPitches: expectedMidis.map(midiToLabel),
        generatedPitches: generatedMidis.map(midiToLabel),
        expectedMidis,
        generatedMidis,
        expectedChordSize: expectedMidis.length,
        generatedChordSize: generatedMidis.length,
        exactPitchSetMatch,
        missingChordTones: missing.map(midiToLabel),
        extraChordTones: extra.map(midiToLabel),
        missingChordToneMidis: missing,
        extraChordToneMidis: extra,
        octaveErrorCount: octaveErrors(expectedMidis, generatedMidis),
        staffAssignmentErrors: staffErrors,
        noteheadCandidateIds: [...new Set(tones.map((t) => t.noteheadCandidateId).filter(Boolean))],
        physicalGlyphPathIds: [...new Set(tones.map((t) => t.physicalGlyphPathId).filter(Boolean))],
        noteheadCenters: tones.map((t) => t.noteheadCenter).filter(Boolean),
        ledgerLineCandidates: tones.flatMap((t) => t.ledgerLineCandidates ?? []),
        ledgerLinesAssigned: tones.flatMap((t) => t.ledgerLinesAssigned ?? []),
        stemOwnership: [...new Set(tones.map((t) => t.stemOwnership).filter(Boolean))],
        beamOwnership: [...new Set(tones.map((t) => t.beamOwnership).filter((v) => v != null))],
        chordColumnIds: [...new Set(tones.map((t) => t.chordColumnId).filter(Boolean))],
        accidentals: tones.map((t) => t.accidentals),
        pitchAnchorProvenance: tones.map((t) => t.pitchAnchorProvenance).filter(Boolean),
        registerBin,
        toneRegisterBins: toneBins,
        tones,
        duplicatePhysicalNoteheadOwnership: measureContext?.duplicateOwnershipCount ?? 0,
        droppedPhysicalNoteheadCandidates: Array.isArray(measureContext?.droppedCandidates)
          ? measureContext.droppedCandidates.length
          : measureContext?.noteMatching?.dedupedDuringGrouping ?? 0,
        fragmentedSameClef: measureContext?.chordDiagnostics?.fragmentedSameClef ?? null,
        sequentialSameXCount: measureContext?.chordDiagnostics?.sequentialSameXCount ?? null,
        alignmentSymptom: false,
      }
      record.firstPipelineStageWhereIncorrect = classifyFirstStage(record, measureContext)
      records.push(record)
    }
  }

  return records
}

function summarizeByRegister(records) {
  const byBin = Object.fromEntries(REGISTER_BINS.map((bin) => [bin, emptyBinMetrics()]))
  const overall = emptyBinMetrics()

  for (const record of records) {
    const bins = [overall, byBin[record.registerBin] ?? byBin.middle]
    for (const metrics of bins) {
      metrics.chordEvents += 1
      if (record.exactPitchSetMatch) metrics.exactMatches += 1
      else metrics.incorrectChordCount += 1
      metrics.missingTones += record.missingChordToneMidis?.length ?? 0
      metrics.extraTones += record.extraChordToneMidis?.length ?? 0
      if (!record.exactPitchSetMatch) {
        metrics.incorrectPitches +=
          (record.missingChordToneMidis?.length ?? 0) + (record.extraChordToneMidis?.length ?? 0)
      }
      metrics.octaveErrors += record.octaveErrorCount ?? 0
      metrics.staffAssignmentErrors += record.staffAssignmentErrors ?? 0
      metrics.duplicatePhysicalNoteheadOwnership += record.duplicatePhysicalNoteheadOwnership ? 1 : 0
      metrics.droppedPhysicalNoteheadCandidates += record.droppedPhysicalNoteheadCandidates ? 1 : 0
    }
  }

  for (const metrics of [overall, ...Object.values(byBin)]) {
    metrics.exactChordAccuracy = metrics.chordEvents
      ? rounded((100 * metrics.exactMatches) / metrics.chordEvents, 2)
      : 0
  }

  const byFixture = {}
  for (const record of records) {
    if (!byFixture[record.fixture]) {
      byFixture[record.fixture] = {
        total: 0,
        incorrect: 0,
        byBin: Object.fromEntries(REGISTER_BINS.map((bin) => [bin, { total: 0, incorrect: 0 }])),
      }
    }
    byFixture[record.fixture].total += 1
    if (!record.exactPitchSetMatch) byFixture[record.fixture].incorrect += 1
    const binStats = byFixture[record.fixture].byBin[record.registerBin]
    binStats.total += 1
    if (!record.exactPitchSetMatch) binStats.incorrect += 1
  }

  const stageCounts = {}
  for (const record of records) {
    if (record.exactPitchSetMatch) continue
    const stage = record.firstPipelineStageWhereIncorrect?.stage ?? 'unknown'
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1
  }

  return { overall, byBin, byFixture, stageCounts }
}

function loadFixtures() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'))
  const roots = (manifest.fixtureSearchPaths ?? ['benchmarks/omr-fixtures']).map((path) =>
    path.startsWith('~/') || path.startsWith('/') ? expandHome(path) : join(ROOT, path),
  )
  if (!roots.includes(join(ROOT, 'benchmarks/omr-fixtures'))) {
    roots.unshift(join(ROOT, 'benchmarks/omr-fixtures'))
  }
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

function renderMarkdown(payload) {
  const { summary, corpusBaseline, gitCommit: commit, createdAt, results } = payload
  const lines = []
  lines.push('# Phase 1 — Register-binned chord baseline')
  lines.push('')
  lines.push(`- Commit: \`${commit}\``)
  lines.push(`- Evaluator: frozen ${SEMANTIC_EVALUATOR_VERSION} / schema ${SEMANTIC_EVAL_SCHEMA_VERSION}`)
  lines.push(`- Created: ${createdAt}`)
  lines.push(`- Fixtures: ${results.filter((r) => r.ok).length}/9`)
  lines.push('')
  lines.push('## Frozen corpus scoreboard')
  lines.push('')
  if (corpusBaseline?.scoreboard) {
    const s = corpusBaseline.scoreboard
    lines.push(`| Metric | Value |`)
    lines.push(`|---|---:|`)
    lines.push(`| Overall | ${s.overall?.percent ?? s.overall ?? '—'}% |`)
    lines.push(`| Pitch | ${s.pitch?.percent ?? s.pitch ?? '—'}% |`)
    lines.push(`| Rhythm | ${s.rhythm?.percent ?? s.rhythm ?? '—'}% |`)
    lines.push(`| Measure structure | ${s.measureStructure?.percent ?? s.measureStructure ?? '—'}% |`)
    lines.push(`| Sustain | ${s.sustain?.percent ?? s.sustain ?? '—'}% |`)
  } else {
    lines.push('See `corpus-baseline.txt` (overall 67.12%, pitch 66.86%, rhythm 74.64%, measure 72.85%, sustain 55.56%).')
  }
  lines.push('')
  lines.push('Defect totals from corpus run: incorrect-chord ×182, incorrect-pitch ×161, onset-mismatch ×170, duration-mismatch ×102, missing-note ×136, extra-note ×112.')
  lines.push('')
  lines.push('## Register-bin definitions')
  lines.push('')
  lines.push('| Bin | Rule |')
  lines.push('|---|---|')
  lines.push('| low-extreme | Tone needs ledger(s) below bass (MIDI < F2 / ledger-below on bass) |')
  lines.push('| low-normal | Bass staff ± immediate vicinity (F2–B3) |')
  lines.push('| middle | Between-staff / mid range (C4–D♯4) |')
  lines.push('| high-normal | Treble staff ± immediate vicinity (E4–G5) |')
  lines.push('| high-extreme | Tone needs ledger(s) above treble (MIDI ≥ A5 / ledger-above on treble) |')
  lines.push('')
  lines.push('Chord bin = most extreme member tone (low-extreme beats high-extreme when both present).')
  lines.push('')
  lines.push('## Register-binned chord metrics')
  lines.push('')
  lines.push('| Bin | Chords | Exact % | Incorrect | Missing tones | Extra tones | Incorrect pitches | Octave errors | Staff errors | Dup ownership rows | Dropped-candidate rows |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const bin of ['overall', ...REGISTER_BINS]) {
    const m = bin === 'overall' ? summary.overall : summary.byBin[bin]
    lines.push(
      `| ${bin} | ${m.chordEvents} | ${m.exactChordAccuracy}% | ${m.incorrectChordCount} | ${m.missingTones} | ${m.extraTones} | ${m.incorrectPitches} | ${m.octaveErrors} | ${m.staffAssignmentErrors} | ${m.duplicatePhysicalNoteheadOwnership} | ${m.droppedPhysicalNoteheadCandidates} |`,
    )
  }
  lines.push('')
  lines.push('## First incorrect pipeline stage (incorrect chords only)')
  lines.push('')
  lines.push('| Stage | Count |')
  lines.push('|---|---:|')
  for (const [stage, count] of Object.entries(summary.stageCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${stage} | ${count} |`)
  }
  lines.push('')
  lines.push('## Per-fixture chord load')
  lines.push('')
  lines.push('| Fixture | Chord events | Incorrect | low-ext | high-ext | low-norm | high-norm | middle |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const [fixture, stats] of Object.entries(summary.byFixture)) {
    const b = stats.byBin
    lines.push(
      `| ${fixture} | ${stats.total} | ${stats.incorrect} | ${b['low-extreme'].incorrect}/${b['low-extreme'].total} | ${b['high-extreme'].incorrect}/${b['high-extreme'].total} | ${b['low-normal'].incorrect}/${b['low-normal'].total} | ${b['high-normal'].incorrect}/${b['high-normal'].total} | ${b.middle.incorrect}/${b.middle.total} |`,
    )
  }
  lines.push('')
  lines.push('## Extreme-register incorrect samples (first 40)')
  lines.push('')
  const extremes = payload.chords
    .filter((c) => !c.exactPitchSetMatch && (c.registerBin === 'low-extreme' || c.registerBin === 'high-extreme'))
    .slice(0, 40)
  lines.push('| # | Fixture | M | Staff/Voice | Bin | Expected → generated | Missing | Extra | Stage |')
  lines.push('|---:|---|---:|---|---|---|---|---|---|')
  extremes.forEach((c, index) => {
    lines.push(
      `| ${index + 1} | ${c.fixture} | ${c.measure} | ${c.staff}/${c.voice} | ${c.registerBin} | ${c.expectedPitches.join(' ')} → ${c.generatedPitches.join(' ')} | ${c.missingChordTones.join(' ') || '—'} | ${c.extraChordTones.join(' ') || '—'} | ${c.firstPipelineStageWhereIncorrect?.stage ?? '—'} |`,
    )
  })
  lines.push('')
  lines.push('## Artifacts')
  lines.push('')
  lines.push('- `high_extreme_inventory_full.json` — full chord event records')
  lines.push('- `corpus-baseline.json` / `corpus-baseline.txt` — frozen semantic corpus')
  lines.push('- `generated/*.musicxml` — OMR outputs used for inventory')
  lines.push('- `diagnostics/*.pipeline.json` — measure-level pipeline joins')
  lines.push('')
  lines.push('Production code was not modified in Phase 1.')
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const only = (process.env.ONLY_FIXTURE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const { fixtures, roots } = loadFixtures()
  const selected = only.length ? fixtures.filter((fixture) => only.includes(fixture.id)) : fixtures

  let corpusBaseline = null
  const corpusPath = join(OUT, 'corpus-baseline.json')
  if (existsSync(corpusPath)) {
    corpusBaseline = JSON.parse(readFileSync(corpusPath, 'utf8'))
  }

  const allChords = []
  const results = []

  for (const fixture of selected) {
    const pdfPath = resolveFixturePath(fixture.pdf, roots)
    const truthPath = resolveFixturePath(fixture.truth, roots)
    process.stderr.write(`Extreme-chord inventory ${fixture.id}...\n`)
    if (!pdfPath || !truthPath) {
      results.push({ id: fixture.id, ok: false, error: 'missing files' })
      continue
    }
    try {
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
        results.push({ id: fixture.id, ok: false, error: 'no MusicXML' })
        continue
      }
      writeFileSync(join(OUT, 'generated', `${fixture.id}.musicxml`), omr.musicXml)
      const pipelineMeasures = indexPipelineMeasures(
        capturedPages,
        omr.diagnostics?.scoreGraphFull,
        geometryByNote,
      )
      writeFileSync(
        join(OUT, 'diagnostics', `${fixture.id}.pipeline.json`),
        JSON.stringify(
          {
            measures: [...pipelineMeasures.entries()].map(([measureNumber, context]) => ({
              measureNumber,
              page: context.page,
              system: context.system,
              noteCount: context.notes.length,
              duplicateOwnershipCount: context.duplicateOwnershipCount,
              chordDiagnostics: context.chordDiagnostics,
              noteMatching: context.noteMatching,
              accidentalDiagnostics: context.accidentalDiagnostics,
            })),
          },
          null,
          2,
        ),
      )

      const truthXml = await readScoreXml(truthPath)
      const report = evaluateSemanticMusicXml({
        groundTruthMusicXml: truthXml,
        generatedMusicXml: omr.musicXml,
        groundTruthFileName: basename(truthPath),
        generatedFileName: `${fixture.id}.omr.musicxml`,
        options: { mode: 'written' },
        meta: { gitCommit: gitCommit() },
      })
      const chords = collectChordInventory(fixture.id, truthXml, omr.musicXml, pipelineMeasures, {
        mode: 'written',
      })
      allChords.push(...chords)
      results.push({
        id: fixture.id,
        ok: true,
        overall: report.overall?.percent ?? null,
        chordEvents: chords.length,
        incorrectChords: chords.filter((c) => !c.exactPitchSetMatch).length,
        extremeIncorrect: chords.filter(
          (c) =>
            !c.exactPitchSetMatch &&
            (c.registerBin === 'low-extreme' || c.registerBin === 'high-extreme'),
        ).length,
      })
    } catch (error) {
      results.push({ id: fixture.id, ok: false, error: String(error?.stack ?? error) })
    }
  }

  const summary = summarizeByRegister(allChords)
  const createdAt = new Date().toISOString()
  const payload = {
    kind: 'extreme-register-chord-inventory',
    gitCommit: gitCommit(),
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    createdAt,
    registerBinDefinitions: {
      'low-extreme': 'ledger(s) below bass / MIDI < F2',
      'low-normal': 'bass staff ± immediate (F2–B3)',
      middle: 'between-staff mid range (C4–D#4)',
      'high-normal': 'treble staff ± immediate (E4–G5)',
      'high-extreme': 'ledger(s) above treble / MIDI ≥ A5',
    },
    corpusBaseline: corpusBaseline
      ? {
          scoreboard: corpusBaseline.scoreboard ?? corpusBaseline.summary ?? null,
          label: corpusBaseline.label ?? null,
        }
      : null,
    summary,
    results,
    chords: allChords,
  }

  writeFileSync(join(OUT, 'high_extreme_inventory_full.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(OUT, 'PHASE_1_HIGH_EXTREME_BASELINE_FULL.md'), renderMarkdown(payload))

  const highChords = allChords.filter((chord) => chord.registerBin === 'high-extreme')
  const fallbackCounts = new Map()
  const fallbackIncorrect = new Map()
  let inkSuccess = 0
  let metricFallback = 0
  for (const chord of highChords) {
    const provenances = Array.isArray(chord.pitchAnchorProvenance)
      ? chord.pitchAnchorProvenance
      : chord.pitchAnchorProvenance
        ? [chord.pitchAnchorProvenance]
        : []
    for (const provenance of provenances) {
      const source = provenance?.source ?? 'unknown'
      const reason = provenance?.rejectedReason ?? provenance?.fallbackReason ?? null
      const key = reason ? `${source}/${reason}` : source
      fallbackCounts.set(key, (fallbackCounts.get(key) ?? 0) + 1)
      if (source === 'ink-notehead-geometry') inkSuccess += 1
      if (source === 'glyph-metrics-fallback') metricFallback += 1
      if (!chord.exactPitchSetMatch) {
        fallbackIncorrect.set(key, (fallbackIncorrect.get(key) ?? 0) + 1)
      }
    }
  }
  const stageCounts = new Map()
  for (const chord of highChords) {
    const stage = chord.firstPipelineStageWhereIncorrect?.stage ?? (chord.exactPitchSetMatch ? 'none' : 'unknown')
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1)
  }
  const diatonicStepErrors = highChords.reduce((sum, chord) => {
    const remaining = [...(chord.generatedMidis ?? [])]
    let errors = 0
    for (const midi of chord.expectedMidis ?? []) {
      const exact = remaining.findIndex((value) => value === midi)
      if (exact >= 0) {
        remaining.splice(exact, 1)
        continue
      }
      const near = remaining.findIndex(
        (value) => Number.isFinite(value) && Math.abs(value - midi) > 0 && Math.abs(value - midi) <= 2,
      )
      if (near >= 0) {
        errors += 1
        remaining.splice(near, 1)
      }
    }
    return sum + errors
  }, 0)

  const highPayload = {
    kind: 'high-extreme-chord-inventory',
    gitCommit: gitCommit(),
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    createdAt,
    definition:
      'Treble ledger(s) above staff and/or MIDI ≥ A5; chord bin = most extreme member (low-extreme wins ties).',
    summary: summary.byBin['high-extreme'],
    globalRegisterSummary: summary,
    fallbackMethodCounts: Object.fromEntries(
      [...fallbackCounts.entries()].sort((left, right) => right[1] - left[1]),
    ),
    fallbackMethodIncorrectChordTouches: Object.fromEntries(
      [...fallbackIncorrect.entries()].sort((left, right) => right[1] - left[1]),
    ),
    firstFailingStageCounts: Object.fromEntries(
      [...stageCounts.entries()].sort((left, right) => right[1] - left[1]),
    ),
    diatonicStaffStepNearMisses: diatonicStepErrors,
    inkAnchorSuccesses: inkSuccess,
    glyphMetricsFallbacks: metricFallback,
    chords: highChords,
  }
  writeFileSync(join(OUT, 'high_extreme_inventory.json'), `${JSON.stringify(highPayload, null, 2)}\n`)

  const highMd = []
  highMd.push('# Phase 1 — High-extreme chord baseline')
  highMd.push('')
  highMd.push(`- Commit: \`${gitCommit()}\``)
  highMd.push(`- Created: ${createdAt}`)
  highMd.push('- Evaluator: frozen 2.0.0 / schema 2')
  highMd.push('- Production code: **not modified**')
  highMd.push('')
  highMd.push('## Definition')
  highMd.push('')
  highMd.push(
    'High-extreme = treble tones requiring ledger(s) above the staff and/or MIDI ≥ A5. Chord bin uses the most extreme member tone (low-extreme still wins when both extremes are present).',
  )
  highMd.push('')
  highMd.push('## Scoreboard (high-extreme chords only)')
  highMd.push('')
  const high = summary.byBin['high-extreme']
  highMd.push('| Metric | Value |')
  highMd.push('|---|---:|')
  highMd.push(`| Chord events | ${high.chordEvents} |`)
  highMd.push(`| Exact pitch-set matches | ${high.exactMatches} |`)
  highMd.push(`| Exact chord accuracy | **${high.exactChordAccuracy}%** |`)
  highMd.push(`| Incorrect chords | ${high.incorrectChordCount} |`)
  highMd.push(`| Missing tones | ${high.missingTones} |`)
  highMd.push(`| Extra tones | ${high.extraTones} |`)
  highMd.push(`| Incorrect pitches (matched+unmatched defects) | ${high.incorrectPitches} |`)
  highMd.push(`| Octave errors | ${high.octaveErrors} |`)
  highMd.push(`| Wrong-staff errors | ${high.staffAssignmentErrors} |`)
  highMd.push(`| Near diatonic step misses (±1–2 semitone unpaired) | ${diatonicStepErrors} |`)
  highMd.push(`| Duplicate physical notehead ownership | ${high.duplicatePhysicalNoteheadOwnership} |`)
  highMd.push(`| Dropped physical candidates (inventory) | ${high.droppedPhysicalNoteheadCandidates} |`)
  highMd.push('')
  highMd.push('## Context: all register bins (safety)')
  highMd.push('')
  highMd.push('| Bin | Chords | Exact % | Incorrect | Missing | Extra | Octave | Wrong staff |')
  highMd.push('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const bin of REGISTER_BINS) {
    const row = summary.byBin[bin]
    highMd.push(
      `| ${bin} | ${row.chordEvents} | ${row.exactChordAccuracy}% | ${row.incorrectChordCount} | ${row.missingTones} | ${row.extraTones} | ${row.octaveErrors} | ${row.staffAssignmentErrors} |`,
    )
  }
  highMd.push('')
  highMd.push('## Anchor method / fallback rates (high-extreme tones)')
  highMd.push('')
  highMd.push(`Ink geometry successes: **${inkSuccess}** · Glyph-metrics fallbacks: **${metricFallback}**`)
  highMd.push('')
  highMd.push('| Anchor source / reject reason | Tone touches | On incorrect chords |')
  highMd.push('|---|---:|---:|')
  for (const [key, count] of [...fallbackCounts.entries()].sort((a, b) => b[1] - a[1])) {
    highMd.push(`| \`${key}\` | ${count} | ${fallbackIncorrect.get(key) ?? 0} |`)
  }
  highMd.push('')
  highMd.push('## First pipeline stage where pitch diverges')
  highMd.push('')
  highMd.push('| Stage | High-extreme chords |')
  highMd.push('|---|---:|')
  for (const [stage, count] of [...stageCounts.entries()].sort((a, b) => b[1] - a[1])) {
    highMd.push(`| ${stage} | ${count} |`)
  }
  highMd.push('')
  highMd.push('## Incorrect high-extreme chords')
  highMd.push('')
  highMd.push(
    '| # | Fixture | M | Staff/Voice | Expected → Generated | Missing | Extra | Stage | Anchor sources |',
  )
  highMd.push('|---:|---|---:|---|---|---|---|---|---|')
  highChords
    .filter((chord) => !chord.exactPitchSetMatch)
    .forEach((chord, index) => {
      const anchors = (Array.isArray(chord.pitchAnchorProvenance)
        ? chord.pitchAnchorProvenance
        : []
      )
        .map((entry) => {
          const source = entry?.source ?? '?'
          const reason = entry?.rejectedReason
          return reason ? `${source}/${reason}` : source
        })
        .filter(Boolean)
      const uniqueAnchors = [...new Set(anchors)].join(', ') || '—'
      highMd.push(
        `| ${index + 1} | ${chord.fixture} | ${chord.measure} | ${chord.staff}/${chord.voice} | ${chord.expectedPitches.join(' ')} → ${chord.generatedPitches.join(' ') || '∅'} | ${chord.missingChordTones.join(' ') || '—'} | ${chord.extraChordTones.join(' ') || '—'} | ${chord.firstPipelineStageWhereIncorrect?.stage ?? '—'} | ${uniqueAnchors} |`,
      )
    })
  highMd.push('')
  highMd.push('## Exact matches (control)')
  highMd.push('')
  for (const chord of highChords.filter((entry) => entry.exactPitchSetMatch)) {
    highMd.push(
      `- ${chord.fixture} m${chord.measure} @${chord.onset}: ${chord.expectedPitches.join(' ')}`,
    )
  }
  highMd.push('')
  highMd.push('## Artifacts')
  highMd.push('')
  highMd.push('- `high_extreme_inventory.json` — high-extreme chords only + fallback rates')
  highMd.push('- `high_extreme_inventory_full.json` — full register-binned inventory')
  highMd.push('- `generated/*.musicxml`, `diagnostics/*.pipeline.json`')
  highMd.push('- Next: Phase 2 visual PDF + anchor trace (`PHASE_2_RC_B_ROOT_CAUSE.md`)')
  highMd.push('')
  writeFileSync(join(OUT, 'PHASE_1_HIGH_EXTREME_BASELINE.md'), `${highMd.join('\n')}\n`)
  process.stderr.write(
    `Wrote ${allChords.length} chord records → tmp/omr-high-extreme/high_extreme_inventory_full.json\n`,
  )
  process.stderr.write(
    `Wrote ${highChords.length} high-extreme records → tmp/omr-high-extreme/high_extreme_inventory.json\n`,
  )
  process.stderr.write(
    `Extreme incorrect: low=${summary.byBin['low-extreme'].incorrectChordCount} high=${summary.byBin['high-extreme'].incorrectChordCount}\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
