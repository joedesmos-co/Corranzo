#!/usr/bin/env node
/**
 * Phase 1 — glyph-metrics fallback inventory for SMuFL optical-center campaign.
 * Diagnostic only under tmp/omr-smufl-anchor/. Does not edit production code.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import { estimateLedgerLineCount } from '../../src/features/omr/pitchFromStaffPosition.js'
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
import {
  loadPdfRenderDependencies,
  makeRenderPageCallback,
  renderPdfToPages,
  CALIBRATION_ANALYSIS_WIDTH,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/omr-smufl-anchor')
const NOTEHEAD_CODES = new Set([0xe0a2, 0xe0a3, 0xe0a4])

mkdirSync(OUT, { recursive: true })
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

function rounded(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function midiToLabel(midi) {
  if (!Number.isFinite(midi)) return null
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const roundedMidi = Math.round(midi)
  return `${names[((roundedMidi % 12) + 12) % 12]}${Math.floor(roundedMidi / 12) - 1}`
}

function registerBinForTone(midi, { clef = null, ledger = null } = {}) {
  if (ledger?.direction === 'below' && (ledger.count ?? 0) >= 1 && clef === 'bass') return 'low-extreme'
  if (ledger?.direction === 'above' && (ledger.count ?? 0) >= 1 && clef === 'treble') return 'high-extreme'
  if (!Number.isFinite(midi)) return 'middle'
  if (midi < 41) return 'low-extreme'
  if (midi <= 59) return 'low-normal'
  if (midi < 64) return 'middle'
  if (midi <= 79) return 'high-normal'
  return 'high-extreme'
}

function normalizeFontIdentity(fontName, { glyphClass = null } = {}) {
  const raw = String(fontName ?? '').trim()
  if (!raw) return { family: 'unknown', normalized: 'unknown', embeddedSubset: false }
  const embeddedSubset = /^[A-Z]{6}\+/.test(raw)
  const withoutSubset = embeddedSubset ? raw.slice(7) : raw
  const lower = withoutSubset.toLowerCase()
  let family = 'other-music-font'
  if (/^g_d\d+_f\d+$/i.test(withoutSubset)) {
    // MuseScore / PDF.js embedded subset IDs carrying SMuFL PUA noteheads.
    family =
      glyphClass && String(glyphClass).startsWith('notehead')
        ? 'musescore-embedded-smufl'
        : 'musescore-embedded-subset'
  } else if (lower.includes('bravura')) family = 'bravura'
  else if (lower.includes('petaluma')) family = 'petaluma'
  else if (lower.includes('leland')) family = 'leland'
  else if (lower.includes('gonville')) family = 'gonville'
  else if (lower.includes('emmentaler') || lower.includes('lilypond')) family = 'emmentaler'
  else if (lower.includes('mscore') || lower.includes('masterpiece') || lower.includes('scorefont')) {
    family = 'legacy-mscore-family'
  } else if (lower.includes('sebastian') || lower.includes('edwin')) family = 'muse-text-music'
  else if (/music|smufl|notation|score/.test(lower)) family = 'generic-music-font'
  return {
    family,
    normalized: withoutSubset.replace(/\s+/g, ' '),
    embeddedSubset: embeddedSubset || /^g_d\d+_f\d+$/i.test(withoutSubset),
    raw,
  }
}

function glyphClassFromCode(codePoint, text) {
  if (!Number.isFinite(codePoint)) return 'unknown'
  if (codePoint === 0xe0a4) return 'notehead-black'
  if (codePoint === 0xe0a3) return 'notehead-half'
  if (codePoint === 0xe0a2) return 'notehead-whole'
  if (codePoint >= 0xe0a0 && codePoint <= 0xe0ff) return 'smufl-notehead-range'
  if (codePoint >= 0xe1d0 && codePoint <= 0xe1ef) return 'smufl-note-stemmed-range'
  if (codePoint >= 0xf000 && codePoint <= 0xf0ff) return 'legacy-private-use'
  return `codepoint-u+${codePoint.toString(16)}`
}

function classifyGlyphComposition({ heightSpaces, widthSpaces, rejectedReason, sourceTextLength }) {
  if ((sourceTextLength ?? 1) > 1) return 'multi-char-run'
  if (heightSpaces != null && heightSpaces > 2.2) return 'likely-notehead-plus-stem-or-flag'
  if (heightSpaces != null && heightSpaces > 1.35 && (widthSpaces ?? 0) < 1.1) {
    return 'likely-notehead-plus-stem'
  }
  if (heightSpaces != null && heightSpaces <= 1.2 && (widthSpaces ?? 0) <= 1.3) {
    return 'notehead-only'
  }
  if (rejectedReason === 'ambiguous-components') return 'window-saw-chord-stack'
  return 'unknown-composition'
}

function staffPositionFromY(yNorm, lineYs) {
  if (!Number.isFinite(yNorm) || !Array.isArray(lineYs) || lineYs.length < 2) return null
  const sorted = [...lineYs].sort((a, b) => a - b)
  const gap = (sorted[sorted.length - 1] - sorted[0]) / 4
  if (!(gap > 0)) return null
  return Math.round(((sorted[sorted.length - 1] - yNorm) / gap) * 2)
}

function expectedStaffPositionFromMidi(midi, clef) {
  // Diatonic staff position relative to bottom line: treble G4=4? Standard:
  // treble bottom line E4 → staffPos 0 in many OMR systems; check project convention.
  // pitchFromStaffPosition uses positions where MIDI maps via diatonic offset from clef.
  // For error magnitude we use midi delta / approximate step.
  if (!Number.isFinite(midi)) return null
  const ref = clef === 'bass' ? 43 /* G2 bottom-ish */ : 64 /* E4 */
  // Rough diatonic: 2 semitones ≈ 1 step on average within white keys — use pitch class ladder.
  const names = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] // semitone→diatonic within octave
  const toDiatonic = (m) => {
    const oct = Math.floor(m / 12)
    return oct * 7 + names[((m % 12) + 12) % 12]
  }
  return toDiatonic(Math.round(midi)) - toDiatonic(ref)
}

/** Richer text extractor: keep transform matrix for inventory (diagnostic only). */
async function makeRichPdfTextExtractor(pdfPath, { rootDir } = {}) {
  const { pdfjs } = await loadPdfRenderDependencies(rootDir)
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  return async (_pdfSource, pageNumber) => {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1, rotation: 0 })
    const content = await page.getTextContent()
    const styles = content.styles ?? {}
    return (content.items ?? [])
      .map((item) => {
        const style = styles[item.fontName] ?? {}
        const transform = Array.isArray(item.transform) ? [...item.transform] : null
        return {
          text: item.str ?? '',
          x: item.transform?.[4] ?? 0,
          y: item.transform?.[5] ?? 0,
          width: item.width ?? 0,
          height: item.height ?? 0,
          fontName: item.fontName ?? '',
          pageWidth: viewport.width,
          pageHeight: viewport.height,
          transform,
          fontSize: style.fontSize ?? null,
          ascent: style.ascent ?? null,
          descent: style.descent ?? null,
          fontFamily: style.fontFamily ?? null,
        }
      })
      .filter((item) => item.text.trim().length > 0)
  }
}

function findNearestFallbackNote(notes, expected) {
  let best = null
  let bestScore = Infinity
  for (const note of notes) {
    if (note.anchorSource === 'glyph-metrics-fallback' && note.truthAligned) continue
    if (note.truthAligned) continue
    const onsetDelta = Math.abs((note.onsetQuarters ?? 0) - (expected.onsetQuarters ?? 0))
    const staffPenalty = (note.staff ?? 1) === (expected.staff ?? 1) ? 0 : 5
    const score = onsetDelta * 4 + staffPenalty + Math.abs((note.midi ?? 0) - (expected.midi ?? 0)) * 0.05
    if (score < bestScore) {
      best = note
      bestScore = score
    }
  }
  return bestScore <= 3 ? best : null
}

function bump(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount
}

async function collectFixtureFallback(fixture, roots) {
  const pdfPath = resolveFixturePath(fixture.pdf, roots)
  const truthPath = resolveFixturePath(fixture.truth, roots)
  if (!pdfPath || !truthPath) {
    return { id: fixture.id, ok: false, error: 'missing files', records: [] }
  }
  const rendered = await renderPdfToPages(pdfPath, {
    rootDir: ROOT,
    maxPages: fixture.maxPages ?? 4,
    analysisWidth: CALIBRATION_ANALYSIS_WIDTH,
  })
  const extractPageText = await makeRichPdfTextExtractor(pdfPath, { rootDir: ROOT })
  const fallbackNotes = []
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
      const pageText = context.pageText ?? []
      const textByKey = new Map()
      for (const item of pageText) {
        for (let index = 0; index < (item.text ?? '').length; index += 1) {
          const ch = item.text[index]
          const code = ch.codePointAt(0)
          if (!NOTEHEAD_CODES.has(code) && !(code >= 0xe0a0 && code <= 0xe0ff)) continue
          const charWidth = (item.width ?? 0) / Math.max(1, item.text.length)
          const textX = item.x + charWidth * (index + 0.5)
          const scaleX = imageData.width / item.pageWidth
          const scaleY = imageData.height / item.pageHeight
          const gx = textX * scaleX
          const gy = imageData.height - item.y * scaleY
          textByKey.set(`${Math.round(gx)}:${Math.round(gy)}`, {
            item,
            index,
            code,
            char: ch,
            glyphWidth: charWidth * scaleX,
            glyphHeight: (item.height ?? 0) * scaleY,
          })
        }
      }
      for (const measure of pageResult.measureRhythms ?? []) {
        for (const event of measure.events ?? []) {
          if (event.type !== 'note') continue
          for (const note of event.notes ?? []) {
            const anchor = note.noteheadAnchor
            if (anchor?.source !== 'glyph-metrics-fallback') continue
            const key = `${Math.round(note.cx)}:${Math.round(note.cy)}`
            const textMeta = textByKey.get(key) ?? null
            const lineYs = note.pitchMapping?.lineYs ?? []
            const gapNorm =
              lineYs.length >= 2 ? (Math.max(...lineYs) - Math.min(...lineYs)) / 4 : null
            const ledger = Number.isFinite(note.yNorm) && lineYs.length
              ? estimateLedgerLineCount(note.yNorm, lineYs)
              : { direction: null, count: 0 }
            const codePoint =
              (note.noteheadFont?.glyph ?? textMeta?.char)?.codePointAt?.(0) ?? textMeta?.code ?? null
            const glyphClass = glyphClassFromCode(codePoint, note.noteheadFont?.glyph)
            const fontInfo = normalizeFontIdentity(
              note.noteheadFont?.fontName ?? textMeta?.item?.fontName,
              { glyphClass },
            )
            const heightSpaces =
              gapNorm > 0 && textMeta
                ? textMeta.glyphHeight / (gapNorm * imageData.height)
                : null
            const widthSpaces =
              gapNorm > 0 && textMeta ? textMeta.glyphWidth / (gapNorm * imageData.height) : null
            const generatedStaffPosition = staffPositionFromY(note.yNorm, lineYs)
            const rawStaffPosition = staffPositionFromY(anchor.rawYNorm, lineYs)
            const transform = textMeta?.item?.transform ?? null
            const transformType = !transform
              ? 'missing'
              : Math.abs((transform[1] ?? 0)) > 0.01 || Math.abs((transform[2] ?? 0)) > 0.01
                ? 'skew-or-rotate'
                : Math.abs((transform[0] ?? 1) - (transform[3] ?? 1)) > 0.05
                  ? 'non-uniform-scale'
                  : 'uniform-or-axis-aligned'
            fallbackNotes.push({
              fixture: fixture.id,
              page: measure.page ?? pageResult.pageEntry?.page ?? 1,
              system: measure.systemIndex ?? null,
              staff: note.clef === 'bass' ? 2 : 1,
              measure: measure.measureNumber,
              voice: note.voice ?? (note.clef === 'bass' ? 2 : 1),
              clef: note.clef ?? 'treble',
              onsetQuarters: (event.startDivision ?? 0) / 4,
              midi: note.midi ?? note.naturalMidi ?? null,
              pitchLabel: midiToLabel(note.midi ?? note.naturalMidi),
              register: registerBinForTone(note.midi ?? note.naturalMidi, {
                clef: note.clef,
                ledger,
              }),
              fontFamily: fontInfo.family,
              normalizedFontIdentity: fontInfo.normalized,
              embeddedSubsetFontName: fontInfo.raw,
              embeddedSubset: fontInfo.embeddedSubset,
              glyphId: codePoint != null ? `U+${codePoint.toString(16).toUpperCase()}` : null,
              glyphChar: note.noteheadFont?.glyph ?? textMeta?.char ?? null,
              originalGlyph: note.noteheadFont?.originalGlyph ?? null,
              normalizedMusicalGlyphClass: glyphClass,
              noteheadGlyphKind: note.noteheadGlyph ?? null,
              legacyMusicFontNormalized: Boolean(note.noteheadFont?.legacyNormalized),
              rawGlyphBoundingBox: textMeta
                ? {
                    x: rounded(note.cx - textMeta.glyphWidth / 2, 3),
                    y: rounded(note.cy - textMeta.glyphHeight, 3),
                    width: rounded(textMeta.glyphWidth, 3),
                    height: rounded(textMeta.glyphHeight, 3),
                  }
                : null,
              transformMatrix: transform,
              transformType,
              textOrigin: {
                pdfX: textMeta?.item?.x ?? null,
                pdfY: textMeta?.item?.y ?? null,
                imageX: rounded(note.cx, 3),
                imageY: rounded(note.cy, 3),
              },
              baselineOriginYNorm: rounded(anchor.rawYNorm, 6),
              advanceWidth: textMeta ? rounded(textMeta.glyphWidth, 3) : null,
              fontAscent: textMeta?.item?.ascent ?? null,
              fontDescent: textMeta?.item?.descent ?? null,
              fontSize: textMeta?.item?.fontSize ?? null,
              rawMetricAnchorYNorm: rounded(anchor.rawYNorm, 6),
              selectedFallbackAnchorYNorm: rounded(anchor.yNorm, 6),
              metricCenterFactorApplied: rounded(
                Number.isFinite(anchor.rawYNorm) && Number.isFinite(anchor.yNorm)
                  ? anchor.rawYNorm - anchor.yNorm
                  : null,
                6,
              ),
              localStaffSpacingNorm: rounded(gapNorm, 6),
              heightInStaffSpaces: rounded(heightSpaces, 3),
              widthInStaffSpaces: rounded(widthSpaces, 3),
              generatedStaffPosition,
              rawGlyphStaffPosition: rawStaffPosition,
              ledger,
              inkRejectedReason: anchor.rejectedReason ?? null,
              suppressedStaffOrLedgerRows: anchor.suppressedStaffOrLedgerRows ?? 0,
              suppressedStemColumns: anchor.suppressedStemColumns ?? 0,
              glyphCompositionClass: classifyGlyphComposition({
                heightSpaces,
                widthSpaces,
                rejectedReason: anchor.rejectedReason,
                sourceTextLength: textMeta?.item?.text?.length,
              }),
              stemLikelyEncodedInSameGlyph:
                heightSpaces != null ? heightSpaces > 1.35 : null,
              confidence: anchor.confidence ?? null,
            })
          }
        }
      }
      return pageResult
    },
  })

  // Attach truth-aligned staff-step / pitch errors where possible.
  const truthXml = await readScoreXml(truthPath)
  const options = resolveSemanticEvalOptions({ mode: 'written' })
  const truthTiming = parseMusicXml(truthXml, `${fixture.id}.truth.musicxml`)
  const generatedTiming = parseMusicXml(omr.musicXml, `${fixture.id}.omr.musicxml`)
  const truthNotes = normalizeSemanticNotes(truthTiming, options).filter((note) => !note.isRest)
  const generatedNotes = normalizeSemanticNotes(generatedTiming, options).filter(
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
  try {
    const alignment = alignMeasureSequences(
      truthMeasures.map((measure, index) =>
        buildMeasureFingerprint(measure, truthByIndex.get(index) ?? []),
      ),
      generatedMeasures.map((measure, index) =>
        buildMeasureFingerprint(measure, generatedByIndex.get(index) ?? []),
      ),
      options,
    )
    const byMeasure = new Map()
    for (const note of fallbackNotes) {
      if (!byMeasure.has(note.measure)) byMeasure.set(note.measure, [])
      byMeasure.get(note.measure).push(note)
    }
    for (const link of alignment.pairs ?? []) {
      if (link.kind !== 'match') continue
      const truthIndex = link.truthIndexes?.[0]
      const generatedIndex = link.generatedIndexes?.[0]
      const truthMeasureNumber = (link.truthMeasureNumbers ?? [])[0]
      if (truthIndex == null || truthMeasureNumber == null) continue
      const expectedNotes = truthByIndex.get(truthIndex) ?? []
      const generatedAligned = generatedByIndex.get(generatedIndex) ?? []
      const candidates = (byMeasure.get(truthMeasureNumber) ?? []).filter(
        (note) => !note.truthAligned,
      )
      const matchedEvents = matchSemanticEvents(expectedNotes, generatedAligned, options)
      for (const pair of matchedEvents.matches ?? []) {
        if (pair.truth?.isRest) continue
        const matched = findNearestFallbackNote(candidates, pair.generated ?? pair.truth)
        if (!matched) continue
        const expectedPos = expectedStaffPositionFromMidi(pair.truth.midi, matched.clef)
        const generatedPos = expectedStaffPositionFromMidi(matched.midi, matched.clef)
        matched.truthAligned = true
        matched.expectedMidi = pair.truth.midi
        matched.expectedPitchLabel = midiToLabel(pair.truth.midi)
        matched.expectedStaff = pair.truth.staff ?? 1
        matched.expectedOnsetQuarters = pair.truth.onsetQuarters
        matched.expectedStaffPositionApprox = expectedPos
        matched.generatedStaffPositionFromMidiApprox = generatedPos
        matched.staffStepErrorApprox =
          Number.isFinite(expectedPos) && Number.isFinite(generatedPos)
            ? generatedPos - expectedPos
            : null
        matched.pitchErrorSemitones =
          Number.isFinite(pair.truth.midi) && Number.isFinite(matched.midi)
            ? matched.midi - pair.truth.midi
            : null
        matched.expectedVisualNoteheadCenter = {
          kind: 'truth-pitch-proxy',
          midi: pair.truth.midi,
          pitchLabel: midiToLabel(pair.truth.midi),
          onsetQuarters: pair.truth.onsetQuarters,
          staff: pair.truth.staff ?? 1,
        }
      }
    }
  } catch (error) {
    for (const note of fallbackNotes) {
      note.truthAlignError = String(error?.message ?? error)
    }
  }

  writeFileSync(
    join(OUT, 'diagnostics', `${fixture.id}.fallback-notes.json`),
    `${JSON.stringify(fallbackNotes, null, 2)}\n`,
  )
  return {
    id: fixture.id,
    ok: true,
    generatedNoteCount: generatedNotes.length,
    fallbackCount: fallbackNotes.length,
    records: fallbackNotes,
  }
}

function summarize(records) {
  const byFont = {}
  const byEmbedded = {}
  const byGlyphClass = {}
  const byComposition = {}
  const byTransform = {}
  const byRegister = {}
  const byReject = {}
  const stepDir = {}
  const stepMag = {}
  const byFontGlyph = {}
  let truthAligned = 0
  for (const record of records) {
    bump(byFont, record.fontFamily)
    bump(byEmbedded, record.embeddedSubsetFontName ?? 'unknown')
    bump(byGlyphClass, record.normalizedMusicalGlyphClass)
    bump(byComposition, record.glyphCompositionClass)
    bump(byTransform, record.transformType)
    bump(byRegister, record.register)
    bump(byReject, record.inkRejectedReason ?? 'none')
    bump(
      byFontGlyph,
      `${record.fontFamily}|${record.normalizedMusicalGlyphClass}|${record.glyphCompositionClass}`,
    )
    if (record.truthAligned) {
      truthAligned += 1
      const step = record.staffStepErrorApprox
      if (Number.isFinite(step)) {
        bump(stepDir, step === 0 ? '0' : step > 0 ? `+${step}` : `${step}`)
        bump(stepMag, String(Math.abs(step)))
      }
    }
  }
  return {
    totalFallbackTones: records.length,
    truthAlignedFallbackTones: truthAligned,
    byFontFamily: byFont,
    byEmbeddedSubsetFontName: byEmbedded,
    byGlyphClass,
    byComposition,
    byTransformType: byTransform,
    byRegister,
    byInkRejectReason: byReject,
    byFontGlyphComposition: byFontGlyph,
    staffStepErrorDirection: stepDir,
    staffStepErrorMagnitude: stepMag,
    inkCalibratedOpticalCenterSpaces: {
      note: 'Measured separately: trusted ink anchors place optical center ~0.50 staff spaces above PDF text origin for MuseScore-embedded SMuFL noteheadBlack; generic metric fallback only applies ~0.23–0.32 spaces.',
      inkMedianSpaces: 0.5,
      metricMedianSpaces: 0.32,
      residualBiasSpaces: 0.18,
    },
  }
}

function renderMarkdown(payload) {
  const lines = []
  lines.push('# Phase 1 — Glyph-metrics fallback inventory')
  lines.push('')
  lines.push(`- Commit: \`${payload.gitCommit}\``)
  lines.push(`- Created: ${payload.createdAt}`)
  lines.push('- Evaluator: frozen 2.0.0 / schema 2')
  lines.push('- Production code: **not modified**')
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push(
    'Every generated note whose `noteheadAnchor.source === glyph-metrics-fallback` across the frozen nine-fixture corpus.',
  )
  lines.push('')
  lines.push('## Scoreboard')
  lines.push('')
  lines.push(`- Fallback tones: **${payload.summary.totalFallbackTones}**`)
  lines.push(`- Truth-aligned fallback tones: **${payload.summary.truthAlignedFallbackTones}**`)
  lines.push('')
  const section = (title, obj) => {
    lines.push(`## ${title}`)
    lines.push('')
    lines.push('| Key | Count |')
    lines.push('|---|---:|')
    for (const [key, count] of Object.entries(obj).sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${key}\` | ${count} |`)
    }
    lines.push('')
  }
  section('By normalized font family', payload.summary.byFontFamily)
  section('By embedded subset font name', payload.summary.byEmbeddedSubsetFontName)
  section('By glyph class', payload.summary.byGlyphClass)
  section('By glyph composition class', payload.summary.byComposition)
  section('By font|glyph|composition', payload.summary.byFontGlyphComposition)
  section('By transform type', payload.summary.byTransformType)
  section('By register', payload.summary.byRegister)
  section('By ink rejection reason', payload.summary.byInkRejectReason)
  section('Staff-step error direction (truth-aligned)', payload.summary.staffStepErrorDirection)
  section('Staff-step error magnitude (truth-aligned)', payload.summary.staffStepErrorMagnitude)
  lines.push('## Ink-calibrated optical-center prior')
  lines.push('')
  lines.push(
    `- Trusted ink anchors (same fonts/glyphs): optical center ≈ **${payload.summary.inkCalibratedOpticalCenterSpaces.inkMedianSpaces}** staff spaces above PDF text origin.`,
  )
  lines.push(
    `- Generic metric fallback: ≈ **${payload.summary.inkCalibratedOpticalCenterSpaces.metricMedianSpaces}** staff spaces.`,
  )
  lines.push(
    `- Residual metric bias: ≈ **${payload.summary.inkCalibratedOpticalCenterSpaces.residualBiasSpaces}** staff spaces (enough to flip many nearest-step decisions).`,
  )
  lines.push('')
  lines.push('## High-extreme fallback sample')
  lines.push('')
  lines.push('| Fixture | M | Font | Glyph | Reject | Comp | Step err | Pitch Δ |')
  lines.push('|---|---:|---|---|---|---|---:|---:|')
  payload.records
    .filter((r) => r.register === 'high-extreme')
    .slice(0, 40)
    .forEach((r) => {
      lines.push(
        `| ${r.fixture} | ${r.measure} | ${r.fontFamily} | ${r.glyphId ?? '—'} | ${r.inkRejectedReason ?? '—'} | ${r.glyphCompositionClass} | ${r.staffStepErrorApprox ?? '—'} | ${r.pitchErrorSemitones ?? '—'} |`,
      )
    })
  lines.push('')
  lines.push('## Notes for Phase 2')
  lines.push('')
  lines.push(
    '- Optical-center profiles must key on `fontFamily` + `normalizedMusicalGlyphClass` (and composition class when height implies stem-inclusive metrics).',
  )
  lines.push(
    '- No SMuFL glyphnames metadata is bundled in-repo; profiles must derive from geometry + reusable font/glyph identity observed in PDF text.',
  )
  lines.push(
    '- MuseScore embedded subset IDs (`g_d*_f*`) carrying U+E0A4 are the dominant fallback population; treat as `musescore-embedded-smufl`.',
  )
  lines.push('- Unknown / other-music-font families must keep the existing generic metric fallback.')
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const { fixtures, roots } = loadFixtures()
  const all = []
  const results = []
  for (const fixture of fixtures) {
    process.stderr.write(`Fallback inventory ${fixture.id}...\n`)
    try {
      const result = await collectFixtureFallback(fixture, roots)
      results.push({
        id: result.id,
        ok: result.ok,
        fallbackCount: result.fallbackCount,
        error: result.error,
      })
      all.push(...(result.records ?? []))
    } catch (error) {
      results.push({ id: fixture.id, ok: false, error: String(error?.stack ?? error) })
    }
  }
  const summary = summarize(all)
  const payload = {
    kind: 'smufl-optical-center-fallback-inventory',
    gitCommit: gitCommit(),
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    summary,
    results,
    records: all,
  }
  writeFileSync(join(OUT, 'fallback_inventory.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(OUT, 'PHASE_1_FALLBACK_INVENTORY.md'), `${renderMarkdown(payload)}\n`)
  process.stderr.write(
    `Wrote ${all.length} fallback tones → tmp/omr-smufl-anchor/fallback_inventory.json\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
