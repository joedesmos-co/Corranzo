/**
 * Next-gen automatic score alignment — Phase 1: layout reconciliation.
 *
 * Pure, side-effect-free reconciliation between the PDF-derived layout
 * (per-system barline counts from `detectBarlinesInSystem` / `detectStaffSystems`)
 * and the MusicXML/MIDI timing model (`parseMusicXml` → timingMap). It produces a
 * structured result with a numeric confidence score per system and reconciliation
 * flags (repeats/voltas, pickup, tempo / time-signature changes, missing/extra
 * barlines, system / page mismatch).
 *
 * This module is additive and does NOT change cursor math, detection, or any
 * runtime behaviour — it only describes how well a detected layout agrees with
 * the score so the policy + report layers can decide what to do.
 *
 * Real timingMap fields used (see parseMusicXml.js):
 *   measures[]          — { number, lengthQuarters, beats, beatType, systemBreakBefore, pageBreakBefore, engravedWidth }
 *   durationSeconds     — performed (repeat-expanded) duration
 *   writtenDurationSeconds — written (single-pass) duration
 *   tempoChanges[]      — { quarterTime, bpm }
 *   timeSignatures[]    — { quarterTime, beats, beatType }
 */
import {
  systemStartsFromMusicXml,
  pageCountFromMusicXml,
  detectLayoutMismatch,
} from './layoutAssessment.js'
import { reconcileCountsToTotal } from './allocateMeasuresToSystems.js'

/** A system whose confidence falls below this is surfaced as "weak". */
export const WEAK_SYSTEM_THRESHOLD = 0.5

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return 0
  }
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function sumFinite(values) {
  return (values ?? []).reduce((acc, v) => {
    const n = Number(v)
    return acc + (Number.isFinite(n) ? n : 0)
  }, 0)
}

/**
 * Pickup (anacrusis) detection.
 *
 * Prefers MusicXML's explicit `implicit="yes"` marker when the parser surfaces
 * it; otherwise falls back to the structural heuristic "first measure is shorter
 * than a full bar for its own time signature".
 *
 * NOTE: the current `parseMusicXml` neither surfaces `implicit` nor preserves a
 * short first-measure length (it pads measure 1 to the time signature), so this
 * returns false on today's parser output. Surfacing `implicit` is a tracked
 * Phase 2 parser task; this helper is already correct for that data and for
 * MIDI-derived measures that are not padded.
 */
export function detectPickupMeasure(measures) {
  const first = measures?.[0]
  if (!first) {
    return false
  }
  if (first.implicit === true || first.implicit === 'yes') {
    return true
  }
  const beats = Number(first.beats)
  const beatType = Number(first.beatType)
  const lengthQuarters = Number(first.lengthQuarters)
  if (![beats, beatType, lengthQuarters].every(Number.isFinite) || beatType <= 0) {
    return false
  }
  const fullBarQuarters = beats * (4 / beatType)
  return lengthQuarters > 0 && lengthQuarters < fullBarQuarters - 1e-6
}

/**
 * Confidence in a single system's measure mapping, in [0,1].
 * 1.0 when detected barlines exactly match expected measures, decaying with the
 * mismatch. Optional `inkStrength` (0..1) blends in detection signal quality.
 */
export function systemConfidence({ detectedBarlines, expectedMeasures, inkStrength = null }) {
  const expected = Math.max(1, Number(expectedMeasures) || 0)
  const detected = Number(detectedBarlines)

  let countScore
  if (!Number.isFinite(detected) || detected <= 0) {
    // No barline evidence — we can only trust the allocation, so cap at medium.
    countScore = 0.4
  } else {
    const delta = Math.abs(detected - expected)
    countScore = clamp01(1 - delta / Math.max(2, expected))
  }

  if (inkStrength == null) {
    return clamp01(countScore)
  }
  return clamp01(0.7 * countScore + 0.3 * clamp01(inkStrength))
}

/** Summarise the score-side model (counts + structural flags). */
function summarizeScoreModel(timingMap) {
  const measures = timingMap?.measures ?? []
  const expectedMeasureCount = measures.length

  const durationSeconds = Number(timingMap?.durationSeconds)
  const writtenDurationSeconds = Number(timingMap?.writtenDurationSeconds)
  const hasRepeats =
    Number.isFinite(durationSeconds) &&
    Number.isFinite(writtenDurationSeconds) &&
    writtenDurationSeconds > 0 &&
    durationSeconds > writtenDurationSeconds + 1e-6
  const repeatExpansionRatio =
    Number.isFinite(durationSeconds) &&
    Number.isFinite(writtenDurationSeconds) &&
    writtenDurationSeconds > 0
      ? durationSeconds / writtenDurationSeconds
      : 1

  return {
    expectedMeasureCount,
    firstMeasureNumber: measures[0]?.number ?? 1,
    hasRepeats,
    repeatExpansionRatio,
    hasPickup: detectPickupMeasure(measures),
    tempoChangeCount: Math.max(0, (timingMap?.tempoChanges?.length ?? 0) - 1),
    timeSignatureChangeCount: Math.max(0, (timingMap?.timeSignatures?.length ?? 0) - 1),
    musicXmlSystemStarts: systemStartsFromMusicXml(timingMap),
    musicXmlPageCount: pageCountFromMusicXml(timingMap),
  }
}

/** Cumulative starting measure numbers from per-system measure counts. */
function startsFromCounts(perSystemCounts, firstMeasureNumber) {
  const starts = []
  let measureNumber = firstMeasureNumber
  for (const count of perSystemCounts) {
    starts.push(measureNumber)
    measureNumber += count
  }
  return starts
}

/**
 * Reconcile a detected PDF layout with the score timing model.
 *
 * @param {object}   params
 * @param {object}   params.timingMap              parsed MusicXML timing map
 * @param {number[]} [params.perSystemBarlineCounts] detected barlines per system (reading order)
 * @param {Array}    [params.systemEntries]        optional detected systems: [{ page, inkWidth, inkStrength }]
 * @param {number}   [params.pdfPageCount]         number of PDF pages, if known
 * @returns {object} reconciliation result: { score, perSystem[], totals, flags }
 */
export function reconcilePdfLayoutWithScore({
  timingMap,
  perSystemBarlineCounts = [],
  systemEntries = null,
  pdfPageCount = null,
} = {}) {
  const score = summarizeScoreModel(timingMap)
  const counts = (perSystemBarlineCounts ?? []).map((c) => Number(c))
  const systemCount = counts.length || systemEntries?.length || 0

  // Expected measures per system: trust detected barline counts when they sum to
  // the score's measure total; otherwise reconcile proportionally (or fall back
  // to detected ink widths when no barline counts are available).
  let expectedPerSystem = []
  if (systemCount > 0 && score.expectedMeasureCount > 0) {
    const weights = counts.length
      ? counts
      : (systemEntries ?? []).map((entry) => entry?.inkWidth ?? 1)
    expectedPerSystem = reconcileCountsToTotal(weights, score.expectedMeasureCount)
  }

  const perSystem = []
  for (let i = 0; i < systemCount; i += 1) {
    const detectedBarlines = counts[i]
    const hasDetected = Number.isFinite(detectedBarlines)
    const expectedMeasures = expectedPerSystem[i] ?? 0
    const inkStrength = systemEntries?.[i]?.inkStrength ?? null
    const confidence = systemConfidence({ detectedBarlines, expectedMeasures, inkStrength })
    const delta = hasDetected ? detectedBarlines - expectedMeasures : null
    perSystem.push({
      systemIndex: i,
      page: systemEntries?.[i]?.page ?? null,
      detectedBarlines: hasDetected ? detectedBarlines : null,
      expectedMeasures,
      delta,
      barlineMismatch: delta != null && delta !== 0,
      confidence,
      weak: confidence < WEAK_SYSTEM_THRESHOLD,
    })
  }

  const detectedBarlineTotal = sumFinite(counts)
  const musicXmlHasLayoutHints = score.musicXmlSystemStarts.length > 1
  const pdfStarts = startsFromCounts(expectedPerSystem, score.firstMeasureNumber)

  const mismatch = detectLayoutMismatch({
    pdfStarts,
    musicXmlStarts: musicXmlHasLayoutHints ? score.musicXmlSystemStarts : [],
    pdfPageCount,
    musicXmlPageCount: score.musicXmlPageCount,
  })

  const confidences = perSystem.map((s) => s.confidence)
  const totals = {
    expectedMeasureCount: score.expectedMeasureCount,
    detectedBarlineTotal,
    systemCount,
    meanConfidence: confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0,
    minConfidence: confidences.length ? Math.min(...confidences) : 0,
  }

  const flags = {
    hasRepeats: score.hasRepeats,
    repeatExpansionRatio: score.repeatExpansionRatio,
    hasPickup: score.hasPickup,
    tempoChangeCount: score.tempoChangeCount,
    timeSignatureChangeCount: score.timeSignatureChangeCount,
    systemCountMismatch:
      musicXmlHasLayoutHints &&
      systemCount > 0 &&
      score.musicXmlSystemStarts.length !== systemCount,
    pageCountMismatch:
      Number.isFinite(pdfPageCount) &&
      Number.isFinite(score.musicXmlPageCount) &&
      pdfPageCount >= 1 &&
      score.musicXmlPageCount >= 1 &&
      pdfPageCount !== score.musicXmlPageCount,
    layoutMismatch: mismatch.mismatch,
    layoutMismatchReasons: mismatch.reasons,
    // Detected barlines should sum to the written measure count; a non-zero,
    // non-matching total is a hard signal something was mis-detected.
    barlineTotalMismatch:
      detectedBarlineTotal > 0 && detectedBarlineTotal !== score.expectedMeasureCount,
    weakSystems: perSystem.filter((s) => s.weak).map((s) => s.systemIndex),
  }

  return { score, perSystem, totals, flags }
}
