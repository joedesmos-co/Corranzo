/**
 * Tie ink-arc probe diagnostics for benchmark reports.
 */

import {
  crossMeasureInkArcSegments,
  detectInkArcBetween,
  probeInkArcWindow,
} from './detectVectorTies.js'

export const TIE_ARC_CLASS = {
  SAME_PITCH_TRUE_TIE: 'same-pitch-true-tie',
  DIFFERENT_PITCH_SLUR: 'different-pitch-slur',
  AMBIGUOUS_ARC: 'ambiguous-arc',
  BARLINE_INTERRUPTED: 'barline-interrupted',
  NO_ARC_EVIDENCE: 'no-arc-evidence',
}

export function probeCrossMeasureTiePair(
  imageData,
  fromNote,
  toNote,
  fromMeasureBox,
  toMeasureBox,
  inkThreshold = 170,
) {
  const unifiedStart = Math.ceil(Math.min(fromNote.cx, toNote.cx) + 8)
  const unifiedEnd = Math.floor(Math.max(fromNote.cx, toNote.cx) - 8)
  const unified =
    unifiedEnd - unifiedStart >= 6
      ? probeInkArcWindow(
          imageData,
          fromNote,
          toNote,
          unifiedStart,
          unifiedEnd,
          fromMeasureBox,
          inkThreshold,
        )
      : { passes: false, side: null }

  const segments = crossMeasureInkArcSegments(
    fromNote,
    toNote,
    fromMeasureBox,
    toMeasureBox,
    imageData,
  )
  const splitLeft =
    segments.seg1End - segments.seg1Start >= 6
      ? probeInkArcWindow(
          imageData,
          fromNote,
          toNote,
          segments.seg1Start,
          segments.seg1End,
          fromMeasureBox,
          inkThreshold,
        )
      : { passes: false, side: null }
  const splitRight =
    segments.seg2End - segments.seg2Start >= 6
      ? probeInkArcWindow(
          imageData,
          fromNote,
          toNote,
          segments.seg2Start,
          segments.seg2End,
          toMeasureBox,
          inkThreshold,
        )
      : { passes: false, side: null }

  const splitPasses =
    splitLeft.passes &&
    splitRight.passes &&
    splitLeft.side &&
    splitLeft.side === splitRight.side
  const detectorPasses = detectInkArcBetween(
    imageData,
    fromNote,
    toNote,
    fromMeasureBox,
    inkThreshold,
  )

  let classification = TIE_ARC_CLASS.NO_ARC_EVIDENCE
  if (fromNote.midi === toNote.midi) {
    if (detectorPasses) {
      classification = TIE_ARC_CLASS.SAME_PITCH_TRUE_TIE
    } else if (!unified.passes && splitPasses) {
      classification = TIE_ARC_CLASS.BARLINE_INTERRUPTED
    } else if (unified.passes || splitPasses) {
      classification = TIE_ARC_CLASS.AMBIGUOUS_ARC
    }
  } else if (unified.passes || splitPasses) {
    classification = TIE_ARC_CLASS.DIFFERENT_PITCH_SLUR
  }

  return {
    fromMeasure: fromNote.measureNumber ?? null,
    toMeasure: toNote.measureNumber ?? null,
    midi: fromNote.midi ?? null,
    pitch: fromNote.label ?? toNote.label ?? null,
    clef: fromNote.clef ?? null,
    fromCx: fromNote.cx ?? null,
    fromCy: fromNote.cy ?? null,
    toCx: toNote.cx ?? null,
    toCy: toNote.cy ?? null,
    crossesBarline: (fromNote.measureNumber ?? 0) !== (toNote.measureNumber ?? 0),
    unified,
    splitLeft,
    splitRight,
    splitPasses,
    detectorPasses,
    classification,
    segments,
  }
}

export function summarizeMissedTiePairs(missedPairs = [], probes = []) {
  const byClass = Object.fromEntries(Object.values(TIE_ARC_CLASS).map((key) => [key, 0]))
  for (const probe of probes) {
    byClass[probe.classification] = (byClass[probe.classification] ?? 0) + 1
  }
  return {
    missedCount: missedPairs.length,
    probes,
    byClass,
    barlineInterruptedCount: byClass[TIE_ARC_CLASS.BARLINE_INTERRUPTED] ?? 0,
  }
}
