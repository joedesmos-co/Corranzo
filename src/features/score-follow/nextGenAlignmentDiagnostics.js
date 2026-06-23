/**
 * Next-generation automatic score alignment — Phase 4 diagnostics derivation.
 *
 * Turns the EXISTING runtime auto-setup debug report (`preview.debugReport`,
 * surfaced as `scoreFollow.debug.autoSetup`) + the parsed timing map into a
 * single, display-ready next-gen diagnostics view-model by reusing the Phase
 * 1–3 pure modules:
 *   - reconcilePdfLayoutWithScore   (Phase 1)
 *   - buildAlignmentReport / decideFollowAction / formatModelSummary (Phase 1/2)
 *   - generateAnchorsFromLayout     (Phase 3, anchor coverage + candidates)
 *
 * This module is PURE and **display-only**. It computes nothing the live cursor
 * consumes: the candidate anchors it returns are tagged `meta.candidate = true`
 * and `provenance = 'nextgen-candidate'` so they can never be confused with the
 * real anchors that drive the cursor. Phase 4 surfaces this behind a flag; it
 * does not change auto-setup, manual setup, or bundled demo anchors.
 */
import { reconcilePdfLayoutWithScore } from './alignmentReconciliation.js'
import {
  buildAlignmentReport,
  formatModelSummary,
} from './alignmentReport.js'
import { generateAnchorsFromLayout } from './generateAnchorsFromLayout.js'

const UNAVAILABLE = Object.freeze({ available: false })

/** Per-system barline counts from the auto-setup report (detected when known). */
function perSystemBarlineCounts(systems) {
  const counts = systems.map((s) =>
    Number.isFinite(s.barlineCount) ? s.barlineCount : null,
  )
  // Detected barline counts are only trustworthy when every system reported one.
  if (counts.every((c) => Number.isFinite(c))) {
    return { counts, source: 'detected-barlines' }
  }
  // Otherwise fall back to the allocated measure counts (the mapping the
  // cursor already uses), so coverage still reflects the real allocation.
  return {
    counts: systems.map((s) => (Number.isFinite(s.measureCount) ? s.measureCount : 0)),
    source: 'allocated-measures',
  }
}

/** Page-layout geometry for anchor generation, reconstructed from the report. */
function pageLayoutFromReport(systems, layoutConfidence, pageCount) {
  return {
    pageCount,
    layoutConfidence,
    systems: systems.map((s, index) => ({
      systemIndex: Number.isFinite(s.index) ? s.index : index,
      page: s.page ?? 1,
      y: Number.isFinite(s.center) ? s.center : null,
      startX: Number.isFinite(s.firstAnchorX) ? s.firstAnchorX : null,
      endX: Number.isFinite(s.lastAnchorX) ? s.lastAnchorX : null,
      // Detected barline x-positions are not retained in the report → the
      // generator estimates even spacing (sufficient for coverage diagnostics).
      barlineXs: [],
    })),
  }
}

export const NEXTGEN_CANDIDATE_SOURCE = 'nextgen-candidate'

/**
 * Tag generated anchors as display-only candidates that can NEVER drive the
 * cursor. Belt-and-suspenders: the `source` is deliberately set to a value
 * outside `ANCHOR_SOURCE`, so `filterTrustedAnchors` rejects it even if a
 * candidate ever leaked into the live anchor list. The original generator
 * source is preserved in `meta.generatedSource` for diagnostics.
 */
function asCandidates(anchors) {
  return anchors.map((anchor) => ({
    ...anchor,
    id: `nextgen-candidate-${anchor.measureNumber}`,
    source: NEXTGEN_CANDIDATE_SOURCE,
    provenance: NEXTGEN_CANDIDATE_SOURCE,
    meta: {
      ...(anchor.meta ?? {}),
      candidate: true,
      generatedSource: anchor.source ?? null,
    },
  }))
}

function describePageSystem(flags) {
  const reasons = flags?.layoutMismatchReasons ?? []
  const mismatch = Boolean(
    flags?.systemCountMismatch || flags?.pageCountMismatch || flags?.layoutMismatch,
  )
  return {
    mismatch,
    reasons,
    label: mismatch ? (reasons.length ? reasons.join('; ') : 'mismatch') : 'aligned',
  }
}

/**
 * @param {object} params
 * @param {object} params.timingMap        parsed MusicXML timing map
 * @param {object|null} params.autoSetupReport  `scoreFollow.debug.autoSetup`
 * @returns {{ available: boolean, ... }}
 */
export function deriveNextGenAlignmentDiagnostics({ timingMap, autoSetupReport } = {}) {
  if (!timingMap?.measures?.length || !autoSetupReport) {
    return UNAVAILABLE
  }
  const systems = Array.isArray(autoSetupReport.systems) ? autoSetupReport.systems : []
  if (systems.length === 0) {
    return UNAVAILABLE
  }

  const { counts, source } = perSystemBarlineCounts(systems)
  const pageCount =
    autoSetupReport.perPage?.length ||
    systems.reduce((max, s) => Math.max(max, s.page ?? 1), 1)
  const layoutConfidence = autoSetupReport.layoutConfidence ?? null

  const systemEntries = systems.map((s) => ({ page: s.page ?? null }))
  const reconciliation = reconcilePdfLayoutWithScore({
    timingMap,
    perSystemBarlineCounts: counts,
    systemEntries,
    pdfPageCount: pageCount,
  })

  const report = buildAlignmentReport({
    reconciliation,
    timingMap,
    layoutConfidence,
  })

  const pageLayout = pageLayoutFromReport(systems, layoutConfidence, pageCount)
  const generated = generateAnchorsFromLayout(reconciliation, pageLayout)

  return {
    available: true,
    perSystemSource: source,
    decision: report.decision,
    layoutConfidence: report.layoutConfidence,
    layoutConfidenceLabel: report.layoutConfidenceLabel,
    totals: report.totals,
    trust: generated.trust,
    coverage: generated.coverage,
    model: formatModelSummary(report),
    pageSystem: describePageSystem(reconciliation.flags),
    warnings: report.warnings,
    // Display-only: candidate anchors for the debug overlay. NEVER fed to the
    // cursor — tagged `meta.candidate` + `provenance: 'nextgen-candidate'`.
    candidateAnchors: asCandidates(generated.anchors),
  }
}
