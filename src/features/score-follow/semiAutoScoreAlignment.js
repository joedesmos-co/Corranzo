import { createAnchorId } from './scoreFollowStorage.js'
import { ANCHOR_SOURCE } from './anchorUtils.js'
import {
  allocateMeasureSpansToSystems,
  buildSystemsByPage,
} from './allocateMeasuresToSystems.js'
import {
  detectBarlinePositionsInSystem,
  estimateMeasureXInSystem,
} from './detectBarlinesInSystem.js'
import {
  detectConservativeStaffSystems,
  detectContentBounds,
  MAX_SYSTEMS_PER_PAGE,
  systemEndAnchorPosition,
  systemStartAnchorPosition,
} from './detectStaffSystems.js'
import { validateAutoAlignResult } from './autoAlignValidation.js'
import { clearPdfAnalysisCache, getPageInkRatio, renderPdfPageImageData } from './pdfPageAnalysis.js'

// Lower thresholds so uploaded PDF+MusicXML can get a cursor without needing
// near-perfect system detection. Even a low-confidence auto result is more
// useful than the "needs setup" wall. Manual markers always override.
const LOW_CONFIDENCE_THRESHOLD = 0.30
const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.42
const HARD_REFUSE_MIN_SYSTEMS = 1

function getWrittenMeasureNumbers(timingMap) {
  if (!timingMap?.measures?.length) {
    return []
  }
  return timingMap.measures.map((measure) => measure.number)
}

function collectConservativeSystemEntries(renderedPages) {
  const systemEntries = []

  for (const { page, imageData } of renderedPages) {
    const contentBounds = detectContentBounds(imageData)
    const systems = detectConservativeStaffSystems(imageData, contentBounds)

    if (systems.length > MAX_SYSTEMS_PER_PAGE) {
      return { entries: [], rejected: true, page }
    }

    for (const system of systems) {
      systemEntries.push({
        page,
        system,
        imageData,
        contentBounds,
      })
    }
  }

  return { entries: systemEntries, rejected: false }
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

function scoreSemiAutoConfidence({
  measureCount,
  anchorCount,
  systemCount,
  inkPages,
  systemsPerPage,
  validationOk,
}) {
  if (systemCount < HARD_REFUSE_MIN_SYSTEMS || measureCount < 1) {
    return 0
  }

  let score = 0.4

  if (validationOk) {
    score += 0.28
  } else {
    score += 0.08
  }

  if (anchorCount >= systemCount && anchorCount <= systemCount * 2) {
    score += 0.18
  }

  const anchorRatio = anchorCount / measureCount
  if (anchorRatio >= 0.04 && anchorRatio <= 0.5) {
    score += 0.12
  }

  if (systemsPerPage > 0 && systemsPerPage <= MAX_SYSTEMS_PER_PAGE) {
    score += 0.1
  }

  if (inkPages > 0) {
    score += 0.06
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
}) {
  const measureNumbers = getWrittenMeasureNumbers(timingMap)
  if (!pdfSource || !numPages || numPages < 1) {
    return { ok: false, message: 'Load a PDF before setting up score follow.' }
  }
  if (measureNumbers.length === 0) {
    return { ok: false, message: 'Load score timing (MusicXML) first.' }
  }

  clearPdfAnalysisCache()

  const renderedPages = []
  let inkPages = 0

  for (let page = 1; page <= numPages; page += 1) {
    onProgress?.(((page - 1) / numPages) * 0.82, `Scanning page ${page} of ${numPages}…`)
    const rendered = await renderPdfPageImageData(pdfSource, page)
    const ink = getPageInkRatio(rendered.imageData)
    if (ink < 0.006) {
      continue
    }
    inkPages += 1
    renderedPages.push({ page, imageData: rendered.imageData })
  }

  onProgress?.(0.9, 'Finding staff systems…')

  const { entries: systemEntries, rejected, page: rejectedPage } =
    collectConservativeSystemEntries(renderedPages)

  if (rejected) {
    return {
      ok: false,
      message: `Too many staff regions on page ${rejectedPage}. Use manual correction or a cleaner PDF scan.`,
    }
  }

  if (systemEntries.length < HARD_REFUSE_MIN_SYSTEMS) {
    return {
      ok: false,
      message:
        'No staff systems were detected reliably. Try manual marking, or a PDF with clearer staff lines.',
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
  })

  const lowConfidence = confidence < LOW_CONFIDENCE_THRESHOLD || !validation.ok

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
      validationMessage: validation.ok ? null : validation.reason,
      measureCount: measureNumbers.length,
      systemCount: systemEntries.length,
      anchorCount: proposedAnchors.length,
      inkPages,
      autoApplyRecommended,
    },
  }
}
