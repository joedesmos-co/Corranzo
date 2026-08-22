import { estimateGrandStaffLines } from './pitchFromStaffPosition.js'

export const MEASURE_BOUNDARY_TYPE = Object.freeze({
  SYSTEM_START: 'SYSTEM_START',
  SINGLE: 'SINGLE',
  DOUBLE: 'DOUBLE',
  REPEAT_START: 'REPEAT_START',
  REPEAT_END: 'REPEAT_END',
  FINAL: 'FINAL',
  SYSTEM_END: 'SYSTEM_END',
  UNCERTAIN: 'UNCERTAIN',
})

const SAME_COLUMN_MIN_TOLERANCE_PX = 2.25
const SAME_COLUMN_GAP_RATIO = 0.2
const MORPHOLOGY_GROUP_GAP_RATIO = 1.2
const STAFF_COMPONENT_COVERAGE_MIN = 0.78
const INTER_STAFF_CONNECTOR_MIN_GAPS = 7.5
const RASTER_CONTINUATION_MIN_RUN = 0.62
const MIN_COMPLETE_GRAPH_SPAN_RATIO = 0.6

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function lineBand(lines, imageHeight) {
  const values = (lines ?? [])
    .filter(Number.isFinite)
    .map((value) => (value <= 1 ? value * imageHeight : value))
    .sort((left, right) => left - right)
  if (values.length !== 5 || values[4] <= values[0]) {
    return null
  }
  return {
    y0: values[0],
    y1: values[4],
    lineGap: (values[4] - values[0]) / 4,
    lines: values,
  }
}

function pixelLuminance(imageData, x, y) {
  const index = (y * imageData.width + x) * 4
  const alpha = imageData.data[index + 3] / 255
  const luminance =
    0.299 * imageData.data[index] +
    0.587 * imageData.data[index + 1] +
    0.114 * imageData.data[index + 2]
  return luminance * alpha + 255 * (1 - alpha)
}

function rasterVerticalRun(
  imageData,
  sourceX,
  band,
  { threshold = 215, radius = 2 } = {},
) {
  if (!imageData?.data || !band) {
    return { longestRunRatio: 0, inkRatio: 0 }
  }
  const xCenter = Math.round(sourceX)
  const y0 = Math.max(0, Math.floor(band.y0))
  const y1 = Math.min(imageData.height - 1, Math.ceil(band.y1))
  const height = Math.max(1, y1 - y0 + 1)
  let run = 0
  let longest = 0
  let dark = 0
  for (let y = y0; y <= y1; y += 1) {
    let darkest = 255
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = Math.max(0, Math.min(imageData.width - 1, xCenter + dx))
      darkest = Math.min(darkest, pixelLuminance(imageData, x, y))
    }
    if (darkest < threshold) {
      run += 1
      dark += 1
      longest = Math.max(longest, run)
    } else {
      run = 0
    }
  }
  return {
    longestRunRatio: longest / height,
    inkRatio: dark / height,
  }
}

function clusterSameColumn(bars, tolerance) {
  const sorted = [...bars].sort((left, right) => left.x - right.x)
  const clusters = []
  for (const bar of sorted) {
    const previous = clusters[clusters.length - 1]
    if (previous && Math.abs(bar.x - previous.x) <= tolerance) {
      previous.members.push(bar)
      previous.x =
        previous.members.reduce((sum, member) => sum + member.x, 0) /
        previous.members.length
      continue
    }
    clusters.push({ x: bar.x, members: [bar] })
  }
  return clusters
}

function classifyColumn(cluster, { treble, bass, staffGap, imageData }) {
  const trebleCoverage = Math.min(
    1,
    cluster.members.reduce(
      (sum, bar) =>
        sum + overlap(bar.bounds.y0, bar.bounds.y1, treble.y0, treble.y1),
      0,
    ) / Math.max(1, treble.y1 - treble.y0),
  )
  const bassCoverage = Math.min(
    1,
    cluster.members.reduce(
      (sum, bar) =>
        sum + overlap(bar.bounds.y0, bar.bounds.y1, bass.y0, bass.y1),
      0,
    ) / Math.max(1, bass.y1 - bass.y0),
  )
  const maximumHeight = Math.max(
    0,
    ...cluster.members.map((bar) => bar.height ?? bar.bounds.height ?? 0),
  )
  const averageWidth =
    cluster.members.reduce(
      (sum, bar) => sum + (bar.width ?? bar.bounds.width ?? 0),
      0,
    ) / Math.max(1, cluster.members.length)
  const bridge = cluster.members.some(
    (bar) =>
      bar.bounds.y0 <= treble.y1 + staffGap * 0.4 &&
      bar.bounds.y1 >= bass.y0 - staffGap * 0.4,
  )
  const hasTrebleComponent = trebleCoverage >= STAFF_COMPONENT_COVERAGE_MIN
  const hasBassComponent = bassCoverage >= STAFF_COMPONENT_COVERAGE_MIN
  const continuousGrandStaff = cluster.members.some(
    (bar) =>
      bar.bounds.y0 <= treble.y0 + staffGap * 0.55 &&
      bar.bounds.y1 >= bass.y1 - staffGap * 0.55,
  )
  const pairedStaffFragments =
    cluster.members.length >= 2 && hasTrebleComponent && hasBassComponent
  const rasterCorroboration = {
    treble: rasterVerticalRun(imageData, cluster.x, treble),
    gap: rasterVerticalRun(imageData, cluster.x, {
      y0: treble.y1,
      y1: bass.y0,
    }),
    bass: rasterVerticalRun(imageData, cluster.x, bass),
  }
  const interStaffConnector =
    hasTrebleComponent &&
    bridge &&
    maximumHeight >= staffGap * INTER_STAFF_CONNECTOR_MIN_GAPS &&
    rasterCorroboration.bass.longestRunRatio >= RASTER_CONTINUATION_MIN_RUN

  // Upper/lower stems can align by chance. Separate stave fragments therefore
  // remain UNCERTAIN unless another source path corroborates them later.
  const accepted =
    maximumHeight >= staffGap * 2.6 &&
    (continuousGrandStaff || interStaffConnector)

  return {
    x: cluster.x,
    accepted,
    confidence: continuousGrandStaff ? 0.99 : interStaffConnector ? 0.96 : 0.4,
    trebleCoverage,
    bassCoverage,
    bridge,
    continuousGrandStaff,
    interStaffConnector,
    pairedStaffFragments,
    maximumHeight,
    averageWidth,
    rasterCorroboration,
    componentIds: cluster.members.map((bar) => bar.candidateId),
  }
}

function printedTypeForColumns(columns) {
  if (columns.length === 1) {
    return MEASURE_BOUNDARY_TYPE.SINGLE
  }
  if (columns.length === 2) {
    const [left, right] = columns
    if (right.averageWidth >= left.averageWidth * 1.8) {
      return MEASURE_BOUNDARY_TYPE.FINAL
    }
    return MEASURE_BOUNDARY_TYPE.DOUBLE
  }
  return MEASURE_BOUNDARY_TYPE.UNCERTAIN
}

function groupBoundaryMorphology(columns, staffGap) {
  const accepted = columns
    .filter((column) => column.accepted)
    .sort((left, right) => left.x - right.x)
  const groups = []
  for (const column of accepted) {
    const previous = groups[groups.length - 1]
    const previousColumn = previous?.columns[previous.columns.length - 1]
    if (
      previous &&
      column.x - previousColumn.x <= staffGap * MORPHOLOGY_GROUP_GAP_RATIO
    ) {
      previous.columns.push(column)
      previous.sourceX =
        previous.columns.reduce((sum, entry) => sum + entry.x, 0) /
        previous.columns.length
      previous.printedType = printedTypeForColumns(previous.columns)
      previous.confidence = Math.min(
        0.99,
        Math.max(...previous.columns.map((entry) => entry.confidence)),
      )
      previous.componentIds.push(...column.componentIds)
      continue
    }
    groups.push({
      sourceX: column.x,
      printedType: MEASURE_BOUNDARY_TYPE.SINGLE,
      confidence: column.confidence,
      columns: [column],
      componentIds: [...column.componentIds],
    })
  }
  return groups
}

function normalizedContentBounds(contentBounds, imageData) {
  const x0 = Number.isFinite(contentBounds?.x0)
    ? contentBounds.x0
    : Number(contentBounds?.left ?? 0) / imageData.width
  const x1 = Number.isFinite(contentBounds?.x1)
    ? contentBounds.x1
    : Number(contentBounds?.right ?? imageData.width) / imageData.width
  return { x0, x1 }
}

/**
 * Build a source-proven, ordered measure-boundary graph for one grand staff.
 * Ground truth, expected rhythms, titles, filenames, pages, and measure numbers
 * are intentionally absent from the inputs.
 */
export function buildCanonicalMeasureBoundaryGraph({
  page = 1,
  systemIndex = 0,
  system,
  contentBounds,
  imageData,
  vectorBarlines = [],
} = {}) {
  if (!imageData?.width || !imageData?.height || !Array.isArray(vectorBarlines)) {
    return { usable: false, reason: 'missing-source-geometry', boundaries: [], measureSpans: [] }
  }
  const staffLines = estimateGrandStaffLines(system)
  const treble = lineBand(staffLines?.treble, imageData.height)
  const bass = lineBand(staffLines?.bass, imageData.height)
  if (!treble || !bass || bass.y0 <= treble.y1) {
    return { usable: false, reason: 'not-a-resolved-grand-staff', boundaries: [], measureSpans: [] }
  }
  const staffGap = Math.max(4, (treble.lineGap + bass.lineGap) / 2)
  const systemTop = treble.y0 - staffGap
  const systemBottom = bass.y1 + staffGap
  const components = vectorBarlines.filter(
    (bar) =>
      Number.isFinite(bar?.x) &&
      bar?.bounds &&
      overlap(bar.bounds.y0, bar.bounds.y1, systemTop, systemBottom) >= staffGap * 1.4,
  )
  if (!components.length) {
    return { usable: false, reason: 'no-vector-components', boundaries: [], measureSpans: [] }
  }

  const columnTolerance = Math.max(
    SAME_COLUMN_MIN_TOLERANCE_PX,
    staffGap * SAME_COLUMN_GAP_RATIO,
  )
  const columns = clusterSameColumn(components, columnTolerance).map((cluster) =>
    classifyColumn(cluster, { treble, bass, staffGap, imageData }),
  )
  const groups = groupBoundaryMorphology(columns, staffGap)
  if (groups.length < 2) {
    return {
      usable: false,
      reason: 'incomplete-vector-boundary-sequence',
      boundaries: [],
      measureSpans: [],
      rejectedColumns: columns.filter((column) => !column.accepted),
    }
  }

  const { x0: contentX0, x1: contentX1 } = normalizedContentBounds(
    contentBounds,
    imageData,
  )
  const contentWidthPx = Math.max(1, (contentX1 - contentX0) * imageData.width)
  const sourceSpan = groups[groups.length - 1].sourceX - groups[0].sourceX
  if (sourceSpan < contentWidthPx * MIN_COMPLETE_GRAPH_SPAN_RATIO) {
    return {
      usable: false,
      reason: 'vector-boundary-sequence-does-not-span-system',
      boundaries: [],
      measureSpans: [],
      sourceSpanRatio: sourceSpan / contentWidthPx,
      rejectedColumns: columns.filter((column) => !column.accepted),
    }
  }

  const boundaries = groups.map((group, index) => {
    const isStart = index === 0
    const isEnd = index === groups.length - 1
    return {
      boundaryId: `p${page}-s${systemIndex}-b${index}`,
      page,
      systemIndex,
      type: isStart
        ? MEASURE_BOUNDARY_TYPE.SYSTEM_START
        : isEnd
          ? MEASURE_BOUNDARY_TYPE.SYSTEM_END
          : group.printedType,
      printedType: group.printedType,
      confidence: group.confidence,
      sourceX: group.sourceX,
      normalizedX: group.sourceX / imageData.width,
      staffCoverage: {
        treble: Math.max(...group.columns.map((column) => column.trebleCoverage)),
        bass: Math.max(...group.columns.map((column) => column.bassCoverage)),
        bridge: group.columns.some((column) => column.bridge),
      },
      componentIds: group.componentIds,
      evidence: [
        'pdf-vector-path',
        'barline-morphology',
        ...(group.columns.some((column) => column.continuousGrandStaff)
          ? ['continuous-grand-staff-span']
          : []),
        ...(group.columns.some((column) => column.interStaffConnector)
          ? ['inter-staff-connector', 'raster-source-corroboration']
          : []),
      ],
    }
  })

  const measureSpans = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const x0 = boundaries[index].normalizedX
    const x1 = boundaries[index + 1].normalizedX
    if (x1 - x0 <= 0.01) {
      continue
    }
    measureSpans.push({
      x0,
      x1,
      leftBoundaryId: boundaries[index].boundaryId,
      rightBoundaryId: boundaries[index + 1].boundaryId,
      source: 'canonical-vector-boundary-graph',
      confidence: Math.min(
        boundaries[index].confidence,
        boundaries[index + 1].confidence,
      ),
    })
  }

  return {
    usable: measureSpans.length === boundaries.length - 1,
    reason:
      measureSpans.length === boundaries.length - 1
        ? 'canonical-vector-boundary-graph'
        : 'degenerate-boundary-interval',
    page,
    systemIndex,
    staffGap,
    sourceSpanRatio: sourceSpan / contentWidthPx,
    boundaries,
    measureSpans,
    acceptedColumnCount: columns.filter((column) => column.accepted).length,
    rejectedColumns: columns.filter((column) => !column.accepted),
  }
}
