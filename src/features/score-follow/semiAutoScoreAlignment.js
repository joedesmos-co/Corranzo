import { createAnchorId } from './scoreFollowStorage.js'
import { ANCHOR_SOURCE } from './anchorUtils.js'
import {
  allocateMeasureSpansToSystems,
  allocateSpansByCounts,
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
import { detectStaffLineSystems, detectSystemBarlinePositions, buildStaffDetectionDiagnostics } from './detectStaffLines.js'
import { validateAutoAlignResult } from './autoAlignValidation.js'
import { collectMeasureDefaultXHints } from './musicxmlLayoutAnchors.js'
import { clearPdfAnalysisCache, getPageInkRatio, renderPdfPageImageData } from './pdfPageAnalysis.js'
import {
  assessLayoutConfidence,
  detectLayoutMismatch,
  pageCountFromMusicXml,
  systemStartsFromMusicXml,
  systemStartsFromSpans,
} from './layoutAssessment.js'

/** Sum of staves across MusicXML parts (e.g. 2 for piano). Default 1. */
function getStavesPerSystem(timingMap) {
  const value = Number(timingMap?.stavesPerSystem)
  return Number.isFinite(value) && value >= 1 ? value : 1
}

// Lower thresholds so uploaded PDF+MusicXML can get a cursor without needing
// near-perfect system detection. Even a low-confidence auto result is more
// useful than the "needs setup" wall. Manual markers always override.
const LOW_CONFIDENCE_THRESHOLD = 0.3
const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.42
const HARD_REFUSE_MIN_SYSTEMS = 1

/** Detection stages, in order of decreasing precision. */
export const DETECTION_STAGE = {
  STAFF_LINES: 'staff-lines',
  CONSERVATIVE: 'conservative',
  TOLERANT: 'tolerant',
  GEOMETRIC: 'geometric',
}

const STAGE_RANK = {
  [DETECTION_STAGE.STAFF_LINES]: 4,
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

const round3 = (value) => (value == null ? null : Math.round(value * 1000) / 1000)
const round2 = (value) => (value == null ? null : Math.round(value * 100) / 100)

/** Median of a numeric array (used to estimate a system's typical measure width). */
function medianOf(values) {
  if (!values?.length) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Structured, dev-only auto-setup debug report. Surfaces exactly why a mapping
 * landed where it did: detected systems + y positions, allocated measure ranges,
 * first/last measure per system, anchor sources, MusicXML hints used, and the
 * stage/confidence/plausibility used. Never shown in normal production UI.
 */
function buildAutoSetupDebugReport({
  systemEntries,
  spans,
  proposedAnchors,
  supplementalMeasureAnchors,
  pageStages,
  overallStage,
  confidence,
  systemCountHint,
  expectedSystemCount,
  reconciled,
  plausible,
  allocationMode = null,
  stavesPerSystem = null,
  timingMap,
  layoutMismatch = null,
  layoutConfidence = null,
}) {
  const lastAnchorByMeasure = new Map(proposedAnchors.map((a) => [a.measureNumber, a]))
  const systems = spans.map((span, index) => {
    const entry = systemEntries[index]
    const startAnchor = proposedAnchors.find(
      (a) => a.meta?.systemIndex === index && a.meta?.role === 'system-start',
    )
    const endAnchor = lastAnchorByMeasure.get(span.measureEnd)
    return {
      index,
      page: entry?.page ?? null,
      stage: entry?.stage ?? null,
      y0: entry ? round3(entry.system.y0) : null,
      y1: entry ? round3(entry.system.y1) : null,
      center: entry ? round3(entry.system.center) : null,
      measureStart: span.measureStart,
      measureEnd: span.measureEnd,
      measureCount: span.measuresInSpan,
      barlineCount: entry?.system?.barlineCount ?? null,
      barlineConfident: entry?.system?.barlineConfident ?? null,
      barlineReliabilityReason: entry?.system?.barlineReliabilityReason ?? null,
      barlineCandidatesRaw: entry?.system?.barlineCandidatesRaw ?? null,
      barlineAccepted: entry?.system?.barlineAccepted ?? null,
      barlineRejected: entry?.system?.barlineRejected ?? null,
      barlineRetainedLowConfidence: entry?.system?.barlineRetainedLowConfidence ?? null,
      barlineThinningRemoved: entry?.system?.barlineThinningRemoved ?? null,
      barlineDensityAmbiguous: entry?.system?.barlineDensityAmbiguous ?? null,
      barlineConfidenceLevel: entry?.system?.barlineConfidenceLevel ?? null,
      firstAnchorX: startAnchor ? round3(startAnchor.x) : null,
      lastAnchorX: endAnchor ? round3(endAnchor.x) : null,
    }
  })

  const measures = timingMap?.measures ?? []
  const hasSystemBreaks = measures.some((m, i) => i > 0 && m.systemBreakBefore)
  const hasPageBreaks = measures.some((m) => m.pageBreakBefore)
  const defaultXHints = collectMeasureDefaultXHints(timingMap)
  const defaultXCoverage = measures.length > 0 ? defaultXHints.size / measures.length : 0

  const sourceCounts = {}
  for (const anchor of [...proposedAnchors, ...supplementalMeasureAnchors]) {
    sourceCounts[anchor.source] = (sourceCounts[anchor.source] ?? 0) + 1
  }

  return {
    stage: overallStage,
    allocationMode,
    confidence: round2(confidence),
    plausible,
    reconciled,
    // Honest layout assessment — PDF vs MusicXML layout + graded confidence.
    layoutConfidence: layoutConfidence?.level ?? null,
    layoutConfidenceReasons: layoutConfidence?.reasons ?? [],
    layoutMismatch: layoutMismatch?.mismatch ?? false,
    layoutMismatchReasons: layoutMismatch?.reasons ?? [],
    weakestSystemIndex: layoutConfidence?.weakestSystem ?? null,
    measureCount: measures.length,
    stavesPerSystem,
    detectedSystemCount: systemEntries.length,
    expectedSystemCount: expectedSystemCount ?? null,
    systemCountHint: systemCountHint ?? null,
    hintsUsed: {
      systemBreaks: hasSystemBreaks,
      pageBreaks: hasPageBreaks,
      defaultX: defaultXCoverage > 0,
      defaultXCoverage: round2(defaultXCoverage),
    },
    perPage: pageStages.map((p) => ({
      page: p.page,
      stage: p.stage,
      systemCount: p.count,
      staffDetection: p.staffDetection ?? null,
    })),
    systems,
    anchorSourceCounts: sourceCounts,
  }
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
function collectSystemEntriesForPages(
  renderedPages,
  { systemCountHint = null, stavesPerSystem = 1 } = {},
) {
  const systemEntries = []
  const pageStages = []
  const inkedPageCount = renderedPages.length

  for (const { page, imageData } of renderedPages) {
    const contentBounds = detectContentBounds(imageData)
    const staffLine = detectStaffLineSystems(imageData, contentBounds, { stavesPerSystem })
    const staffDetection = buildStaffDetectionDiagnostics(imageData, {
      contentBounds,
      stavesPerSystem,
      staffLineResult: staffLine,
    })
    if (staffLine.systems.length >= 1) {
      for (const system of staffLine.systems) {
        systemEntries.push({
          page,
          system,
          imageData,
          contentBounds,
          stage: DETECTION_STAGE.STAFF_LINES,
          inkWidth: systemInkWidthRatio(imageData, contentBounds, system),
          measureEstimate: system.measureEstimate,
          inkThreshold: staffLine.inkThreshold,
        })
      }
      pageStages.push({
        page,
        stage: DETECTION_STAGE.STAFF_LINES,
        count: staffLine.systems.length,
        contentBounds,
        staffDetection,
      })
      continue
    }

    // ── FALLBACKS: row-density detection for low-res / faint scans ──────────
    const conservative = detectConservativeStaffSystems(imageData, contentBounds)
    const tolerant = detectTolerantStaffSystems(imageData, contentBounds, {
      maxSystems: TOLERANT_MAX_SYSTEMS_PER_PAGE,
    })

    let systems
    let stage
    const tolerantOverSegments =
      conservative.length >= 2 && tolerant.length > conservative.length * 1.8
    const conservativeTrusted =
      conservative.length >= 1 &&
      conservative.length <= MAX_SYSTEMS_PER_PAGE &&
      (tolerantOverSegments || conservative.length >= tolerant.length)

    if (conservativeTrusted) {
      systems = conservative
      stage = DETECTION_STAGE.CONSERVATIVE
    } else if (tolerant.length >= 1) {
      systems = tolerant
      stage = DETECTION_STAGE.TOLERANT
    } else {
      const perPageHint =
        inkedPageCount === 1 && Number.isFinite(systemCountHint) ? systemCountHint : null
      systems = estimateSystemBandsFromContent(imageData, contentBounds, {
        systemCount: perPageHint,
        maxSystems: TOLERANT_MAX_SYSTEMS_PER_PAGE,
      })
      stage = DETECTION_STAGE.GEOMETRIC
    }

    if (systems.length > TOLERANT_MAX_SYSTEMS_PER_PAGE) {
      systems = systems.slice(0, TOLERANT_MAX_SYSTEMS_PER_PAGE)
    }

    if (systems.length >= 1) {
      pageStages.push({ page, stage, count: systems.length, contentBounds, staffDetection })
    }

    for (const system of systems) {
      const inkWidth = systemInkWidthRatio(imageData, contentBounds, system)
      systemEntries.push({ page, system, imageData, contentBounds, stage, inkWidth })
    }
  }

  // ── Reconcile detected count with the MusicXML-implied system count ─────────
  // If MusicXML says N systems but pixel detection disagrees by more than one,
  // the page→measure mapping would be wrong. For a single inked page, rebuild
  // bands geometrically to EXACTLY the expected count, preserving MusicXML
  // structure rather than accepting a bad detected count.
  let reconciled = false
  if (
    inkedPageCount === 1 &&
    Number.isFinite(systemCountHint) &&
    systemCountHint >= 1 &&
    Math.abs(systemEntries.length - systemCountHint) > 1
  ) {
    const { page, imageData } = renderedPages[0]
    const contentBounds = detectContentBounds(imageData)
    const geo = estimateSystemBandsFromContent(imageData, contentBounds, {
      systemCount: systemCountHint,
      maxSystems: TOLERANT_MAX_SYSTEMS_PER_PAGE,
    })
    if (geo.length >= 1) {
      systemEntries.length = 0
      pageStages.length = 0
      for (const system of geo) {
        systemEntries.push({
          page,
          system,
          imageData,
          contentBounds,
          stage: DETECTION_STAGE.GEOMETRIC,
          inkWidth: systemInkWidthRatio(imageData, contentBounds, system),
        })
      }
      pageStages.push({
        page,
        stage: DETECTION_STAGE.GEOMETRIC,
        count: geo.length,
        contentBounds,
      })
      reconciled = true
    }
  }

  // Overall stage = weakest stage that contributed any system.
  let overallStage = DETECTION_STAGE.STAFF_LINES
  for (const { stage } of pageStages) {
    if (STAGE_RANK[stage] < STAGE_RANK[overallStage]) {
      overallStage = stage
    }
  }

  return {
    entries: systemEntries,
    pageStages,
    overallStage,
    reconciled,
    expectedSystemCount: systemCountHint ?? null,
  }
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
 * One canonical visual anchor per WRITTEN measure, evenly spaced across each
 * detected system's horizontal range. This is what drives the playback cursor:
 * with an anchor for every measure, the resolver glides smoothly measure→measure
 * instead of stalling on the system start then jumping/bouncing across a single
 * start→end span. Each anchor records the system-end x so the final measure of a
 * system can glide to the edge before the cursor drops to the next system.
 *
 * x is evenly distributed from the system measure count (stable, monotonic) —
 * barline x-positions are intentionally NOT used here because they are noisy and
 * caused the end-jitter; the measure COUNT already came from barline detection.
 */
export function buildPerMeasureSystemAnchors(systemEntries, spans, timingMap = null) {
  const widthByMeasure = new Map(
    (timingMap?.measures ?? []).map((m) => [m.number, m.engravedWidth]),
  )
  // First (leftmost) note default-x per measure — beat 1's engraved offset
  // INSIDE its measure (tenths). Inherently skips the clef/key/time of a
  // system's first measure, because the engraver placed the note after them.
  const defaultXByMeasure = collectMeasureDefaultXHints(timingMap)
  const anchors = []

  spans.forEach((span, index) => {
    const entry = systemEntries[index]
    const measureNumbers = span?.measureNumbers
    if (!entry || !measureNumbers?.length) {
      return
    }

    const startPos = systemStartAnchorPosition(entry.system, entry.contentBounds)
    const endPos = systemEndAnchorPosition(entry.system, entry.contentBounds)
    const y = startPos.y

    // Anchor the MusicXML tenths axis onto the PDF using detected barlines
    // (first & last) when available — these are the measure boundaries. Falls
    // back to the system's inset content range.
    const barlineThreshold = Math.max(150, (entry.inkThreshold ?? 170) - 20)
    const barlines = entry.imageData
      ? detectSystemBarlinePositions(entry.imageData, entry.contentBounds, entry.system, {
          darkThreshold: barlineThreshold,
        })
      : []
    let sysLeftX = startPos.x
    let sysRightX = endPos.x
    let anchorKind = 'estimated'
    if (barlines.length >= 2 && barlines[barlines.length - 1] > barlines[0]) {
      sysLeftX = barlines[0]
      sysRightX = barlines[barlines.length - 1]
      anchorKind = 'barline'
    }

    const count = measureNumbers.length

    // Cumulative engraved widths give each measure's left edge; equal widths if
    // the MusicXML has no <measure width>.
    const widths = measureNumbers.map((m) => {
      const w = widthByMeasure.get(m)
      return Number.isFinite(w) && w > 0 ? w : 1
    })
    const haveWidths = measureNumbers.some((m) => Number.isFinite(widthByMeasure.get(m)))
    const totalWidth = widths.reduce((a, b) => a + b, 0) || measureNumbers.length
    const leftTenths = []
    let acc = 0
    for (const w of widths) {
      leftTenths.push(acc)
      acc += w
    }
    const tenthsToX = (t) => sysLeftX + (t / totalWidth) * (sysRightX - sysLeftX)

    // Measure boundaries on the page. When the detected barlines cleanly match
    // the measure count (count internal+edge barlines = count + 1, strictly
    // increasing), use them as the EXACT per-measure boundaries — this captures
    // real uneven measure widths (wider first measures, ritard spacing, etc.)
    // that even distribution mis-places. Otherwise fall back to the cumulative-
    // width / even distribution, which is identical to the previous behaviour
    // (so evenly engraved scores are unchanged). `boundaries` has count+1 edges.
    const barlinesMatchMeasures =
      anchorKind === 'barline' &&
      barlines.length === count + 1 &&
      barlines.every((x, i) => i === 0 || x > barlines[i - 1])
    const boundaries = barlinesMatchMeasures
      ? barlines
      : measureNumbers.map((_, i) => tenthsToX(leftTenths[i])).concat(tenthsToX(totalWidth))
    const boundaryKind = barlinesMatchMeasures ? 'barline-boundaries' : anchorKind

    measureNumbers.forEach((measureNumber, i) => {
      const measureStartX = boundaries[i]
      const measureEndX = boundaries[i + 1]
      const measureSpan = Math.max(0, measureEndX - measureStartX)

      // measurePlayableStartX: where beat 1 sits inside THIS measure. The lead is
      // expressed as a FRACTION of the measure, then applied to the measure's true
      // span — so on evenly engraved scores it is identical to before, but on
      // detected uneven measures beat 1 tracks the real (wider/narrower) measure.
      const dx = defaultXByMeasure.get(measureNumber)
      let playableStartX
      let xSource
      if (haveWidths && Number.isFinite(dx)) {
        // PRIMARY: the engraved first-note default-x already sits after any
        // clef/key/time. Clamp so a mis-encoded value can't push beat 1 past the
        // bulk of the measure (guard: never far right of the first note).
        const offset = Math.min(Math.max(dx, 0), 0.85 * widths[i])
        const offsetFrac = widths[i] > 0 ? offset / widths[i] : 0
        playableStartX = measureStartX + offsetFrac * measureSpan
        xSource = boundaryKind === 'barline-boundaries' ? 'default-x+barline' : 'default-x'
      } else if (i === 0 && haveWidths && count > 1) {
        // SYSTEM-START FALLBACK (no default-x): a system's first measure is
        // engraved wider to hold the clef/key/(time). Estimate that lead as how
        // much wider it is than the system's other measures, so beat 1 clears the
        // clef/key area instead of sitting at the far-left margin. Clamped so it
        // never collapses to the margin nor overshoots the first note.
        const otherWidths = widths.filter((_, j) => j !== i)
        const clefKeyLeadTenths = Math.min(
          Math.max(widths[i] - medianOf(otherWidths), 0.12 * widths[i]),
          0.6 * widths[i],
        )
        const leadFrac = widths[i] > 0 ? clefKeyLeadTenths / widths[i] : 0.3
        playableStartX = measureStartX + leadFrac * measureSpan
        xSource = 'system-start-width'
      } else {
        // Conservative local lead: a larger inset on a system's first measure to
        // clear the clef/key area, a small margin past the barline on the rest.
        const lead = i === 0 ? 0.3 : 0.05
        playableStartX = measureStartX + lead * measureSpan
        xSource = boundaryKind
      }

      anchors.push({
        id: createAnchorId(),
        page: entry.page,
        x: playableStartX,
        y,
        measureNumber,
        source: ANCHOR_SOURCE.AUTO_MEASURE,
        meta: {
          role: 'measure',
          systemIndex: index,
          measuresInSpan: count,
          indexInSystem: i,
          lastInSystem: i === count - 1,
          // Per-measure visual span the cursor glides within.
          measureStartX,
          playableStartX,
          playableEndX: measureEndX,
          systemEndX: sysRightX,
          xSource,
        },
      })
    })
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
  [DETECTION_STAGE.STAFF_LINES]: 0.6,
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
  const stavesPerSystem = getStavesPerSystem(timingMap)
  const {
    entries: systemEntries,
    pageStages,
    overallStage,
    reconciled,
    expectedSystemCount,
  } = collectSystemEntriesForPages(renderedPages, { systemCountHint, stavesPerSystem })

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

  // Prefer barline-derived per-system measure counts (staff-line path). They map
  // measures to the correct visual system even when MusicXML's embedded page/
  // system breaks disagree with the actual PDF engraving. Only used when every
  // system has an estimate and the total is within tolerance of the written
  // measure count; otherwise fall back to MusicXML breaks / even distribution.
  const measureCounts = systemEntries.map((entry) => entry.measureEstimate)
  const haveAllCounts = measureCounts.every((c) => Number.isFinite(c) && c >= 1)
  const countsTotal = haveAllCounts ? measureCounts.reduce((a, b) => a + b, 0) : 0
  const countsUsable =
    haveAllCounts &&
    measureNumbers.length > 0 &&
    Math.abs(countsTotal - measureNumbers.length) <= Math.max(2, measureNumbers.length * 0.25)

  const allocationMode = countsUsable ? 'barline-counts' : 'breaks-or-even'
  const spans = countsUsable
    ? allocateSpansByCounts(systemEntries, measureNumbers, measureCounts)
    : allocateMeasureSpansToSystems(systemEntries, measureNumbers, timingMap)
  const proposedAnchors = buildSystemSpanAnchors(systemEntries, spans)
  // One canonical anchor per written measure drives the cursor (AUTO_MEASURE
  // outranks the AUTO_SYSTEM start/end spans during dedupe), so playback glides
  // measure-by-measure instead of stalling then jumping across a whole system.
  const supplementalMeasureAnchors = buildPerMeasureSystemAnchors(systemEntries, spans, timingMap)
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

  // Guardrail: the page→system mapping is implausible when MusicXML implies a
  // system count we couldn't match (and couldn't reconcile). Such a mapping
  // would put the cursor on the wrong system, so we downgrade to "needs setup"
  // rather than show a confidently-wrong cursor.
  const systemCountMismatch =
    Number.isFinite(expectedSystemCount) &&
    expectedSystemCount >= 1 &&
    Math.abs(systemEntries.length - expectedSystemCount) > 1 &&
    !reconciled

  // Header guardrail: measure 1's anchor must sit on the first staff system, not
  // up in the title/composer block. If it does, the mapping is wrong.
  const firstMeasure = measureNumbers[0]
  const firstAnchor = proposedAnchors
    .filter((a) => a.measureNumber === firstMeasure)
    .sort((a, b) => a.y - b.y)[0]
  const measureOneInHeader = firstAnchor != null && firstAnchor.y < 0.08

  const plausible =
    !systemCountMismatch && !measureOneInHeader && proposedAnchors.length >= 2

  // The precise path: staff-line systems with barline-counted measure ranges.
  // This maps measures to the correct visual system, so it earns "Auto setup
  // complete". All other plausible results are labelled "Approximate cursor".
  const precise =
    overallStage === DETECTION_STAGE.STAFF_LINES &&
    allocationMode === 'barline-counts' &&
    !lowConfidence
  const approximate = plausible && !precise

  onProgress?.(1, 'Finishing setup…')

  const autoApplyRecommended =
    plausible &&
    !approximate &&
    shouldAutoApplySemiAutoResult({ proposedAnchors, confidence, lowConfidence })

  // Honest layout assessment: does the PDF-derived allocation disagree with the
  // MusicXML-implied layout, and how confident is the overall alignment? The PDF
  // allocation is always preferred; this only reports + grades it.
  const layoutMismatch = detectLayoutMismatch({
    pdfStarts: systemStartsFromSpans(spans),
    musicXmlStarts: systemStartsFromMusicXml(timingMap),
    pdfPageCount: inkPages,
    musicXmlPageCount: pageCountFromMusicXml(timingMap),
  })
  const layoutConfidence = assessLayoutConfidence({
    stage: overallStage,
    allocationMode,
    plausible,
    lowConfidence,
    mismatch: layoutMismatch.mismatch,
    perSystemInk: systemEntries.map((entry) => entry.inkWidth),
  })

  const debugReport = buildAutoSetupDebugReport({
    systemEntries,
    spans,
    proposedAnchors,
    supplementalMeasureAnchors,
    pageStages,
    overallStage,
    confidence,
    systemCountHint,
    expectedSystemCount,
    reconciled,
    plausible,
    allocationMode,
    stavesPerSystem,
    timingMap,
    layoutMismatch,
    layoutConfidence,
  })

  return {
    ok: true,
    preview: {
      layoutMismatch,
      layoutConfidence,
      systemsByPage,
      systemEntries,
      spans,
      proposedAnchors,
      supplementalMeasureAnchors,
      confidence,
      lowConfidence,
      approximate,
      plausible,
      precise,
      reconciled,
      allocationMode,
      stage: overallStage,
      pageStages,
      systemCountHint,
      expectedSystemCount,
      validationMessage: validation.ok ? null : validation.reason,
      measureCount: measureNumbers.length,
      systemCount: systemEntries.length,
      anchorCount: proposedAnchors.length,
      inkPages,
      autoApplyRecommended,
      debugReport,
    },
  }
}
