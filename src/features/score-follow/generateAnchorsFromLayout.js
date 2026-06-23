/**
 * Next-gen automatic score alignment — Phase 3: unified anchor generation.
 *
 * `generateAnchorsFromLayout(reconciliation, pageLayout)` assembles per-measure
 * score-follow anchors from:
 *   - the reconciliation result (which measures belong to which system + the
 *     per-system confidence), and
 *   - the detected page layout geometry (per-system barline x-positions, y, and
 *     right edge).
 *
 * This generalises the hand-calibration in `scripts/generate-demo-anchors.mjs`
 * (`playableEndX = nextMeasure.x ?? systemEndX`) into a data-driven generator.
 *
 * It is **additive and not wired into the live cursor** (Phase 3). Output is for
 * tests + diagnostics only. Generation is gated by confidence so it can never
 * silently produce a trusted-but-wrong layout:
 *   - auto    → anchors marked `trusted`
 *   - confirm → anchors marked `confirm-required`
 *   - manual  → no anchors (manual setup required)
 *
 * Reuses: alignmentConfidencePolicy (decideFollowAction), allocateMeasuresToSystems
 * (allocateSpansByCounts), anchorUtils (ANCHOR_SOURCE). Does not duplicate the
 * detection/reconciliation pipeline.
 */
import { decideFollowAction, FOLLOW_ACTION } from './alignmentConfidencePolicy.js'
import { allocateSpansByCounts } from './allocateMeasuresToSystems.js'
import { ANCHOR_SOURCE } from './anchorUtils.js'

export const ANCHOR_TRUST = {
  TRUSTED: 'trusted',
  CONFIRM_REQUIRED: 'confirm-required',
  MANUAL: 'manual',
}

export const ANCHOR_GENERATOR = 'auto-layout-v1'

const ACTION_TO_TRUST = {
  [FOLLOW_ACTION.AUTO]: ANCHOR_TRUST.TRUSTED,
  [FOLLOW_ACTION.CONFIRM]: ANCHOR_TRUST.CONFIRM_REQUIRED,
  [FOLLOW_ACTION.MANUAL]: ANCHOR_TRUST.MANUAL,
}

/**
 * @param {object} reconciliation  result of reconcilePdfLayoutWithScore
 * @param {object} pageLayout
 *   @param {number} [pageLayout.pageCount]
 *   @param {string|null} [pageLayout.layoutConfidence] LAYOUT_CONFIDENCE.*
 *   @param {Array} pageLayout.systems  [{ systemIndex, page, y, startX, endX, barlineXs[] }]
 * @returns {{ trust, action, anchors[], coverage }}
 */
export function generateAnchorsFromLayout(reconciliation, pageLayout = {}) {
  const decision = decideFollowAction({
    layoutConfidence: pageLayout.layoutConfidence ?? null,
    reconciliation,
  })
  const trust = ACTION_TO_TRUST[decision.action] ?? ANCHOR_TRUST.MANUAL

  const measureCount = reconciliation?.totals?.expectedMeasureCount ?? 0
  const firstMeasure = reconciliation?.score?.firstMeasureNumber ?? 1
  const measureNumbers = Array.from({ length: measureCount }, (_, i) => firstMeasure + i)

  // Low confidence → no trusted anchors; require manual setup (never guess).
  if (trust === ANCHOR_TRUST.MANUAL) {
    return {
      trust,
      action: decision.action,
      reasons: decision.reasons,
      anchors: [],
      coverage: buildCoverage([], measureNumbers, reconciliation, [], trust),
    }
  }

  const systems = pageLayout.systems ?? []
  const perSystemCounts = reconciliation.perSystem.map((s) => s.expectedMeasures)
  const systemEntries = systems.map((s) => ({ page: s.page }))
  const spans = allocateSpansByCounts(systemEntries, measureNumbers, perSystemCounts)

  const anchors = []
  const estimatedGeometrySystems = []

  spans.forEach((span, systemIndex) => {
    const system = systems[systemIndex]
    if (!system) {
      return
    }
    const numbers = span.measureNumbers
    const barlineXs = Array.isArray(system.barlineXs) ? system.barlineXs : []
    const useDetected = barlineXs.length >= numbers.length && numbers.length > 0
    if (!useDetected) {
      estimatedGeometrySystems.push(systemIndex)
    }
    const confidence = reconciliation.perSystem[systemIndex]?.confidence ?? 0
    const systemEndX = Number.isFinite(system.endX) ? system.endX : 1

    for (let j = 0; j < numbers.length; j += 1) {
      const measureNumber = numbers[j]
      let measureStartX
      let playableEndX
      if (useDetected) {
        measureStartX = barlineXs[j]
        playableEndX = j + 1 < numbers.length ? barlineXs[j + 1] : systemEndX
      } else {
        // No usable barline geometry — space measures evenly across the system.
        const startX = Number.isFinite(system.startX) ? system.startX : 0
        const widthPer = (systemEndX - startX) / numbers.length
        measureStartX = startX + widthPer * j
        playableEndX = startX + widthPer * (j + 1)
      }
      const geometry = useDetected ? 'detected' : 'estimated'
      anchors.push({
        id: `gen-m${measureNumber}`,
        measureNumber,
        page: system.page,
        systemIndex,
        x: measureStartX,
        y: system.y,
        measureStartX,
        playableStartX: measureStartX,
        playableEndX,
        systemEndX,
        confidence,
        source: ANCHOR_SOURCE.AUTO_MEASURE,
        trust,
        geometry,
        meta: {
          role: 'measure',
          systemIndex,
          generator: ANCHOR_GENERATOR,
          geometry,
          measureStartX,
          playableStartX: measureStartX,
          playableEndX,
          systemEndX,
        },
      })
    }
  })

  anchors.sort((a, b) => a.measureNumber - b.measureNumber)

  return {
    trust,
    action: decision.action,
    reasons: decision.reasons,
    anchors,
    coverage: buildCoverage(anchors, measureNumbers, reconciliation, estimatedGeometrySystems, trust),
  }
}

/** Anchor-coverage diagnostics: counts, missing measures, weak systems, confidence. */
function buildCoverage(anchors, measureNumbers, reconciliation, estimatedGeometrySystems, trust) {
  const covered = new Set(anchors.map((a) => a.measureNumber))
  const missingMeasures = measureNumbers.filter((m) => !covered.has(m))
  return {
    trust,
    anchorsGenerated: anchors.length,
    measuresExpected: measureNumbers.length,
    measuresCovered: covered.size,
    missingMeasures,
    weakSystems: reconciliation?.flags?.weakSystems ?? [],
    estimatedGeometrySystems,
    meanConfidence: reconciliation?.totals?.meanConfidence ?? 0,
    minConfidence: reconciliation?.totals?.minConfidence ?? 0,
  }
}
