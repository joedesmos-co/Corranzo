/**
 * Demo calibration workflow — source quality, hybrid anchor generation, and
 * diagnostics. Tooling only; does not change runtime score-follow behaviour.
 */
import {
  groupMeasuresBySystemBreaks,
  reconcileCountsToTotal,
} from './allocateMeasuresToSystems.js'
import {
  detectLayoutMismatch,
  pageCountFromMusicXml,
  systemStartsFromMusicXml,
} from './layoutAssessment.js'
import { summarizeBarlineDiagnostics } from './pdfPageAnalysis.js'
import {
  buildBundledAnchorsFromAutoAnchors,
  calibrateAnchorsFromDetection,
  compareBundledAnchorsToReference,
  validateBundledAnchorPayload,
} from './demoAnchorCalibration.js'
import { PROMOTION_STATUS } from './anchorComparison.js'

export { PROMOTION_STATUS as CALIBRATION_READINESS }

const MEASURE_TOLERANCE_RATIO = 0.1
const MEASURE_TOLERANCE_MIN = 2
const PROBLEMATIC_COUNT_DELTA = 2

function applyMeasureCountOverrides(reconciled, overrides, expectedTotal) {
  if (!overrides || !Object.keys(overrides).length) {
    return reconciled
  }

  const suggested = [...reconciled]
  const pinned = new Set()

  for (const [key, value] of Object.entries(overrides)) {
    const index = Number(key)
    const count = Number(value)
    if (Number.isFinite(index) && Number.isFinite(count) && count >= 1) {
      suggested[index] = count
      pinned.add(index)
    }
  }

  const pinnedSum = [...pinned].reduce((sum, index) => sum + suggested[index], 0)
  const flexIndices = suggested.map((_, index) => index).filter((index) => !pinned.has(index))
  const remaining = expectedTotal - pinnedSum

  if (flexIndices.length === 0 || remaining <= 0) {
    return suggested
  }

  const flexWeights = flexIndices.map((index) => reconciled[index] ?? 1)
  const flexCounts = reconcileCountsToTotal(flexWeights, remaining)
  flexIndices.forEach((index, offset) => {
    suggested[index] = flexCounts[offset]
  })

  return suggested
}

function getWrittenMeasureNumbers(timingMap) {
  if (!timingMap?.measures?.length) {
    return []
  }
  return timingMap.measures.map((measure) => measure.number)
}

function sumCounts(counts) {
  return (counts ?? []).reduce((acc, value) => {
    const n = Number(value)
    return acc + (Number.isFinite(n) ? n : 0)
  }, 0)
}

function round3(value) {
  return value == null ? null : Math.round(value * 1000) / 1000
}

/** Heuristic: MusicXML from MIDI conversion often lacks `<print>` breaks. */
export function detectMidiDerivedMusicXml(timingMap) {
  const measures = timingMap?.measures ?? []
  if (!measures.length) {
    return { likely: false, reasons: [] }
  }
  const reasons = []
  const hasSystemBreaks = measures.some((m) => m.systemBreakBefore && m.number !== 1)
  const hasPageBreaks = measures.some((m) => m.pageBreakBefore)
  const hasEngravedWidth = measures.some((m) => Number.isFinite(m.engravedWidth))

  if (!hasSystemBreaks && !hasPageBreaks) {
    reasons.push('MusicXML has no system/page break hints (typical of MIDI-derived timing).')
  }
  if (!hasEngravedWidth) {
    reasons.push('MusicXML has no default-x / engraved-width layout data.')
  }

  return {
    likely: reasons.length > 0,
    reasons,
    hasSystemBreaks,
    hasPageBreaks,
    musicXmlSystemCount: groupMeasuresBySystemBreaks(
      measures.map((m) => m.number),
      timingMap,
    ).length || null,
  }
}

/**
 * Compare PDF detection vs MusicXML timing for edition / source mismatch signals.
 */
export function assessSourceAlignment({
  timingMap,
  systemEntries = [],
  pdfPageCount = null,
  timingSource = null,
  timingSourceKind = null,
  layoutHints = null,
}) {
  const measureNumbers = getWrittenMeasureNumbers(timingMap)
  const expectedMeasures = measureNumbers.length
  const detectedCounts = systemEntries.map((entry) => entry.system?.measureEstimate ?? null)
  const detectedTotal = sumCounts(detectedCounts.filter(Number.isFinite))
  const pdfSystems = systemEntries.length
  const musicXmlStarts = systemStartsFromMusicXml(timingMap)
  const musicXmlPages = pageCountFromMusicXml(timingMap)
  const midiDerived = detectMidiDerivedMusicXml(timingMap)
  const isMidiDerivedKind =
    timingSourceKind === 'midi-derived-musicxml' ||
    (!timingSourceKind && midiDerived.likely && !/\.mxl$/i.test(timingSource ?? ''))
  const isDeclaredRealOrSynthetic =
    timingSourceKind === 'synthetic' ||
    timingSourceKind === 'real-musicxml' ||
    timingSourceKind === 'real-mxl'

  const measureDelta = detectedTotal - expectedMeasures
  const measureTolerance = Math.max(
    MEASURE_TOLERANCE_MIN,
    Math.round(expectedMeasures * MEASURE_TOLERANCE_RATIO),
  )
  const measureCountMismatch =
    Number.isFinite(detectedTotal) &&
    detectedTotal > 0 &&
    Math.abs(measureDelta) > measureTolerance

  const layoutMismatch = detectLayoutMismatch({
    pdfStarts: [],
    musicXmlStarts,
    pdfPageCount,
    musicXmlPageCount: musicXmlPages,
  })

  const musicXmlSystemCount = musicXmlStarts.length || 0

  const issues = []
  const indicators = []

  if (measureCountMismatch) {
    issues.push(
      `PDF barline measure total (${detectedTotal}) differs from written score (${expectedMeasures}) by ${measureDelta > 0 ? '+' : ''}${measureDelta}.`,
    )
    indicators.push('measure-count-mismatch')
  }

  if (
    pdfSystems > 0 &&
    musicXmlSystemCount > 0 &&
    Math.abs(pdfSystems - musicXmlSystemCount) > 1
  ) {
    issues.push(
      `System count: PDF ${pdfSystems} vs MusicXML ${musicXmlSystemCount}.`,
    )
    indicators.push('system-count-mismatch')
  }

  if (
    Number.isFinite(pdfPageCount) &&
    musicXmlPages > 0 &&
    pdfPageCount !== musicXmlPages
  ) {
    issues.push(`Page count: PDF ${pdfPageCount} vs MusicXML ${musicXmlPages}.`)
    indicators.push('page-count-mismatch')
  }

  if (layoutMismatch.mismatch) {
    issues.push(...layoutMismatch.reasons)
    indicators.push('layout-start-mismatch')
  }

  if (isMidiDerivedKind && midiDerived.likely) {
    issues.push(...midiDerived.reasons)
    indicators.push('midi-derived-timing')
  }

  if (timingSource && /\.mid$/i.test(timingSource)) {
    issues.push('Timing loaded from MIDI — verify it matches the PDF edition.')
    indicators.push('midi-timing-source')
  }

  const hintedLayout = layoutHints ?? {
    hasPageBreaks: midiDerived.hasPageBreaks,
    hasSystemBreaks: midiDerived.hasSystemBreaks,
    hasEngravedWidths: (timingMap?.measures ?? []).some((m) =>
      Number.isFinite(m.engravedWidth),
    ),
  }

  const musicXmlHasLayoutHints =
    hintedLayout.hasPageBreaks === true ||
    hintedLayout.hasSystemBreaks === true ||
    hintedLayout.hasEngravedWidths === true ||
    (musicXmlSystemCount > 1 && midiDerived.hasSystemBreaks)

  const midiDerivedLayoutMissing =
    isMidiDerivedKind &&
    !musicXmlHasLayoutHints &&
    (midiDerived.likely || Boolean(timingSource && /\.mid$/i.test(timingSource))) &&
    !isDeclaredRealOrSynthetic

  const pdfLayoutMismatch =
    indicators.includes('page-count-mismatch') ||
    indicators.includes('system-count-mismatch') ||
    indicators.includes('layout-start-mismatch')

  const trueEditionMismatchLikely =
    measureCountMismatch &&
    !midiDerivedLayoutMissing &&
    (Math.abs(measureDelta) > measureTolerance * 2 ||
      (pdfLayoutMismatch && musicXmlHasLayoutHints))

  if (midiDerivedLayoutMissing) {
    indicators.push('midi-derived-layout-missing')
  }
  if (pdfLayoutMismatch) {
    indicators.push('pdf-layout-mismatch')
  }
  if (trueEditionMismatchLikely) {
    indicators.push('true-edition-mismatch')
  }

  const editionConflictLikely =
    measureCountMismatch ||
    indicators.includes('system-count-mismatch') ||
    (isMidiDerivedKind && midiDerived.likely && measureCountMismatch)

  const severity =
    !issues.length
      ? 'none'
      : editionConflictLikely && Math.abs(measureDelta) > measureTolerance * 2
        ? 'severe'
        : editionConflictLikely
          ? 'moderate'
          : 'minor'

  const safeToCalibrate =
    severity === 'none' ||
    (severity === 'moderate' && !measureCountMismatch) ||
    severity === 'minor'

  return {
    expectedMeasures,
    detectedMeasures: detectedTotal,
    measureDelta,
    measureTolerance,
    pdfSystems,
    pdfPages: pdfPageCount,
    musicXmlSystems: musicXmlSystemCount,
    musicXmlPages,
    detectedCounts,
    issues,
    indicators,
    editionConflictLikely,
    trueEditionMismatchLikely,
    midiDerivedLayoutMissing,
    pdfLayoutMismatch,
    musicXmlHasLayoutHints,
    severity,
    safeToCalibrate,
    midiDerived,
    layoutMismatch,
    timingSourceKind: timingSourceKind ?? null,
    layoutHints: hintedLayout,
  }
}

/**
 * Per-system analysis: detected vs suggested counts, weak barlines, corrections.
 */
export function analyzeSystemMeasureCounts({
  systemEntries,
  timingMap,
  detectedCounts = null,
  manualCountOverrides = null,
  manualBarlinesBySystem = null,
}) {
  const expectedTotal = getWrittenMeasureNumbers(timingMap).length
  const rawDetected =
    detectedCounts ??
    systemEntries.map((entry) => entry.system?.measureEstimate ?? null)
  const reconciled = reconcileCountsToTotal(
    rawDetected.map((c) => (Number.isFinite(c) ? c : 1)),
    expectedTotal,
  )

  const overrides = manualCountOverrides ?? {}
  const suggested = applyMeasureCountOverrides(reconciled, overrides, expectedTotal)

  const overrideSum = sumCounts(suggested)
  const countsValid = overrideSum === expectedTotal

  const perSystem = systemEntries.map((entry, systemIndex) => {
    const sys = entry.system ?? {}
    const detected = rawDetected[systemIndex]
    const suggestedCount = suggested[systemIndex]
    const delta = Number.isFinite(detected) ? detected - suggestedCount : null
    const hasManualBarlines = Boolean(
      manualBarlinesBySystem?.[systemIndex] ?? manualBarlinesBySystem?.[String(systemIndex)],
    )
    const hasManualCount =
      overrides[systemIndex] != null || overrides[String(systemIndex)] != null

    let status = 'ok'
    const notes = []

    if (sys.barlineConfident === false) {
      status = 'weak'
      notes.push(sys.barlineReliabilityReason ?? 'unreliable barlines')
    }
    const globalMismatch = Math.abs(sumCounts(rawDetected.filter(Number.isFinite)) - expectedTotal) > 0
    const deltaThreshold = globalMismatch ? 1 : PROBLEMATIC_COUNT_DELTA

    if (Number.isFinite(delta) && Math.abs(delta) >= deltaThreshold) {
      status = status === 'weak' ? 'weak+mismatch' : 'mismatch'
      notes.push(
        delta > 0
          ? `likely ${Math.abs(delta)} extra barline${Math.abs(delta) === 1 ? '' : 's'}`
          : `likely ${Math.abs(delta)} missing barline${Math.abs(delta) === 1 ? '' : 's'}`,
      )
    }
    if (hasManualBarlines) {
      notes.push('manual barlines supplied')
    }
    if (hasManualCount) {
      notes.push('manual count override')
    }

    return {
      systemIndex,
      page: entry.page,
      y: round3(sys.center),
      detectedCount: detected,
      suggestedCount,
      delta,
      barlineCount: sys.barlineCount,
      barlineAccepted: sys.barlineAccepted,
      barlineConfident: sys.barlineConfident,
      barlineReliabilityReason: sys.barlineReliabilityReason,
      barlineConfidenceLevel: sys.barlineConfidenceLevel ?? null,
      barlineRetainedLowConfidence: sys.barlineRetainedLowConfidence ?? 0,
      barlineThinningRemoved: sys.barlineThinningRemoved ?? 0,
      barlineDensityAmbiguous: sys.barlineDensityAmbiguous ?? false,
      barlineRejected: sys.barlineRejected ?? null,
      rejectedSummary: summarizeBarlineDiagnostics({
        rejected: sys.barlineRejected,
        retainedLowConfidence: sys.barlineRetainedLowConfidence,
        thinningRemoved: sys.barlineThinningRemoved,
        densityAmbiguous: sys.barlineDensityAmbiguous,
      }),
      status,
      notes,
      needsReview: status !== 'ok' && !hasManualBarlines && !hasManualCount,
    }
  })

  const problematic = perSystem.filter((s) => s.needsReview)

  return {
    expectedTotal,
    detectedTotal: sumCounts(rawDetected.filter(Number.isFinite)),
    reconciledTotal: sumCounts(reconciled),
    suggestedCounts: suggested,
    suggestedTotal: overrideSum,
    countsValid,
    perSystem,
    problematicSystems: problematic,
    extraBarlineEstimate: Math.max(0, sumCounts(rawDetected.filter(Number.isFinite)) - expectedTotal),
    missingBarlineEstimate: Math.max(0, expectedTotal - sumCounts(rawDetected.filter(Number.isFinite))),
  }
}

/**
 * Hybrid calibration: reconcile counts, apply partial overrides, refuse when unsafe.
 */
export function calibrateAnchorsHybrid({
  systemEntries,
  timingMap,
  pdfPageCount = null,
  timingSource = null,
  timingSourceKind = null,
  layoutHints = null,
  forcedMeasureCounts = null,
  manualCountOverrides = null,
  manualBarlinesBySystem = null,
  allowReconcile = true,
  refuseOnSourceMismatch = true,
}) {
  const source = assessSourceAlignment({
    timingMap,
    systemEntries,
    pdfPageCount,
    timingSource,
    timingSourceKind,
    layoutHints,
  })

  const countAnalysis = analyzeSystemMeasureCounts({
    systemEntries,
    timingMap,
    detectedCounts: forcedMeasureCounts ?? source.detectedCounts,
    manualCountOverrides,
    manualBarlinesBySystem,
  })

  const warnings = [...source.issues]
  const hasManualOverrides =
    manualCountOverrides != null ||
    manualBarlinesBySystem != null ||
    forcedMeasureCounts != null

  if (
    refuseOnSourceMismatch &&
    source.editionConflictLikely &&
    source.indicators.includes('measure-count-mismatch') &&
    !hasManualOverrides
  ) {
    return {
      ok: false,
      refused: true,
      refuseReason: 'source-mismatch',
      source,
      countAnalysis,
      supplemental: [],
      allocationMode: 'refused-source-mismatch',
      warnings: [
        ...warnings,
        'Calibration refused — PDF and timing sources likely disagree (edition mismatch).',
        'Supply --system-counts or --manual-barlines for problematic systems, or verify sources match.',
      ],
    }
  }

  let measureCounts = forcedMeasureCounts
  let allocationMode = 'forced-counts'

  if (!measureCounts) {
    const rawTotal = countAnalysis.detectedTotal
    const expected = countAnalysis.expectedTotal
    const tolerance = source.measureTolerance
    const withinTolerance =
      rawTotal > 0 && Math.abs(rawTotal - expected) <= tolerance

    if (withinTolerance) {
      measureCounts = source.detectedCounts
      allocationMode = 'barline-counts'
    } else if (allowReconcile && countAnalysis.countsValid) {
      measureCounts = countAnalysis.suggestedCounts
      allocationMode = 'hybrid-reconciled'
      warnings.push(
        `Reconciled per-system counts (${rawTotal} detected → ${expected} written). ` +
          `Review ${countAnalysis.problematicSystems.length} system(s) flagged for correction.`,
      )
    } else if (manualCountOverrides && countAnalysis.countsValid) {
      measureCounts = countAnalysis.suggestedCounts
      allocationMode = 'hybrid-manual-counts'
    } else {
      warnings.push(
        'Automatic barline measure counts unavailable or mismatched score — ' +
          'pass --system-counts or --manual-barlines for reliable calibration.',
      )
      return {
        ok: false,
        refused: false,
        source,
        countAnalysis,
        supplemental: [],
        measureCounts: null,
        allocationMode: 'unusable-auto-counts',
        warnings,
      }
    }
  } else if (sumCounts(measureCounts) !== countAnalysis.expectedTotal) {
    warnings.push(
      `Forced measure counts sum to ${sumCounts(measureCounts)} ` +
        `but score has ${countAnalysis.expectedTotal} measures.`,
    )
    if (!allowReconcile) {
      return {
        ok: false,
        refused: false,
        source,
        countAnalysis,
        supplemental: [],
        measureCounts,
        allocationMode: 'forced-count-mismatch',
        warnings,
      }
    }
    measureCounts = reconcileCountsToTotal(measureCounts, countAnalysis.expectedTotal)
    allocationMode = 'forced-reconciled'
    warnings.push('Forced counts reconciled to written measure total.')
  }

  const base = calibrateAnchorsFromDetection({
    systemEntries,
    timingMap,
    forcedMeasureCounts: measureCounts,
    manualBarlinesBySystem,
  })

  return {
    ...base,
    refused: false,
    source,
    countAnalysis,
    allocationMode: manualBarlinesBySystem
      ? `${allocationMode}+manual-barlines`
      : allocationMode,
    warnings: [...warnings, ...base.warnings],
  }
}

/** Full calibration diagnostics report. */
export function buildCalibrationDiagnostics({
  calibrationResult,
  setup = null,
  referencePayload = null,
  payload = null,
  timingSourceKind = null,
  layoutHints = null,
  timingMeta = null,
}) {
  const source = calibrationResult.source ?? {}
  const countAnalysis = calibrationResult.countAnalysis ?? {}
  const expectedMeasures = source.expectedMeasures ?? countAnalysis.expectedTotal ?? 0
  const detectedMeasures = source.detectedMeasures ?? countAnalysis.detectedTotal ?? 0

  let referenceReadiness = null
  let comparison = null
  if (payload && referencePayload) {
    const ref = compareBundledAnchorsToReference(payload, referencePayload)
    referenceReadiness = ref.readiness
    comparison = ref.comparison
  }

  const structural = payload ? validateBundledAnchorPayload(payload) : null

  const weakSystems = (countAnalysis.perSystem ?? []).filter(
    (s) => s.status === 'weak' || s.status === 'weak+mismatch',
  )
  const mismatchSystems = (countAnalysis.problematicSystems ?? []).map((s) => s.systemIndex)

  const readiness = assessCalibrationReadiness({
    calibrationResult,
    structural,
    referenceReadiness,
    comparison,
  })

  return {
    pieceId: payload?.pieceId ?? null,
    expectedMeasures,
    detectedMeasures,
    measureDelta: source.measureDelta ?? detectedMeasures - expectedMeasures,
    anchorCount: calibrationResult.supplemental?.length ?? payload?.anchors?.length ?? 0,
    allocationMode: calibrationResult.allocationMode,
    calibrationOk: calibrationResult.ok === true,
    refused: calibrationResult.refused === true,
    refuseReason: calibrationResult.refuseReason ?? null,
    source: {
      severity: source.severity ?? 'unknown',
      editionConflictLikely: source.editionConflictLikely ?? false,
      trueEditionMismatchLikely: source.trueEditionMismatchLikely ?? false,
      midiDerivedLayoutMissing: source.midiDerivedLayoutMissing ?? false,
      pdfLayoutMismatch: source.pdfLayoutMismatch ?? false,
      musicXmlHasLayoutHints: source.musicXmlHasLayoutHints ?? false,
      timingSourceKind: timingSourceKind ?? source.timingSourceKind ?? timingMeta?.kind ?? null,
      layoutHints: layoutHints ?? source.layoutHints ?? null,
      timingMeta: timingMeta ?? null,
      safeToCalibrate: source.safeToCalibrate ?? null,
      indicators: source.indicators ?? [],
      issues: source.issues ?? [],
      pdfSystems: source.pdfSystems,
      pdfPages: source.pdfPages,
      musicXmlSystems: source.musicXmlSystems,
      musicXmlPages: source.musicXmlPages,
    },
    systems: {
      total: source.pdfSystems ?? countAnalysis.perSystem?.length ?? 0,
      weak: weakSystems.length,
      mismatch: mismatchSystems.length,
      mismatchIndices: mismatchSystems,
      extraBarlineEstimate: countAnalysis.extraBarlineEstimate ?? 0,
      missingBarlineEstimate: countAnalysis.missingBarlineEstimate ?? 0,
      perSystem: countAnalysis.perSystem ?? [],
      suggestedCounts: countAnalysis.suggestedCounts ?? [],
    },
    setup: setup
      ? {
          stage: setup.preview?.stage ?? null,
          confidence: setup.preview?.confidence ?? null,
        }
      : null,
    structural: structural ? { ok: structural.ok, reason: structural.reason ?? null } : null,
    reference: comparison
      ? {
          maxError: comparison.maxError,
          avgError: comparison.avgError,
          measuresCompared: comparison.measuresCompared,
        }
      : null,
    readiness,
    warnings: calibrationResult.warnings ?? [],
  }
}

/** Map calibration state to READY / NEEDS_REVIEW / NOT_SAFE with reasons. */
export function assessCalibrationReadiness({
  calibrationResult,
  structural = null,
  referenceReadiness = null,
  comparison = null,
}) {
  const reasons = []

  if (calibrationResult?.refused) {
    return {
      status: PROMOTION_STATUS.NOT_SAFE,
      label: 'Not safe to calibrate',
      reasons: calibrationResult.warnings ?? ['Source mismatch — calibration refused.'],
    }
  }

  if (!calibrationResult?.ok) {
    reasons.push('Calibration incomplete — missing measure anchors.')
    if (calibrationResult?.allocationMode === 'unusable-auto-counts') {
      reasons.push('Barline counts could not be reconciled to the written score.')
    }
    return {
      status: PROMOTION_STATUS.NOT_SAFE,
      label: 'Not safe to calibrate',
      reasons,
    }
  }

  if (structural && !structural.ok) {
    reasons.push(`Structural validation failed (${structural.reason}).`)
    return {
      status: PROMOTION_STATUS.NOT_SAFE,
      label: 'Not safe to calibrate',
      reasons,
    }
  }

  const source = calibrationResult.source ?? {}
  const problematic = calibrationResult.countAnalysis?.problematicSystems?.length ?? 0
  const mode = calibrationResult.allocationMode ?? ''

  if (source.editionConflictLikely) {
    reasons.push('PDF vs timing edition conflict detected.')
  }
  if (problematic > 0 && !mode.includes('manual')) {
    reasons.push(`${problematic} system(s) still need manual count or barline correction.`)
  }
  if (mode.includes('reconciled') || mode.includes('hybrid')) {
    reasons.push('Per-system counts were reconciled — verify flagged systems.')
  }

  if (referenceReadiness) {
    if (referenceReadiness.status === PROMOTION_STATUS.READY) {
      return {
        status: PROMOTION_STATUS.READY,
        label: 'Ready for demo bundling',
        reasons: reasons.length ? reasons : ['Geometry matches reference within tolerance.'],
      }
    }
    if (referenceReadiness.status === PROMOTION_STATUS.NEEDS_REVIEW) {
      reasons.push(...(referenceReadiness.reasons ?? []))
      return {
        status: PROMOTION_STATUS.NEEDS_REVIEW,
        label: 'Needs review before bundling',
        reasons,
      }
    }
    reasons.push(...(referenceReadiness.reasons ?? ['Reference comparison NOT_SAFE.']))
    if (comparison?.maxError != null) {
      reasons.push(`Max geometry error ${comparison.maxError.toFixed(4)} exceeds READY tolerance.`)
    }
    return {
      status: PROMOTION_STATUS.NOT_SAFE,
      label: 'Not safe to calibrate',
      reasons,
    }
  }

  if (reasons.length === 0 && mode === 'barline-counts') {
    return {
      status: PROMOTION_STATUS.READY,
      label: 'Ready for demo bundling',
      reasons: ['Barline counts match written score; no flagged systems.'],
    }
  }

  if (reasons.length > 0 && calibrationResult.ok) {
    return {
      status: PROMOTION_STATUS.NEEDS_REVIEW,
      label: 'Needs review before bundling',
      reasons,
    }
  }

  return {
    status: PROMOTION_STATUS.READY,
    label: 'Ready for demo bundling',
    reasons: ['Calibration produced full measure coverage.'],
  }
}

export function formatCalibrationDiagnosticsText(report) {
  const lines = [
    '=== Calibration diagnostics ===',
    `Readiness: ${report.readiness?.status?.toUpperCase() ?? 'UNKNOWN'} — ${report.readiness?.label ?? ''}`,
  ]

  if (report.readiness?.reasons?.length) {
    report.readiness.reasons.forEach((r) => lines.push(`  · ${r}`))
  }

  lines.push(
    '',
    `Measures: expected ${report.expectedMeasures} | PDF detected ${report.detectedMeasures} ` +
      `(Δ ${report.measureDelta >= 0 ? '+' : ''}${report.measureDelta ?? 0})`,
    `Anchors: ${report.anchorCount} | mode: ${report.allocationMode ?? '—'}`,
  )

  if (report.refused) {
    lines.push(`REFUSED: ${report.refuseReason ?? 'unsafe'}`)
  }

  if (report.source?.indicators?.length) {
    lines.push('', 'Source indicators:')
    report.source.indicators.forEach((i) => lines.push(`  - ${i}`))
  }
  if (report.source?.issues?.length) {
    lines.push('', 'Source issues:')
    report.source.issues.forEach((i) => lines.push(`  - ${i}`))
  }

  lines.push(
    '',
    `Systems: ${report.systems?.total ?? 0} total | ` +
      `${report.systems?.weak ?? 0} weak | ${report.systems?.mismatch ?? 0} need correction`,
  )

  if (report.systems?.suggestedCounts?.length) {
    lines.push(`Suggested counts: ${report.systems.suggestedCounts.join(',')}`)
  }

  const flagged = (report.systems?.perSystem ?? []).filter((s) => s.needsReview)
  if (flagged.length) {
    lines.push('', 'Systems needing correction:')
    flagged.slice(0, 12).forEach((s) => {
      lines.push(
        `  sys${s.systemIndex} p${s.page} y≈${s.y}: detected ${s.detectedCount} → ` +
          `suggested ${s.suggestedCount} (${s.notes.join('; ')})`,
      )
    })
    if (flagged.length > 12) {
      lines.push(`  … and ${flagged.length - 12} more`)
    }
  }

  if (report.reference) {
    lines.push(
      '',
      `Reference comparison: max ${report.reference.maxError.toFixed(4)} | ` +
        `avg ${report.reference.avgError.toFixed(4)} (${report.reference.measuresCompared} measures)`,
    )
  }

  if (report.warnings?.length) {
    lines.push('', `Warnings (${report.warnings.length}):`)
    report.warnings.slice(0, 8).forEach((w) => lines.push(`  - ${w}`))
  }

  return lines.join('\n')
}

export function serializeCalibrationDiagnostics(report) {
  return JSON.stringify(report, null, 2)
}

/** End-to-end hybrid pipeline helper for scripts/tests. */
export function buildHybridBundledPayload(calibrationResult, meta = {}) {
  return buildBundledAnchorsFromAutoAnchors(calibrationResult.supplemental, {
    ...meta,
    warnings: calibrationResult.warnings,
    calibrated: meta.calibrated ?? 'hybrid-calibration',
  })
}
