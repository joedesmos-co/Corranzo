import { BETA_VERSION } from '../beta/betaInfo.js'
import { CALIBRATION_STRATEGY } from './smartScoreCalibration.js'

/** Systems below this smart-calibration score are highlighted as low-confidence. */
export const CALIBRATION_LOW_CONFIDENCE_THRESHOLD = 0.55

export const CALIBRATION_OVERLAY_DEFAULT_VISIBLE = false

export function isLowConfidenceSystem(confidence) {
  if (!Number.isFinite(confidence)) {
    return false
  }
  return confidence < CALIBRATION_LOW_CONFIDENCE_THRESHOLD
}

function round3(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null
}

function summarizeAnchors(anchors = []) {
  return anchors.map((anchor) => ({
    id: anchor.id,
    page: anchor.page,
    measureNumber: anchor.measureNumber,
    x: round3(anchor.x),
    y: round3(anchor.y),
    role: anchor.meta?.role ?? null,
    source: anchor.source ?? null,
  }))
}

/** Collect human-readable warnings and fallback notes from calibration artifacts. */
export function collectCalibrationWarnings({ debugReport, smartCalibration, orientation } = {}) {
  const warnings = []

  if (orientation?.anyRotated) {
    warnings.push({
      code: 'page-rotated',
      message: `Detected a rotated page (≈${orientation.maxRotation}°); corrected before detection.`,
    })
  }
  if (orientation?.anyUncertain) {
    warnings.push({
      code: 'orientation-uncertain',
      message: 'Page orientation was uncertain; confidence lowered.',
    })
  }
  if (debugReport?.layoutMismatch) {
    warnings.push({
      code: 'layout-mismatch',
      message: 'PDF layout disagrees with MusicXML layout hints.',
      details: debugReport.layoutMismatchReasons ?? [],
    })
  }
  if (debugReport?.layoutConfidence === 'low') {
    warnings.push({
      code: 'low-layout-confidence',
      message: 'Overall layout confidence is low.',
      details: debugReport.layoutConfidenceReasons ?? [],
    })
  }
  if (debugReport?.weakestSystemIndex != null) {
    warnings.push({
      code: 'weak-system',
      message: `Weakest detected system: index ${debugReport.weakestSystemIndex}.`,
    })
  }
  if (smartCalibration?.improvedOverBaseline) {
    warnings.push({
      code: 'strategy-fallback',
      message: `Smart calibration chose strategy ${smartCalibration.chosenStrategy} over baseline A.`,
    })
  }
  for (const page of smartCalibration?.pageLayout ?? []) {
    if (page.cropped) {
      warnings.push({
        code: 'page-cropped',
        message: `Page ${page.page} content may be cropped at the edge.`,
      })
    }
    if (Math.abs(page.offsetNormalized ?? 0) > 0.08) {
      warnings.push({
        code: 'page-offset',
        message: `Page ${page.page} has a horizontal offset (~${page.offsetPx ?? 'n/a'} px).`,
      })
    }
  }
  for (const system of smartCalibration?.perSystemConfidence ?? []) {
    if (isLowConfidenceSystem(system.confidence)) {
      warnings.push({
        code: 'low-system-confidence',
        message: `System ${system.index} confidence ${round3(system.confidence)}.`,
      })
    }
  }

  return warnings
}

/** Serializable snapshot stored after auto-setup for debug UI + export. */
export function buildCalibrationDebugSnapshot({
  debugReport = null,
  smartCalibration = null,
  orientation = null,
  proposedAnchors = [],
  supplementalMeasureAnchors = [],
  warnings = null,
} = {}) {
  if (!debugReport && !smartCalibration) {
    return null
  }

  const mergedWarnings =
    warnings ?? collectCalibrationWarnings({ debugReport, smartCalibration, orientation })

  return {
    capturedAt: new Date().toISOString(),
    debugReport,
    smartCalibration,
    orientation,
    anchorSummary: summarizeAnchors([...proposedAnchors, ...supplementalMeasureAnchors]),
    warnings: mergedWarnings,
    fallbacks: {
      chosenStrategy: smartCalibration?.chosenStrategy ?? null,
      chosenStrategyLabel: smartCalibration?.chosenStrategyLabel ?? null,
      improvedOverBaseline: smartCalibration?.improvedOverBaseline ?? false,
      allocationMode: debugReport?.allocationMode ?? null,
      stage: debugReport?.stage ?? null,
      reconciled: debugReport?.reconciled ?? null,
      strategyScores: smartCalibration?.strategyScores ?? [],
    },
  }
}

export function buildCalibrationDebugSnapshotFromPreview(preview) {
  if (!preview) {
    return null
  }
  return buildCalibrationDebugSnapshot({
    debugReport: preview.debugReport ?? null,
    smartCalibration: preview.smartCalibration ?? null,
    orientation: preview.orientation ?? null,
    proposedAnchors: preview.proposedAnchors ?? [],
    supplementalMeasureAnchors: preview.supplementalMeasureAnchors ?? [],
  })
}

/** Overlay primitives for one PDF page (normalized 0–1 coordinates). */
export function normalizeCalibrationOverlayPage(snapshot, pageNumber, anchors = []) {
  if (!snapshot?.debugReport) {
    return { page: pageNumber, systems: [], anchors: [] }
  }

  const perSystemConfidence = new Map(
    (snapshot.smartCalibration?.perSystemConfidence ?? []).map((entry) => [
      entry.index,
      entry.confidence,
    ]),
  )

  const systems = (snapshot.debugReport.systems ?? [])
    .filter((system) => system.page === pageNumber)
    .map((system) => {
      const confidence = perSystemConfidence.get(system.index) ?? null
      const content = system.contentBounds
      return {
        index: system.index,
        label: `S${system.index + 1}`,
        bounds: content
          ? {
              left: content.x0,
              top: system.y0,
              right: content.x1,
              bottom: system.y1,
            }
          : {
              left: system.firstAnchorX ?? 0,
              top: system.y0,
              right: system.lastAnchorX ?? 1,
              bottom: system.y1,
            },
        inkBounds:
          system.inkBounds?.found && Number.isFinite(system.inkBounds.left)
            ? {
                left: system.inkBounds.left,
                right: system.inkBounds.right,
                top: system.y0,
                bottom: system.y1,
              }
            : null,
        centerY: system.center,
        confidence,
        lowConfidence: isLowConfidenceSystem(confidence),
        measureStart: system.measureStart,
        measureEnd: system.measureEnd,
      }
    })

  const anchorSource =
    anchors.length > 0
      ? anchors
      : (snapshot.anchorSummary ?? []).map((anchor) => ({
          page: anchor.page,
          measureNumber: anchor.measureNumber,
          x: anchor.x,
          y: anchor.y,
          meta: { role: anchor.role },
        }))

  const pageAnchors = anchorSource
    .filter((anchor) => anchor.page === pageNumber)
    .map((anchor) => ({
      x: anchor.x,
      y: anchor.y,
      measureNumber: anchor.measureNumber,
      role: anchor.meta?.role ?? anchor.role ?? null,
    }))

  return {
    page: pageNumber,
    systems,
    anchors: pageAnchors,
  }
}

function safeBrowserInfo() {
  if (typeof navigator === 'undefined') {
    return null
  }
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
  }
}

/** JSON export payload — never includes uploaded file bytes or raw image data. */
export function buildCalibrationExportReport({
  snapshot,
  pieceName = null,
  anchors = [],
  appVersion = BETA_VERSION,
} = {}) {
  const smart = snapshot?.smartCalibration ?? null
  const debug = snapshot?.debugReport ?? null

  return {
    schema: 'corranzo-calibration-report-v1',
    appVersion,
    exportedAt: new Date().toISOString(),
    capturedAt: snapshot?.capturedAt ?? null,
    pieceName,
    chosenStrategy: smart?.chosenStrategy ?? CALIBRATION_STRATEGY.A,
    chosenStrategyLabel: smart?.chosenStrategyLabel ?? null,
    overallConfidence: smart?.overallConfidence ?? debug?.confidence ?? null,
    baselineConfidence: smart?.baselineConfidence ?? null,
    calibrationMs: smart?.calibrationMs ?? null,
    perPageConfidence: smart?.perPageConfidence ?? debug?.perPage ?? [],
    perSystemConfidence: smart?.perSystemConfidence ?? [],
    pageLayout: smart?.pageLayout ?? [],
    orientation: snapshot?.orientation ?? null,
    systemBounds: debug?.systems ?? [],
    inkBounds: (debug?.systems ?? []).map((system) => ({
      index: system.index,
      page: system.page,
      inkBounds: system.inkBounds ?? null,
    })),
    anchorsSummary: summarizeAnchors(anchors.length ? anchors : snapshot?.anchorSummary ?? []),
    warnings: snapshot?.warnings ?? [],
    fallbacks: snapshot?.fallbacks ?? null,
    strategyScores: smart?.strategyScores ?? [],
    browser: safeBrowserInfo(),
  }
}

export function downloadCalibrationReport(report, filename = 'corranzo-calibration-report.json') {
  const json = JSON.stringify(report, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
