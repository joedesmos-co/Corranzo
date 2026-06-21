import { createAnchorId } from './scoreFollowStorage.js'
import { ANCHOR_SOURCE } from './anchorUtils.js'
import {
  allocateMeasureSpansToSystems,
  buildSystemsByPage,
  groupMeasuresBySystemBreaks,
} from './allocateMeasuresToSystems.js'
import {
  detectBarlinePositionsInSystem,
  estimateMeasureXInSystem,
} from './detectBarlinesInSystem.js'
import {
  detectConservativeStaffSystems,
  detectContentBounds,
  detectTolerantStaffSystems,
  estimateSystemBandsFromContent,
  MAX_SYSTEMS_PER_PAGE,
  TOLERANT_MAX_SYSTEMS_PER_PAGE,
  systemEndAnchorPosition,
  systemInkWidthRatio,
  systemStartAnchorPosition,
} from './detectStaffSystems.js'
import { validateAutoAlignResult } from './autoAlignValidation.js'
import { clearPdfAnalysisCache, getPageInkRatio, renderPdfPageImageData } from './pdfPageAnalysis.js'

// Lower thresholds so uploaded PDF+MusicXML can get a cursor without needing
// near-perfect system detection. Even a low-confidence auto result is more
// useful than the "needs setup" wall. Manual markers always override.
const LOW_CONFIDENCE_THRESHOLD = 0.3
const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.42
const HARD_REFUSE_MIN_SYSTEMS = 1

/** Detection stages, in order of decreasing precision (Stage 2 → Stage 4). */
export const DETECTION_STAGE = {
  CONSERVATIVE: 'conservative',
  TOLERANT: 'tolerant',
  GEOMETRIC: 'geometric',
}

const STAGE_RANK = {
  [DETECTION_STAGE.CONSERVATIVE]: 3,
  [DETECTION_STAGE.TOLERANT]: 2,
  [DETECTION_STAGE.GEOMETRIC]: 1,
}

function getWrittenMeasureNumbers(timingMap) {
  if (!timingMap?.measures?.length) {
    return []
  }
  return timingMap.measures.map((measure) => measure.number)
}

/**
 * Number of systems implied by MusicXML system/page break hints, if any.
 * Used to validate detected counts and to seed the geometric fallback.
 */
function systemCountHintFromMusicXml(measureNumbers, timingMap) {
  const groups = groupMeasuresBySystemBreaks(measureNumbers, timingMap)
  return groups.length > 1 ? groups.length : null
}

/**
 * Per-page staff-system detection cascade — STAGES 2→4.
 *
 *   Stage 2a conservative  → high precision; used whenever it yields a sane count.
 *   Stage 2b tolerant      → dense / anime / lyric / uneven scans.
 *   Stage 4  geometric     → split inked content into bands (last resort, always
 *                            returns ≥1 band per inked page).
 *
 * Never hard-rejects a page for having "too many" systems — it clamps instead.
 * Returns the collected entries plus the lowest (weakest) stage that ran, so the
 * caller can label confidence and status honestly.
 */
function collectSystemEntriesForPages(renderedPages, { systemCountHint = null } = {}) {
  const systemEntries = []
  const pageStages = []
  const inkedPageCount = renderedPages.length

  for (const { page, imageData } of renderedPages) {
    const contentBounds = detectContentBounds(imageData)

    let stage = DETECTION_STAGE.CONSERVATIVE
    let systems = detectConservativeStaffSystems(imageData, contentBounds)

    // Escalate to tolerant detection when conservative finds nothing or an
    // implausibly large staff-line count (dense/over-segmented input).
    if (systems.length < 1 || systems.length > MAX_SYSTEMS_PER_PAGE) {
      const tolerant = detectTolerantStaffSystems(imageData, contentBounds, {
        maxSystems: TOLERANT_MAX_SYSTEMS_PER_PAGE,
      })
      if (tolerant.length >= 1) {
        systems = tolerant
        stage = DETECTION_STAGE.TOLERANT
      }
    }

    // Last resort: estimate bands purely from inked geometry + MusicXML hint.
    if (systems.length < 1) {
      const perPageHint =
        inkedPageCount === 1 && Number.isFinite(systemCountHint) ? systemCountHint : null
      systems = estimateSystemBandsFromContent(imageData, contentBounds, {
        systemCount: perPageHint,
        maxSystems: TOLERANT_MAX_SYSTEMS_PER_PAGE,
      })
      stage = DETECTION_STAGE.GEOMETRIC
    }

    // Clamp to a sane maximum so a noisy page can't flood the allocator.
    if (systems.length > TOLERANT_MAX_SYSTEMS_PER_PAGE) {
      systems = systems.slice(0, TOLERANT_MAX_SYSTEMS_PER_PAGE)
    }

    if (systems.length >= 1) {
      pageStages.push({ page, stage, count: systems.length })
    }

    for (const system of systems) {
      // Horizontal ink extent → used to weight measure allocation across systems
      // when MusicXML has no system-break hints (Stage 4 width distribution).
      const inkWidth = systemInkWidthRatio(imageData, contentBounds, system)
      systemEntries.push({ page, system, imageData, contentBounds, stage, inkWidth })
    }
  }

  // Overall stage = weakest stage that contributed any system.
  let overallStage = DETECTION_STAGE.CONSERVATIVE
  for (const { stage } of pageStages) {
    if (STAGE_RANK[stage] < STAGE_RANK[overallStage]) {
      overallStage = stage
    }
  }

  return { entries: systemEntries, pageStages, overallStage }
}

/**
 * Build system-start and optional system-end anchors for semi-auto follow.
 */
export function buildSystemSpanAnchors(systemEntries, spans) {
  const anchors = []

  spans.forEach((span, index) => {
    const entry = systemEntries[index]
    if (!entry) {
      return
    }

    const barlines = detectBarlinePositionsInSystem(
      entry.imageData,
      entry.contentBounds,
      entry.system,
    )
    const fallbackStart = systemStartAnchorPosition(entry.system, entry.contentBounds)
    const fallbackEnd = systemEndAnchorPosition(entry.system, entry.contentBounds)

    const startX = estimateMeasureXInSystem({
      measureIndex: 0,
      measuresInSpan: span.measuresInSpan,
      barlines,
      contentBounds: entry.contentBounds,
      fallbackStartX: fallbackStart.x,
      fallbackEndX: fallbackEnd.x,
    })
    const endX = estimateMeasureXInSystem({
      measureIndex: Math.max(0, span.measuresInSpan - 1),
      measuresInSpan: span.measuresInSpan,
      barlines,
      contentBounds: entry.contentBounds,
      fallbackStartX: fallbackStart.x,
      fallbackEndX: fallbackEnd.x,
    })

    anchors.push({
      id: createAnchorId(),
      page: entry.page,
      x: startX,
      y: fallbackStart.y,
      measureNumber: span.measureStart,
      source: ANCHOR_SOURCE.AUTO_SYSTEM,
      meta: {
        role: 'system-start',
        systemIndex: index,
        measuresInSpan: span.measuresInSpan,
      },
    })

    if (span.measureEnd !== span.measureStart) {
      anchors.push({
        id: createAnchorId(),
        page: entry.page,
        x: endX,
        y: fallbackEnd.y,
        measureNumber: span.measureEnd,
        source: ANCHOR_SOURCE.AUTO_SYSTEM,
        meta: {
          role: 'system-end',
          systemIndex: index,
          measuresInSpan: span.measuresInSpan,
        },
      })
    }
  })

  return anchors.sort((left, right) => left.measureNumber - right.measureNumber)
}

/**
 * Per-measure anchors from barline peaks — only when every system span has a confident barline fit.
 */
export function buildBarlineMeasureAnchorsIfConfident(systemEntries, spans) {
  const anchors = []

  for (const [index, span] of spans.entries()) {
    const entry = systemEntries[index]
    if (!entry || !span.measureNumbers?.length) {
      return []
    }

    const barlines = detectBarlinePositionsInSystem(
      entry.imageData,
      entry.contentBounds,
      entry.system,
    )
    const measuresInSpan = span.measuresInSpan
    const usableBarlines =
      barlines.length >= measuresInSpan - 1 &&
      barlines.length <= (measuresInSpan - 1) * 2

    if (!usableBarlines || measuresInSpan < 2) {
      return []
    }

    const fallbackStart = systemStartAnchorPosition(entry.system, entry.contentBounds)
    const fallbackEnd = systemEndAnchorPosition(entry.system, entry.contentBounds)

    span.measureNumbers.forEach((measureNumber, measureIndex) => {
      const x = estimateMeasureXInSystem({
        measureIndex,
        measuresInSpan,
        barlines,
        contentBounds: entry.contentBounds,
        fallbackStartX: fallbackStart.x,
        fallbackEndX: fallbackEnd.x,
      })
      anchors.push({
        id: createAnchorId(),
        page: entry.page,
        x,
        y: fallbackStart.y,
        measureNumber,
        source: ANCHOR_SOURCE.AUTO_MEASURE,
        meta: {
          role: 'measure',
          systemIndex: index,
          barlineAnchored: true,
        },
      })
    })
  }

  return anchors.sort((left, right) => left.measureNumber - right.measureNumber)
}

export function shouldAutoApplySemiAutoResult(preview) {
  if (!preview?.proposedAnchors?.length) {
    return false
  }
  if (preview.lowConfidence) {
    return false
  }
  return preview.confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD
}

const STAGE_BASE_CONFIDENCE = {
  [DETECTION_STAGE.CONSERVATIVE]: 0.5,
  [DETECTION_STAGE.TOLERANT]: 0.4,
  [DETECTION_STAGE.GEOMETRIC]: 0.32,
}

function scoreSemiAutoConfidence({
  measureCount,
  anchorCount,
  systemCount,
  inkPages,
  systemsPerPage,
  validationOk,
  stage = DETECTION_STAGE.CONSERVATIVE,
  systemCountHint = null,
}) {
  if (systemCount < HARD_REFUSE_MIN_SYSTEMS || measureCount < 1) {
    return 0
  }

  let score = STAGE_BASE_CONFIDENCE[stage] ?? 0.36

  if (validationOk) {
    score += 0.22
  } else {
    score += 0.06
  }

  if (anchorCount >= systemCount && anchorCount <= systemCount * 2) {
    score += 0.16
  }

  const anchorRatio = anchorCount / measureCount
  if (anchorRatio >= 0.04 && anchorRatio <= 0.5) {
    score += 0.1
  }

  if (systemsPerPage > 0 && systemsPerPage <= MAX_SYSTEMS_PER_PAGE) {
    score += 0.08
  }

  // Detected system count agreeing with MusicXML system-break hints is a strong
  // signal that the page→measure mapping is plausible.
  if (Number.isFinite(systemCountHint) && systemCountHint >= 1) {
    const ratio = systemCount / systemCountHint
    if (ratio >= 0.75 && ratio <= 1.34) {
      score += 0.12
    }
  }

  if (inkPages > 0) {
    score += 0.04
  }

  return Math.min(1, Math.max(0, score))
}

/**
 * Analyze PDF + MusicXML and return a user-reviewable semi-auto setup preview.
 */
export async function analyzeSemiAutoScoreSetup({
  pdfSource,
  numPages,
  timingMap,
  onProgress,
  // Injectable for tests / fixture scripts: (pdfSource, page) => { imageData }.
  renderPage = renderPdfPageImageData,
}) {
  const measureNumbers = getWrittenMeasureNumbers(timingMap)
  if (!pdfSource || !numPages || numPages < 1) {
    return { ok: false, message: 'Load a PDF before setting up score follow.' }
  }
  if (measureNumbers.length === 0) {
    return { ok: false, message: 'Load score timing (MusicXML) first.' }
  }

  if (renderPage === renderPdfPageImageData) {
    clearPdfAnalysisCache()
  }

  const renderedPages = []
  let inkPages = 0

  for (let page = 1; page <= numPages; page += 1) {
    onProgress?.(((page - 1) / numPages) * 0.82, `Scanning page ${page} of ${numPages}…`)
    const rendered = await renderPage(pdfSource, page)
    const ink = getPageInkRatio(rendered.imageData)
    if (ink < 0.006) {
      continue
    }
    inkPages += 1
    renderedPages.push({ page, imageData: rendered.imageData })
  }

  onProgress?.(0.9, 'Finding staff systems…')

  const systemCountHint = systemCountHintFromMusicXml(measureNumbers, timingMap)
  const { entries: systemEntries, pageStages, overallStage } = collectSystemEntriesForPages(
    renderedPages,
    { systemCountHint },
  )

  // Truly last resort: not a single inked page yielded even one band. Only here
  // do we ask the user to mark system starts (concise fallback copy lives in UI).
  if (systemEntries.length < HARD_REFUSE_MIN_SYSTEMS) {
    return {
      ok: false,
      message: 'Auto setup could not find systems. Mark system starts.',
      noSystems: true,
    }
  }

  onProgress?.(0.96, 'Estimating measures per system…')

  const spans = allocateMeasureSpansToSystems(systemEntries, measureNumbers, timingMap)
  const proposedAnchors = buildSystemSpanAnchors(systemEntries, spans)
  const supplementalMeasureAnchors = buildBarlineMeasureAnchorsIfConfident(
    systemEntries,
    spans,
  )
  const systemsByPage = buildSystemsByPage(systemEntries, spans)

  const validation = validateAutoAlignResult({
    anchors: proposedAnchors,
    systemEntries,
    measureCount: measureNumbers.length,
    mode: 'system-span',
  })

  const systemsPerPage = inkPages > 0 ? systemEntries.length / inkPages : systemEntries.length
  const confidence = scoreSemiAutoConfidence({
    measureCount: measureNumbers.length,
    anchorCount: proposedAnchors.length,
    systemCount: systemEntries.length,
    inkPages,
    systemsPerPage,
    validationOk: validation.ok,
    stage: overallStage,
    systemCountHint,
  })

  // A failed strict validation no longer blocks the cursor — geometric/tolerant
  // results are intentionally approximate. Confidence alone gates auto-apply.
  const lowConfidence = confidence < LOW_CONFIDENCE_THRESHOLD
  const approximate = overallStage !== DETECTION_STAGE.CONSERVATIVE || lowConfidence

  onProgress?.(1, 'Finishing setup…')

  const autoApplyRecommended = shouldAutoApplySemiAutoResult({
    proposedAnchors,
    confidence,
    lowConfidence,
  })

  return {
    ok: true,
    preview: {
      systemsByPage,
      systemEntries,
      spans,
      proposedAnchors,
      supplementalMeasureAnchors,
      confidence,
      lowConfidence,
      approximate,
      stage: overallStage,
      pageStages,
      systemCountHint,
      validationMessage: validation.ok ? null : validation.reason,
      measureCount: measureNumbers.length,
      systemCount: systemEntries.length,
      anchorCount: proposedAnchors.length,
      inkPages,
      autoApplyRecommended,
    },
  }
}
