/**
 * Page-local staff line gap normalization for outlier systems (e.g. final-page drift).
 * Re-spaces five lines per staff from measured stave bounds using a reference gap.
 */

import { staffLineGap } from './pitchFromStaffPosition.js'

export const STAFF_GAP_DEVIATION_THRESHOLD = 0.15
export const MIN_DOCUMENT_GAP_SAMPLES = 3

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (!sorted.length) {
    return null
  }
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function gapDeviationRatio(detected, reference) {
  if (!Number.isFinite(detected) || detected <= 0 || !Number.isFinite(reference) || reference <= 0) {
    return 0
  }
  return Math.abs(detected - reference) / reference
}

function measuredStaves(system) {
  return Array.isArray(system?.staves)
    ? system.staves
        .filter((stave) => Number.isFinite(stave?.y0) && Number.isFinite(stave?.y1))
        .sort((left, right) => left.y0 - right.y0)
    : []
}

function staveBoundsForRole(system, staffLines, role) {
  const staves = measuredStaves(system)
  if (staves.length >= 2) {
    return role === 'treble' ? staves[0] : staves[1]
  }
  const lines = role === 'treble' ? staffLines?.treble : staffLines?.bass
  if (!Array.isArray(lines) || lines.length < 5) {
    return null
  }
  const sorted = [...lines].sort((left, right) => left - right)
  return { y0: sorted[0], y1: sorted[sorted.length - 1] }
}

/**
 * Re-space five staff lines from the measured stave top using a target gap.
 */
export function respaceStaffLinesFromStaveTop(staveY0, targetGap) {
  if (!Number.isFinite(staveY0) || !Number.isFinite(targetGap) || targetGap <= 0) {
    return null
  }
  return [0, 1, 2, 3, 4].map((index) => staveY0 + index * targetGap)
}

export function gapsFromStaffLines(staffLines) {
  if (!staffLines) {
    return { treble: null, bass: null }
  }
  return {
    treble: staffLineGap(staffLines.treble ?? []),
    bass: staffLineGap(staffLines.bass ?? []),
  }
}

/**
 * @param {{ treble?: number[], bass?: number[] }} samples
 */
export function computeDocumentStaffGapReference(samples) {
  const trebleMedian = median(samples?.treble ?? [])
  const bassMedian = median(samples?.bass ?? [])
  const combined = median([...(samples?.treble ?? []), ...(samples?.bass ?? [])])
  return {
    treble: trebleMedian ?? combined,
    bass: bassMedian ?? combined,
    combined,
    sampleCount: {
      treble: samples?.treble?.length ?? 0,
      bass: samples?.bass?.length ?? 0,
    },
  }
}

export function mergeStaffGapSamples(target, addition) {
  const next = {
    treble: [...(target?.treble ?? [])],
    bass: [...(target?.bass ?? [])],
  }
  for (const value of addition?.treble ?? []) {
    if (Number.isFinite(value) && value > 0) {
      next.treble.push(value)
    }
  }
  for (const value of addition?.bass ?? []) {
    if (Number.isFinite(value) && value > 0) {
      next.bass.push(value)
    }
  }
  return next
}

function referenceGapForRole(reference, role) {
  if (role === 'treble') {
    return reference?.treble ?? reference?.combined ?? null
  }
  return reference?.bass ?? reference?.combined ?? null
}

function normalizeStaffLinesForSystem(staffLines, system, reference, deviationThreshold) {
  if (!staffLines || !reference?.combined) {
    return { staffLines, changed: false, details: null }
  }

  const detected = gapsFromStaffLines(staffLines)
  const changes = []
  const nextLines = { ...staffLines, treble: [...(staffLines.treble ?? [])], bass: [...(staffLines.bass ?? [])] }

  for (const role of ['treble', 'bass']) {
    const detectedGap = role === 'treble' ? detected.treble : detected.bass
    const targetGap = referenceGapForRole(reference, role)
    if (
      !Number.isFinite(detectedGap) ||
      detectedGap <= 0 ||
      !Number.isFinite(targetGap) ||
      targetGap <= 0 ||
      gapDeviationRatio(detectedGap, targetGap) <= deviationThreshold
    ) {
      continue
    }

    const stave = staveBoundsForRole(system, staffLines, role)
    if (!stave) {
      continue
    }

    const respaced = respaceStaffLinesFromStaveTop(stave.y0, targetGap)
    if (!respaced) {
      continue
    }

    if (role === 'treble') {
      nextLines.treble = respaced
    } else {
      nextLines.bass = respaced
    }
    changes.push({
      role,
      originalGap: Number(detectedGap.toFixed(6)),
      normalizedGap: Number(targetGap.toFixed(6)),
      deviationRatio: Number(gapDeviationRatio(detectedGap, targetGap).toFixed(4)),
    })
  }

  if (!changes.length) {
    return { staffLines, changed: false, details: null }
  }

  const trebleBottom = nextLines.treble?.[nextLines.treble.length - 1]
  const bassTop = nextLines.bass?.[0]
  if (Number.isFinite(trebleBottom) && Number.isFinite(bassTop)) {
    nextLines.splitY = (trebleBottom + bassTop) / 2
  }

  return {
    staffLines: nextLines,
    changed: true,
    details: changes,
  }
}

/**
 * Normalize outlier staff gaps on a page before pitch mapping.
 *
 * @param {object} params
 * @param {Array<Array<object>>} params.systemMeasureBoxes
 * @param {object[]} params.systems
 * @param {number} params.page
 * @param {object|null} params.documentGapReference
 * @param {number} [params.deviationThreshold]
 * @param {number} [params.minReferenceSamples]
 */
export function normalizePageStaffLineGaps({
  systemMeasureBoxes,
  systems,
  page,
  documentGapReference = null,
  deviationThreshold = STAFF_GAP_DEVIATION_THRESHOLD,
  minReferenceSamples = MIN_DOCUMENT_GAP_SAMPLES,
}) {
  const totalSamples =
    (documentGapReference?.sampleCount?.treble ?? 0) +
    (documentGapReference?.sampleCount?.bass ?? 0)
  const canNormalize =
    documentGapReference?.combined != null && totalSamples >= minReferenceSamples

  const systemsAffected = []
  const gapSamples = { treble: [], bass: [] }

  for (let systemIndex = 0; systemIndex < systemMeasureBoxes.length; systemIndex += 1) {
    const measureBoxes = systemMeasureBoxes[systemIndex] ?? []
    const system = systems[systemIndex]
    if (!measureBoxes.length || !system) {
      continue
    }

    const staffLines = measureBoxes[0].staffLines
    const detected = gapsFromStaffLines(staffLines)
    const staves = measuredStaves(system)

    const trebleOutlier =
      canNormalize &&
      gapDeviationRatio(detected.treble, referenceGapForRole(documentGapReference, 'treble')) >
        deviationThreshold
    const bassOutlier =
      canNormalize &&
      gapDeviationRatio(detected.bass, referenceGapForRole(documentGapReference, 'bass')) >
        deviationThreshold

    let normalized = staffLines
    let systemDetails = null

    if (canNormalize && (trebleOutlier || bassOutlier) && staves.length >= 2) {
      const result = normalizeStaffLinesForSystem(
        staffLines,
        system,
        documentGapReference,
        deviationThreshold,
      )
      normalized = result.staffLines
      if (result.changed) {
        systemDetails = {
          page,
          systemIndex,
          originalGaps: {
            treble: detected.treble != null ? Number(detected.treble.toFixed(6)) : null,
            bass: detected.bass != null ? Number(detected.bass.toFixed(6)) : null,
          },
          normalizedGaps: {
            treble: Number(staffLineGap(normalized.treble).toFixed(6)),
            bass: Number(staffLineGap(normalized.bass).toFixed(6)),
          },
          referenceGaps: {
            treble: documentGapReference.treble != null
              ? Number(documentGapReference.treble.toFixed(6))
              : null,
            bass: documentGapReference.bass != null
              ? Number(documentGapReference.bass.toFixed(6))
              : null,
          },
          staffChanges: result.details,
        }
        systemsAffected.push(systemDetails)
        for (const box of measureBoxes) {
          box.staffLines = normalized
        }
      }
    }

    if (staves.length >= 2) {
      const finalGaps = gapsFromStaffLines(normalized)
      if (!trebleOutlier && Number.isFinite(detected.treble) && detected.treble > 0) {
        gapSamples.treble.push(detected.treble)
      }
      if (!bassOutlier && Number.isFinite(detected.bass) && detected.bass > 0) {
        gapSamples.bass.push(detected.bass)
      }
      if (systemDetails) {
        if (trebleOutlier && Number.isFinite(finalGaps.treble)) {
          gapSamples.treble.push(finalGaps.treble)
        }
        if (bassOutlier && Number.isFinite(finalGaps.bass)) {
          gapSamples.bass.push(finalGaps.bass)
        }
      }
    }
  }

  return {
    systemMeasureBoxes,
    staffGapNormalization: {
      page,
      applied: systemsAffected.length > 0,
      canNormalize,
      referenceGaps: documentGapReference
        ? {
            treble: documentGapReference.treble,
            bass: documentGapReference.bass,
            combined: documentGapReference.combined,
            sampleCount: documentGapReference.sampleCount,
          }
        : null,
      systemsAffected,
      gapSamples,
    },
  }
}
