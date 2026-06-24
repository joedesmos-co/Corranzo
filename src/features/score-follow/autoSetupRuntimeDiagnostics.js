/**
 * Browser/runtime diagnostics for semi-auto score setup — why a result was
 * accepted, rejected, or never applied.
 */
export function describeAutoSetupRejection(result, preview) {
  if (!result?.ok) {
    return {
      code: result?.noSystems ? 'no-systems' : 'analysis-failed',
      detail: result?.message ?? 'Auto setup could not analyze the PDF.',
    }
  }
  if (!preview) {
    return { code: 'no-preview', detail: 'Analysis returned no preview.' }
  }
  if ((preview.proposedAnchors?.length ?? 0) < 2) {
    return {
      code: 'too-few-anchors',
      detail: `Only ${preview.proposedAnchors?.length ?? 0} anchor(s) proposed.`,
    }
  }
  if (preview.plausible) {
    return null
  }

  const reasons = []
  if (
    Number.isFinite(preview.expectedSystemCount) &&
    preview.expectedSystemCount >= 1 &&
    Math.abs((preview.systemCount ?? 0) - preview.expectedSystemCount) > 1 &&
    !preview.reconciled
  ) {
    reasons.push(
      `system-count-mismatch (detected ${preview.systemCount}, expected ${preview.expectedSystemCount})`,
    )
  }
  const firstAnchor = preview.proposedAnchors
    ?.slice()
    .sort((a, b) => a.y - b.y)[0]
  if (firstAnchor != null && firstAnchor.y < 0.08) {
    reasons.push('measure-one-in-header')
  }
  if (preview.validationMessage) {
    reasons.push(preview.validationMessage)
  }
  if (preview.lowConfidence) {
    reasons.push(`low-confidence (${preview.confidence})`)
  }

  return {
    code: 'implausible-mapping',
    detail: reasons.length > 0 ? reasons.join('; ') : 'Mapping failed plausibility checks.',
  }
}

export function summarizePerSystemAllocation(preview) {
  const systems = preview?.debugReport?.systems ?? preview?.spans?.map((span, index) => {
    const entry = preview?.systemEntries?.[index]
    return {
      index,
      page: entry?.page ?? null,
      measureStart: span.measureStart,
      measureEnd: span.measureEnd,
      measureCount: span.measuresInSpan,
    }
  })
  if (!systems?.length) {
    return []
  }
  return systems.map((system) => ({
    index: system.index,
    page: system.page,
    measureStart: system.measureStart ?? null,
    measureEnd: system.measureEnd ?? null,
    measureCount: system.measureCount ?? null,
  }))
}

export function buildAutoSetupRuntimeDiagnostics({
  result,
  preview,
  timingMap,
  numPages,
  setupStatus,
  semiAutoSetup,
  autoSetupAttempted,
  uiNeedsQuickSetupReason = null,
}) {
  const rejection = describeAutoSetupRejection(result, preview)
  const needsQuickSetupReason =
    uiNeedsQuickSetupReason ??
    (rejection ? `${rejection.code}: ${rejection.detail}` : null)

  return {
    at: new Date().toISOString(),
    setupStatusPhase: setupStatus?.phase ?? null,
    semiAutoSetupStatus: semiAutoSetup?.status ?? null,
    setupError: semiAutoSetup?.error ?? null,
    analysisOk: Boolean(result?.ok),
    noSystems: Boolean(result?.noSystems),
    detectedSystemCount: preview?.systemCount ?? preview?.debugReport?.detectedSystemCount ?? null,
    expectedSystemCount: preview?.expectedSystemCount ?? preview?.debugReport?.expectedSystemCount ?? null,
    musicXmlSystemCount: preview?.systemCountHint ?? preview?.debugReport?.systemCountHint ?? null,
    proposedAnchorCount: preview?.proposedAnchors?.length ?? null,
    plausible: preview?.plausible ?? null,
    reconciled: preview?.reconciled ?? null,
    confidence: preview?.confidence ?? null,
    allocationMode: preview?.allocationMode ?? preview?.debugReport?.allocationMode ?? null,
    stage: preview?.stage ?? preview?.debugReport?.stage ?? null,
    layoutConfidenceLevel:
      preview?.layoutConfidence?.level ?? preview?.debugReport?.layoutConfidence ?? null,
    layoutConfidenceReasons:
      preview?.layoutConfidence?.reasons ?? preview?.debugReport?.layoutConfidenceReasons ?? [],
    layoutMismatch: preview?.layoutMismatch?.mismatch ?? preview?.debugReport?.layoutMismatch ?? null,
    layoutMismatchReasons:
      preview?.layoutMismatch?.reasons ?? preview?.debugReport?.layoutMismatchReasons ?? [],
    validationOk: preview?.validationMessage == null,
    validationMessage: preview?.validationMessage ?? null,
    timingMeasureCount: timingMap?.measures?.length ?? null,
    pdfPageCount: numPages ?? null,
    perSystemAllocation: summarizePerSystemAllocation(preview),
    rejectionCode: rejection?.code ?? null,
    rejectionDetail: rejection?.detail ?? null,
    needsQuickSetupReason,
    autoSetupAttempted,
  }
}
