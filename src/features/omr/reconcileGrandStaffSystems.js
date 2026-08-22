import { buildCanonicalMeasureBoundaryGraph } from './canonicalMeasureBoundaryGraph.js'

function fiveLineStaveFromSystem(system) {
  if (!system || system.staveCount !== 1) {
    return null
  }
  const source = system.staves?.length === 1 ? system.staves[0] : system
  const lineYs = source.lineYs ?? source.detectedLineYs ?? null
  if (!Array.isArray(lineYs) || lineYs.length !== 5) {
    return null
  }
  return {
    y0: source.y0,
    y1: source.y1,
    center: source.center ?? (source.y0 + source.y1) / 2,
    lineCount: source.lineCount ?? 5,
    detectedLineYs: source.detectedLineYs ?? lineYs,
    lineYs,
  }
}

function mergeGrandStaffPair(upper, lower) {
  const y0 = upper.y0
  const y1 = lower.y1
  return {
    y0,
    y1,
    center: (y0 + y1) / 2,
    staveCount: 2,
    staves: [upper, lower],
  }
}

/**
 * Repair a staff detector's unresolved adjacent five-line pair only when the
 * printed source independently proves that it is one grand staff. The
 * canonical boundary graph requires vector bars that continuously span the
 * two staves (or an inter-staff connector corroborated by raster ink), so two
 * unrelated single-staff systems and merely aligned stems remain separate.
 */
export function reconcileSourceSupportedGrandStaffSystems({
  page = 1,
  systems = [],
  contentBounds,
  imageData,
  vectorBarlines = [],
} = {}) {
  if (!Array.isArray(systems) || systems.length < 2) {
    return { systems, applied: false, merges: [] }
  }

  const reconciled = []
  const merges = []
  for (let index = 0; index < systems.length; index += 1) {
    const upper = fiveLineStaveFromSystem(systems[index])
    const lower = fiveLineStaveFromSystem(systems[index + 1])
    if (!upper || !lower || lower.y0 <= upper.y1) {
      reconciled.push(systems[index])
      continue
    }

    const candidate = mergeGrandStaffPair(upper, lower)
    const graph = buildCanonicalMeasureBoundaryGraph({
      page,
      systemIndex: reconciled.length,
      system: candidate,
      contentBounds,
      imageData,
      vectorBarlines,
    })
    if (!graph.usable) {
      reconciled.push(systems[index])
      continue
    }

    reconciled.push(candidate)
    merges.push({
      originalSystemIndices: [index, index + 1],
      reconciledSystemIndex: reconciled.length - 1,
      reason: 'source-supported-grand-staff-boundary-graph',
      sourceSpanRatio: graph.sourceSpanRatio,
      boundaryCount: graph.boundaries.length,
      componentIds: graph.boundaries.flatMap((boundary) => boundary.componentIds),
      evidence: [...new Set(graph.boundaries.flatMap((boundary) => boundary.evidence))],
    })
    index += 1
  }

  return {
    systems: reconciled,
    applied: merges.length > 0,
    merges,
  }
}
