/**
 * Honest layout assessment for score-follow auto-setup.
 *
 * Core principle: the VISIBLE PDF is the source of truth for page / system /
 * measure placement. MusicXML supplies timing, measure count, notes, default-x,
 * widths, repeats and tempo — but its embedded `<print>` system/page breaks
 * describe one particular engraving that often differs from the uploaded PDF.
 *
 * These pure helpers (1) detect when the MusicXML-implied layout disagrees with
 * the PDF-derived allocation, so the UI can say so and keep using the PDF
 * layout, and (2) grade overall layout confidence so a weak alignment asks for
 * quick setup instead of silently showing a confident-but-wrong cursor.
 */

export const LAYOUT_CONFIDENCE = {
  EXACT: 'exact',
  GOOD: 'good',
  APPROXIMATE: 'approximate',
  NEEDS_SETUP: 'needs-setup',
}

export const LAYOUT_CONFIDENCE_LABEL = {
  [LAYOUT_CONFIDENCE.EXACT]: 'Exact follow',
  [LAYOUT_CONFIDENCE.GOOD]: 'Good follow',
  [LAYOUT_CONFIDENCE.APPROXIMATE]: 'Approximate follow',
  [LAYOUT_CONFIDENCE.NEEDS_SETUP]: 'Quick setup recommended',
}

export const LAYOUT_MISMATCH_MESSAGE =
  'PDF layout differs from score data — using PDF layout.'

/** Allocation provenance, in decreasing trust. */
export const ALLOCATION_MODE = {
  /** A) reliable PDF barline counts per system. */
  BARLINE_COUNTS: 'barline-counts',
  /** C) PDF system detection + reconciled measure distribution. */
  RECONCILED: 'reconciled',
  /** D) MusicXML system breaks / even distribution (approximate fallback). */
  MUSICXML_FALLBACK: 'breaks-or-even',
}

/** System start measure numbers from allocated spans. */
export function systemStartsFromSpans(spans = []) {
  return spans.map((span) => span.measureStart)
}

/** System start measure numbers implied by MusicXML `<print new-system>` hints. */
export function systemStartsFromMusicXml(timingMap) {
  const measures = timingMap?.measures ?? []
  if (!measures.length) {
    return []
  }
  const starts = [measures[0].number]
  for (let index = 1; index < measures.length; index += 1) {
    if (measures[index].systemBreakBefore) {
      starts.push(measures[index].number)
    }
  }
  return starts
}

/** Page count implied by MusicXML `<print new-page>` hints (>=1). */
export function pageCountFromMusicXml(timingMap) {
  const measures = timingMap?.measures ?? []
  if (!measures.length) {
    return 0
  }
  let pages = 1
  for (let index = 1; index < measures.length; index += 1) {
    if (measures[index].pageBreakBefore) {
      pages += 1
    }
  }
  return pages
}

/**
 * Compare the PDF-derived allocation with the MusicXML-implied layout.
 * Returns a mismatch flag, human reasons, and a short status message. The PDF
 * allocation is always preferred; this only reports the disagreement.
 */
export function detectLayoutMismatch({
  pdfStarts = [],
  musicXmlStarts = [],
  pdfPageCount = null,
  musicXmlPageCount = null,
} = {}) {
  const reasons = []

  if (pdfStarts.length && musicXmlStarts.length) {
    if (pdfStarts.length !== musicXmlStarts.length) {
      reasons.push(
        `systems: PDF ${pdfStarts.length} vs score ${musicXmlStarts.length}`,
      )
    } else {
      let differing = 0
      for (let index = 0; index < pdfStarts.length; index += 1) {
        if (pdfStarts[index] !== musicXmlStarts[index]) {
          differing += 1
        }
      }
      if (differing > 0) {
        reasons.push(`${differing} system start${differing === 1 ? '' : 's'} differ`)
      }
    }
  }

  if (
    Number.isFinite(pdfPageCount) &&
    Number.isFinite(musicXmlPageCount) &&
    pdfPageCount >= 1 &&
    musicXmlPageCount >= 1 &&
    pdfPageCount !== musicXmlPageCount
  ) {
    reasons.push(`pages: PDF ${pdfPageCount} vs score ${musicXmlPageCount}`)
  }

  const mismatch = reasons.length > 0
  return {
    mismatch,
    reasons,
    message: mismatch ? LAYOUT_MISMATCH_MESSAGE : null,
  }
}

/**
 * Grade overall layout confidence from the allocation provenance, detection
 * stage, plausibility and any layout mismatch. Returns a level + reasons + the
 * weakest system index (lowest staff-ink width) where confidence is lowest.
 */
export function assessLayoutConfidence({
  stage = null,
  allocationMode = null,
  plausible = true,
  lowConfidence = false,
  mismatch = false,
  perSystemInk = [],
} = {}) {
  if (!plausible) {
    return {
      level: LAYOUT_CONFIDENCE.NEEDS_SETUP,
      reasons: ['PDF system mapping is not plausible — quick setup recommended.'],
      weakestSystem: weakestSystemIndex(perSystemInk),
    }
  }

  const reasons = []
  let level

  if (allocationMode === ALLOCATION_MODE.MUSICXML_FALLBACK) {
    level = LAYOUT_CONFIDENCE.APPROXIMATE
    reasons.push('PDF systems not fully detected — using score-data layout (approximate).')
  } else if (allocationMode === ALLOCATION_MODE.BARLINE_COUNTS && stage === 'staff-lines') {
    if (lowConfidence) {
      level = LAYOUT_CONFIDENCE.GOOD
      reasons.push('PDF barline counts (low overall confidence).')
    } else if (mismatch) {
      level = LAYOUT_CONFIDENCE.GOOD
      reasons.push('Using PDF barlines; printed layout differs from score data.')
    } else {
      level = LAYOUT_CONFIDENCE.EXACT
      reasons.push('PDF staff lines + barline counts agree with score data.')
    }
  } else if (allocationMode === ALLOCATION_MODE.BARLINE_COUNTS) {
    level = lowConfidence ? LAYOUT_CONFIDENCE.APPROXIMATE : LAYOUT_CONFIDENCE.GOOD
    reasons.push('PDF barline counts (fallback detection stage).')
  } else {
    // Reconciled or other plausible detection.
    level = lowConfidence ? LAYOUT_CONFIDENCE.APPROXIMATE : LAYOUT_CONFIDENCE.GOOD
    reasons.push('PDF system detection with reconciled measure distribution.')
    if (mismatch) {
      reasons.push('Printed layout differs from score data.')
    }
  }

  return { level, reasons, weakestSystem: weakestSystemIndex(perSystemInk) }
}

function weakestSystemIndex(perSystemInk) {
  if (!perSystemInk?.length) {
    return null
  }
  let minValue = Infinity
  let minIndex = null
  perSystemInk.forEach((value, index) => {
    const v = Number(value)
    if (Number.isFinite(v) && v < minValue) {
      minValue = v
      minIndex = index
    }
  })
  return minIndex
}
