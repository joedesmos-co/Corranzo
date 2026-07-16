/** Structure-first page analysis for the OMR V3 shadow pipeline. */

import {
  createOmrPageIR,
  createOmrV3BoundingBox,
  createOmrV3Diagnostic,
  createOmrV3Id,
  createOmrV3LineGeometry,
  OMR_V3_DIAGNOSTIC_SEVERITY,
  OMR_V3_NOTATION_TYPE,
  OMR_V3_STAFF_GROUP_TYPE,
} from './omrV3Ir.js'

const DEFAULT_DUPLICATE_RATIO = 0.32
const STAFF_REGULARITY_MAX_CV = 0.28
const MERGED_STAFF_BOUNDARY_RATIO = 1.22
const PAIR_THRESHOLD = 0.62
const BARLINE_X_TOLERANCE = 0.008

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function average(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right)
  return finite.length ? finite[Math.floor(finite.length / 2)] : 0
}

function coefficientOfVariation(values) {
  const mean = average(values)
  if (mean <= 0 || values.length === 0) return Infinity
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

function rowY(row) {
  if (Number.isFinite(row)) return row
  return Number(row?.y ?? row?.yStart ?? row?.row)
}

function rowSourceRef(row, fallback) {
  return typeof row === 'object' && row?.sourceId ? row.sourceId : fallback
}

function normalized(value, size, space) {
  if (!Number.isFinite(value)) return null
  return space === 'pixels' ? value / Math.max(1, size) : value
}

/**
 * Collapse consecutive raster rows that describe the same physical staff line.
 * The threshold is learned from the bimodal row-gap distribution unless the
 * caller supplies one. Raw members remain available in `groups` for provenance.
 */
export function collapseDoubledStaffRows(
  lineRows,
  { duplicateTolerance = null, duplicateRatio = DEFAULT_DUPLICATE_RATIO } = {},
) {
  const sorted = (lineRows ?? [])
    .map((row, index) => ({ row, index, y: rowY(row) }))
    .filter((entry) => Number.isFinite(entry.y))
    .sort((left, right) => left.y - right.y || left.index - right.index)
  if (sorted.length === 0) {
    return { rows: [], groups: [], collapsedCount: 0, tolerance: 0 }
  }

  const gaps = sorted
    .slice(1)
    .map((entry, index) => entry.y - sorted[index].y)
    .filter((gap) => gap > 0)
  const minimumGap = gaps.length ? Math.min(...gaps) : 0
  const separatedGaps = gaps.filter((gap) => gap > minimumGap * 2)
  const referenceGap = separatedGaps.length ? median(separatedGaps) : median(gaps)
  const smallGaps = gaps.filter((gap) => gap < referenceGap * duplicateRatio)
  // Physical staff spacing dominates a merged 10/11/12-line band, whereas
  // doubled raster rows alternate thin and large gaps. Do not collapse the
  // majority gap class merely because one inter-staff boundary is wider.
  const looksBimodal = smallGaps.length > 0 && smallGaps.length / Math.max(1, gaps.length) <= 0.65
  const learnedTolerance = looksBimodal
    ? Math.min(referenceGap * duplicateRatio, Math.max(...smallGaps) * 1.25)
    : 0
  const tolerance = Number.isFinite(duplicateTolerance)
    ? Math.max(0, duplicateTolerance)
    : learnedTolerance

  const groups = []
  let current = [sorted[0]]
  for (let index = 1; index < sorted.length; index += 1) {
    const entry = sorted[index]
    const previous = current[current.length - 1]
    if (entry.y - previous.y <= tolerance) {
      current.push(entry)
    } else {
      groups.push(current)
      current = [entry]
    }
  }
  groups.push(current)

  return {
    rows: groups.map((group) => average(group.map((entry) => entry.y))),
    groups: groups.map((group) => group.map((entry) => entry.row)),
    collapsedCount: sorted.length - groups.length,
    tolerance,
  }
}

function staffSliceScore(rows) {
  if (rows.length !== 5 && rows.length !== 6) return -Infinity
  const gaps = rows.slice(1).map((value, index) => value - rows[index])
  const cv = coefficientOfVariation(gaps)
  return cv <= STAFF_REGULARITY_MAX_CV ? 1 - cv : -Infinity
}

/**
 * Split only merged bands with clear 5/6-line sub-staff geometry. Ambiguous
 * 7–9-line bands and uniform 10–12-line bands remain intact and low-confidence.
 */
export function segmentMergedStaffRows(collapsedRows, collapsedGroups = []) {
  const rows = [...(collapsedRows ?? [])]
  if (rows.length < 10 || rows.length > 12) {
    return {
      segments: [{ rows, groups: collapsedGroups, sourceStart: 0 }],
      split: false,
      reason: rows.length >= 7 ? 'ambiguous-merged-band' : 'single-band',
    }
  }

  const partitions = []
  for (const firstCount of [5, 6]) {
    const secondCount = rows.length - firstCount
    if (secondCount !== 5 && secondCount !== 6) continue
    const first = rows.slice(0, firstCount)
    const second = rows.slice(firstCount)
    const firstScore = staffSliceScore(first)
    const secondScore = staffSliceScore(second)
    if (!Number.isFinite(firstScore) || !Number.isFinite(secondScore)) continue
    const boundaryGap = second[0] - first[first.length - 1]
    const withinGaps = [
      ...first.slice(1).map((value, index) => value - first[index]),
      ...second.slice(1).map((value, index) => value - second[index]),
    ]
    const withinMedian = median(withinGaps)
    const boundaryRatio = withinMedian > 0 ? boundaryGap / withinMedian : 0
    partitions.push({
      firstCount,
      score: firstScore + secondScore + Math.min(1.5, boundaryRatio * 0.25),
      boundaryRatio,
    })
  }

  const best = partitions
    .filter((partition) => partition.boundaryRatio >= MERGED_STAFF_BOUNDARY_RATIO)
    .sort((left, right) => right.score - left.score)[0]
  if (!best) {
    return {
      segments: [{ rows, groups: collapsedGroups, sourceStart: 0 }],
      split: false,
      reason: 'ambiguous-merged-band',
    }
  }

  return {
    segments: [
      {
        rows: rows.slice(0, best.firstCount),
        groups: collapsedGroups.slice(0, best.firstCount),
        sourceStart: 0,
      },
      {
        rows: rows.slice(best.firstCount),
        groups: collapsedGroups.slice(best.firstCount),
        sourceStart: best.firstCount,
      },
    ],
    split: true,
    reason: 'regular-substaff-geometry',
    boundaryRatio: best.boundaryRatio,
  }
}

function glyphYNormalized(glyph, pageHeight) {
  const space = glyph?.space ?? (glyph?.normalized ? 'normalized' : 'pixels')
  return normalized(Number(glyph?.y ?? glyph?.cy), pageHeight, space)
}

function glyphXNormalized(glyph, pageWidth) {
  const space = glyph?.space ?? (glyph?.normalized ? 'normalized' : 'pixels')
  return normalized(Number(glyph?.x ?? glyph?.cx), pageWidth, space)
}

function classifyGlyph(glyph) {
  const explicitKind = glyph?.kind
  if (explicitKind) return explicitKind
  const text = String(glyph?.text ?? '')
  if (/^[\uE0A2-\uE0A4]$/.test(text)) return 'notehead'
  if (/^[0-9]+$/.test(text)) return 'tab-digit'
  if (/^[\uE050\uE062]$/.test(text)) return 'clef'
  if (/^[\uE06D\uE06E]$/.test(text)) return 'tab-clef'
  return 'unknown'
}

function evidenceInBand(glyphs, { top, bottom, pageWidth, pageHeight, xStart, xEnd }) {
  const pad = Math.max(0.005, (bottom - top) * 0.75)
  const evidence = {
    noteheadCount: 0,
    tabDigitCount: 0,
    explicitTab: false,
    clefs: [],
    braceCount: 0,
    bracketCount: 0,
  }
  for (const glyph of glyphs ?? []) {
    const y = glyphYNormalized(glyph, pageHeight)
    const x = glyphXNormalized(glyph, pageWidth)
    if (!Number.isFinite(y) || y < top - pad || y > bottom + pad) continue
    if (Number.isFinite(x) && (x < xStart - 0.03 || x > xEnd + 0.03)) continue
    const kind = classifyGlyph(glyph)
    if (kind === 'notehead') evidence.noteheadCount += 1
    if (kind === 'tab-digit') evidence.tabDigitCount += 1
    if (kind === 'tab-clef') evidence.explicitTab = true
    if (kind === 'clef') evidence.clefs.push(glyph.clef ?? glyph.text ?? 'unknown')
    if (kind === 'brace') evidence.braceCount += 1
    if (kind === 'bracket') evidence.bracketCount += 1
  }
  return evidence
}

function resolveNotationEvidence(lineCount, evidence) {
  let notationScore = lineCount === 5 ? 0.45 : 0
  let tabScore = lineCount === 6 ? 0.35 : 0
  if (evidence.clefs.length > 0) notationScore += 0.32
  if (evidence.noteheadCount >= 2) notationScore += 0.23
  else if (evidence.noteheadCount === 1) notationScore += 0.1
  if (evidence.explicitTab) tabScore += 0.42
  if (evidence.tabDigitCount >= 2) tabScore += 0.23
  else if (evidence.tabDigitCount === 1) tabScore += 0.1
  notationScore = clamp(notationScore)
  tabScore = clamp(tabScore)

  let notationType = OMR_V3_NOTATION_TYPE.AMBIGUOUS
  if (notationScore >= 0.62 && notationScore >= tabScore + 0.12) {
    notationType = OMR_V3_NOTATION_TYPE.NOTATION
  } else if (tabScore >= 0.62 && tabScore >= notationScore + 0.12) {
    notationType = OMR_V3_NOTATION_TYPE.TAB
  }
  return { notationType, notationScore, tabScore }
}

function normalizeBarlineEvidence(barlines, pageWidth, defaultSourceRef) {
  return (barlines ?? [])
    .map((barline, index) => {
      const numeric = Number.isFinite(barline) ? barline : Number(barline?.x)
      const space = Number.isFinite(barline) ? 'normalized' : barline?.space ?? 'normalized'
      const x = normalized(numeric, pageWidth, space)
      if (!Number.isFinite(x)) return null
      return {
        evidenceId: String(
          barline?.evidenceId ?? createOmrV3Id('barline-evidence', defaultSourceRef, index),
        ),
        x,
        confidence: clamp(Number(barline?.confidence ?? 0.7)),
        source: barline?.source ?? 'staff-barline-detector',
        kind: barline?.kind ?? 'barline-candidate',
        verticalSpanRatio: Number.isFinite(barline?.verticalSpanRatio)
          ? clamp(barline.verticalSpanRatio)
          : null,
        stemLikelihood: Number.isFinite(barline?.stemLikelihood)
          ? clamp(barline.stemLikelihood)
          : 0,
        vectorEvidence: Boolean(barline?.vectorEvidence),
        sourceRefs: [barline?.sourceId ?? defaultSourceRef].filter(Boolean),
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.x - right.x)
}

function rawLinesForSegment(segment, observation, pageWidth, pageHeight, space) {
  const xStartRaw = Number(observation.xStart ?? 0)
  const xEndRaw = Number(observation.xEnd ?? (space === 'pixels' ? pageWidth : 1))
  const result = []
  for (let lineIndex = 0; lineIndex < segment.groups.length; lineIndex += 1) {
    const rawGroup = segment.groups[lineIndex] ?? [segment.rows[lineIndex]]
    for (let rawIndex = 0; rawIndex < rawGroup.length; rawIndex += 1) {
      const row = rawGroup[rawIndex]
      const y = rowY(row)
      result.push(
        createOmrV3LineGeometry({
          xStart: Number(row?.xStart ?? xStartRaw),
          xEnd: Number(row?.xEnd ?? xEndRaw),
          yStart: y,
          yEnd: Number(row?.yEnd ?? y),
          thickness: row?.thickness ?? null,
          space,
          confidence: row?.confidence ?? observation.confidence ?? null,
          sourceRefs: [rowSourceRef(row, observation.sourceId)].filter(Boolean),
        }),
      )
    }
  }
  return result
}

function normalizedLinesForSegment(segment, observation, pageWidth, pageHeight, space) {
  const xStart = normalized(Number(observation.xStart ?? 0), pageWidth, space)
  const xEnd = normalized(
    Number(observation.xEnd ?? (space === 'pixels' ? pageWidth : 1)),
    pageWidth,
    space,
  )
  return segment.rows.map((y, index) =>
    createOmrV3LineGeometry({
      xStart,
      xEnd,
      yStart: normalized(y, pageHeight, space),
      yEnd: normalized(y, pageHeight, space),
      space: 'normalized',
      confidence: observation.confidence ?? null,
      sourceRefs: [observation.sourceId, `line:${segment.sourceStart + index}`].filter(Boolean),
    }),
  )
}

/** Convert raw detector bands into lossless, classified staff observations. */
export function buildOmrV3StaffCandidates({
  documentId,
  pageIndex = 0,
  pageWidth,
  pageHeight,
  contentBounds = { x: 0, y: 0, width: 1, height: 1, space: 'normalized' },
  staffBands = [],
  glyphs = [],
} = {}) {
  const pageId = createOmrV3Id('page', documentId, pageIndex)
  const candidates = []
  const diagnostics = []

  for (let bandIndex = 0; bandIndex < staffBands.length; bandIndex += 1) {
    const observation = staffBands[bandIndex] ?? {}
    const sourceId = String(observation.sourceId ?? `page-${pageIndex}-staff-band-${bandIndex}`)
    const space = observation.space ?? 'normalized'
    const lineRows = observation.lineRows ?? observation.detectedLineYs ?? observation.lineYs ?? []
    const collapsed = collapseDoubledStaffRows(lineRows, {
      duplicateTolerance: observation.duplicateTolerance,
    })
    const segmented = segmentMergedStaffRows(collapsed.rows, collapsed.groups)
    if (collapsed.collapsedCount > 0) {
      diagnostics.push(
        createOmrV3Diagnostic({
          code: 'doubled-raster-rows-collapsed',
          stage: 'staff-detection',
          message: `Collapsed ${collapsed.collapsedCount} duplicate staff row(s).`,
          sourceRefs: [sourceId],
          data: { tolerance: collapsed.tolerance },
        }),
      )
    }
    if (segmented.reason === 'ambiguous-merged-band') {
      diagnostics.push(
        createOmrV3Diagnostic({
          code: 'ambiguous-merged-staff-band',
          severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
          stage: 'staff-detection',
          message: `Preserved ambiguous ${collapsed.rows.length}-line band without guessing a split.`,
          sourceRefs: [sourceId],
        }),
      )
    }

    for (let segmentIndex = 0; segmentIndex < segmented.segments.length; segmentIndex += 1) {
      const segment = segmented.segments[segmentIndex]
      if (segment.rows.length === 0) continue
      const normalizedLines = normalizedLinesForSegment(
        segment,
        observation,
        pageWidth,
        pageHeight,
        space,
      )
      const top = normalizedLines[0].yStart
      const bottom = normalizedLines[normalizedLines.length - 1].yStart
      const contentX = contentBounds.space === 'pixels'
        ? normalized(contentBounds.x, pageWidth, 'pixels')
        : contentBounds.x
      const contentWidth = contentBounds.space === 'pixels'
        ? normalized(contentBounds.width, pageWidth, 'pixels')
        : contentBounds.width
      const xStart = normalized(Number(observation.xStart), pageWidth, space) ?? contentX ?? 0
      const xEnd =
        normalized(Number(observation.xEnd), pageWidth, space) ??
        (Number.isFinite(contentX) && Number.isFinite(contentWidth) ? contentX + contentWidth : 1)
      const localEvidence = evidenceInBand(glyphs, {
        top,
        bottom,
        pageWidth,
        pageHeight,
        xStart,
        xEnd,
      })
      const evidence = {
        noteheadCount: localEvidence.noteheadCount + Number(observation.noteheadCount ?? 0),
        tabDigitCount: localEvidence.tabDigitCount + Number(observation.tabDigitCount ?? 0),
        explicitTab: localEvidence.explicitTab || Boolean(observation.explicitTab),
        clefs: [...localEvidence.clefs, ...(observation.clefs ?? [])],
        braceCount: localEvidence.braceCount + Number(observation.braceCount ?? 0),
        bracketCount: localEvidence.bracketCount + Number(observation.bracketCount ?? 0),
      }
      const classification = resolveNotationEvidence(segment.rows.length, evidence)
      const staffId = createOmrV3Id('staff-observation', pageId, sourceId, segmentIndex)
      const spacing = median(
        normalizedLines.slice(1).map((line, index) => line.yStart - normalizedLines[index].yStart),
      )
      candidates.push({
        staffId,
        sourceId,
        pageId,
        bandIndex,
        segmentIndex,
        lineCount: segment.rows.length,
        rawLineGeometry: rawLinesForSegment(segment, observation, pageWidth, pageHeight, space),
        normalizedLineGeometry: normalizedLines,
        boundingBox: createOmrV3BoundingBox({
          x: clamp(xStart),
          y: clamp(top),
          width: clamp(xEnd - xStart),
          height: clamp(Math.max(bottom - top, spacing || 0.002)),
        }),
        clef: evidence.clefs[0] ?? observation.clef ?? null,
        notationType: classification.notationType,
        notationScore: classification.notationScore,
        tabScore: classification.tabScore,
        lineSpacing: spacing,
        evidence,
        barlineEvidence: normalizeBarlineEvidence(observation.barlines, pageWidth, sourceId),
        sourceRefs: [sourceId],
        confidence: {
          overall: Math.max(classification.notationScore, classification.tabScore),
          stages: {
            'staff-detection': clamp(Number(observation.confidence ?? 0.7)),
            'staff-classification': Math.max(classification.notationScore, classification.tabScore),
          },
          evidence: [
            { kind: 'line-count', value: segment.rows.length },
            { kind: 'noteheads', value: evidence.noteheadCount },
            { kind: 'tab-digits', value: evidence.tabDigitCount },
            { kind: 'explicit-tab', value: evidence.explicitTab },
          ],
        },
        diagnostics: [],
      })
    }
  }

  candidates.sort(
    (left, right) => left.boundingBox.y - right.boundingBox.y || left.boundingBox.x - right.boundingBox.x,
  )
  candidates.forEach((candidate, index) => {
    candidate.verticalOrder = index
  })
  return { pageId, candidates, diagnostics }
}

function horizontalOverlap(left, right) {
  const overlap = Math.max(
    0,
    Math.min(left.boundingBox.x + left.boundingBox.width, right.boundingBox.x + right.boundingBox.width) -
      Math.max(left.boundingBox.x, right.boundingBox.x),
  )
  return overlap / Math.max(1e-6, Math.min(left.boundingBox.width, right.boundingBox.width))
}

function barlineAlignment(left, right, tolerance = BARLINE_X_TOLERANCE) {
  const leftBars = left.barlineEvidence.filter((barline) => barline.confidence >= 0.25)
  const rightBars = right.barlineEvidence.filter((barline) => barline.confidence >= 0.25)
  if (leftBars.length === 0 || rightBars.length === 0) return 0
  const used = new Set()
  let matched = 0
  for (const leftBar of leftBars) {
    let bestIndex = -1
    let bestDistance = Infinity
    for (let index = 0; index < rightBars.length; index += 1) {
      if (used.has(index)) continue
      const distance = Math.abs(leftBar.x - rightBars[index].x)
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex)
      matched += 1
    }
  }
  return matched / Math.max(leftBars.length, rightBars.length)
}

function staffGapRatio(upper, lower) {
  const upperBottom = upper.boundingBox.y + upper.boundingBox.height
  const gap = Math.max(0, lower.boundingBox.y - upperBottom)
  const span = average([
    Math.max(upper.boundingBox.height, upper.lineSpacing * Math.max(1, upper.lineCount - 1)),
    Math.max(lower.boundingBox.height, lower.lineSpacing * Math.max(1, lower.lineCount - 1)),
  ])
  return gap / Math.max(0.002, span)
}

function pairingKind(upper, lower) {
  const upperTab = upper.tabScore >= 0.62 && upper.tabScore > upper.notationScore
  const lowerTab = lower.tabScore >= 0.62 && lower.tabScore > lower.notationScore
  const upperNotation = upper.notationScore >= 0.62 && upper.notationScore >= upper.tabScore
  const lowerNotation = lower.notationScore >= 0.62 && lower.notationScore >= lower.tabScore
  if ((upperNotation && lowerTab) || (upperTab && lowerNotation)) {
    return OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB
  }
  if (upperNotation && lowerNotation && upper.lineCount === 5 && lower.lineCount === 5) {
    return OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF
  }
  return OMR_V3_STAFF_GROUP_TYPE.UNKNOWN
}

function repeatedGeometryScore(candidateIndex, staffs, gapRatio, kind) {
  if (kind === OMR_V3_STAFF_GROUP_TYPE.UNKNOWN) return 0
  let similar = 0
  for (let index = 0; index < staffs.length - 1; index += 1) {
    if (index === candidateIndex) continue
    if (pairingKind(staffs[index], staffs[index + 1]) !== kind) continue
    const ratio = staffGapRatio(staffs[index], staffs[index + 1])
    if (Math.abs(ratio - gapRatio) <= Math.max(0.25, gapRatio * 0.25)) similar += 1
  }
  return similar > 0 ? 1 : 0
}

function scoreStaffPair(upper, lower, { instrumentId, staffs, index }) {
  const kind = pairingKind(upper, lower)
  const overlap = horizontalOverlap(upper, lower)
  const leftAlignment = clamp(1 - Math.abs(upper.boundingBox.x - lower.boundingBox.x) / 0.04)
  const barline = barlineAlignment(upper, lower)
  const gapRatio = staffGapRatio(upper, lower)
  const repeatedGeometry = repeatedGeometryScore(index, staffs, gapRatio, kind)
  const brace = Math.max(upper.evidence.braceCount, lower.evidence.braceCount) > 0 ? 1 : 0
  const bracket = Math.max(upper.evidence.bracketCount, lower.evidence.bracketCount) > 0 ? 1 : 0

  let typeCompatibility = 0
  let distanceScore = 0
  let contextScore = 0
  if (kind === OMR_V3_STAFF_GROUP_TYPE.PIANO_GRAND_STAFF) {
    typeCompatibility = 1
    distanceScore = clamp(1 - Math.max(0, gapRatio - 0.55) / 2.1)
    contextScore = instrumentId === 'piano' ? 1 : 0.35
  } else if (kind === OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB) {
    typeCompatibility = 1
    distanceScore = gapRatio <= 1.1 ? 1 : clamp(1 - (gapRatio - 1.1) / 5.5, 0.2, 1)
    contextScore = instrumentId === 'guitar' ? 1 : 0.6
  }

  const score =
    typeCompatibility * 0.2 +
    overlap * 0.13 +
    leftAlignment * 0.08 +
    barline * 0.23 +
    distanceScore * 0.2 +
    contextScore * 0.07 +
    brace * 0.05 +
    bracket * 0.02 +
    repeatedGeometry * 0.02
  const accepted =
    kind !== OMR_V3_STAFF_GROUP_TYPE.UNKNOWN &&
    overlap >= 0.65 &&
    score >= PAIR_THRESHOLD &&
    (kind === OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB
      ? distanceScore >= 0.2
      : distanceScore >= 0.25 || brace > 0) &&
    (barline >= 0.35 || brace > 0 || (kind === OMR_V3_STAFF_GROUP_TYPE.GUITAR_NOTATION_TAB && distanceScore >= 0.7))

  return {
    kind,
    score: clamp(score),
    accepted,
    evidence: [
      { signal: 'horizontal-overlap', score: overlap },
      { signal: 'left-edge-alignment', score: leftAlignment },
      { signal: 'barline-alignment', score: barline },
      { signal: 'vertical-distance', score: distanceScore, gapRatio },
      { signal: 'type-compatibility', score: typeCompatibility },
      { signal: 'instrument-context', score: contextScore },
      { signal: 'brace', score: brace },
      { signal: 'bracket', score: bracket },
      { signal: 'repeated-page-geometry', score: repeatedGeometry },
    ],
    rejectionReason:
      kind === OMR_V3_STAFF_GROUP_TYPE.UNKNOWN
        ? 'incompatible-or-ambiguous-staff-types'
        : overlap < 0.65
          ? 'insufficient-horizontal-overlap'
          : score < PAIR_THRESHOLD
            ? 'insufficient-multi-signal-confidence'
            : 'insufficient-spanning-evidence',
  }
}

function singleGroupType(staff) {
  if (staff.notationType === OMR_V3_NOTATION_TYPE.TAB) return OMR_V3_STAFF_GROUP_TYPE.TAB_ONLY
  if (staff.notationType === OMR_V3_NOTATION_TYPE.NOTATION) {
    return OMR_V3_STAFF_GROUP_TYPE.SINGLE_NOTATION
  }
  return OMR_V3_STAFF_GROUP_TYPE.UNKNOWN
}

function unionBox(staffs) {
  const x0 = Math.min(...staffs.map((staff) => staff.boundingBox.x))
  const y0 = Math.min(...staffs.map((staff) => staff.boundingBox.y))
  const x1 = Math.max(...staffs.map((staff) => staff.boundingBox.x + staff.boundingBox.width))
  const y1 = Math.max(...staffs.map((staff) => staff.boundingBox.y + staff.boundingBox.height))
  return createOmrV3BoundingBox({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
}

function asStaffIR(staff, systemId, verticalOrder) {
  return {
    staffId: staff.staffId,
    systemId,
    lineCount: staff.lineCount,
    rawLineGeometry: staff.rawLineGeometry,
    normalizedLineGeometry: staff.normalizedLineGeometry,
    boundingBox: staff.boundingBox,
    clef: staff.clef,
    notationType: staff.notationType,
    verticalOrder,
    symbols: [],
    measureMembership: [],
    barlineEvidence: staff.barlineEvidence,
    confidence: staff.confidence,
    diagnostics: staff.diagnostics,
    sourceRefs: staff.sourceRefs,
  }
}

/**
 * Group classified staff observations into musical systems and staff groups.
 * Pair decisions are adjacent, evidence-scored, and never based on line count
 * alone. Every rejected boundary is retained for debug inspection.
 */
export function groupOmrV3StaffCandidates({ pageId, candidates, instrumentId = null } = {}) {
  const staffs = [...(candidates ?? [])].sort(
    (left, right) => left.boundingBox.y - right.boundingBox.y,
  )
  const pairCandidates = staffs.slice(0, -1).map((staff, index) => ({
    upperStaffId: staff.staffId,
    lowerStaffId: staffs[index + 1].staffId,
    ...scoreStaffPair(staff, staffs[index + 1], { instrumentId, staffs, index }),
  }))
  const systems = []
  const rejectedPairings = pairCandidates.filter((pair) => !pair.accepted)

  let staffIndex = 0
  while (staffIndex < staffs.length) {
    const pair = pairCandidates[staffIndex]
    const selected = pair?.accepted ? staffs.slice(staffIndex, staffIndex + 2) : [staffs[staffIndex]]
    const readingOrder = systems.length
    const systemId = createOmrV3Id('system', pageId, readingOrder)
    const type = pair?.accepted ? pair.kind : singleGroupType(selected[0])
    const staffGroupId = createOmrV3Id('staff-group', systemId, 0)
    const localRejected = pair && !pair.accepted ? [pair] : []
    systems.push({
      systemId,
      pageId,
      boundingBox: unionBox(selected),
      readingOrder,
      staffGroups: [
        {
          staffGroupId,
          systemId,
          type,
          staves: selected.map((staff, index) => asStaffIR(staff, systemId, index)),
          braces: [],
          brackets: [],
          pairingEvidence: pair?.accepted ? pair.evidence : [],
          rejectedPairings: localRejected,
          confidence: {
            overall: pair?.accepted
              ? pair.score
              : Math.max(selected[0].notationScore, selected[0].tabScore),
            stages: {
              'system-grouping': pair?.accepted ? pair.score : 0.55,
              'staff-group-classification': pair?.accepted
                ? pair.score
                : Math.max(selected[0].notationScore, selected[0].tabScore),
            },
          },
          diagnostics:
            type === OMR_V3_STAFF_GROUP_TYPE.UNKNOWN
              ? [
                  createOmrV3Diagnostic({
                    code: 'unknown-staff-group',
                    severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
                    stage: 'staff-group-classification',
                    message: 'Evidence was insufficient for a confident staff-group classification.',
                    sourceRefs: selected.flatMap((staff) => staff.sourceRefs),
                  }),
                ]
              : [],
          sourceRefs: selected.flatMap((staff) => staff.sourceRefs),
        },
      ],
      measureColumns: [],
      systemBarlines: [],
      confidence: {
        overall: pair?.accepted
          ? pair.score
          : Math.max(selected[0].notationScore, selected[0].tabScore),
        stages: { 'system-grouping': pair?.accepted ? pair.score : 0.55 },
      },
      diagnostics: [],
      sourceRefs: selected.flatMap((staff) => staff.sourceRefs),
    })
    staffIndex += selected.length
  }

  for (const rejected of rejectedPairings) {
    const owner = systems.find((system) =>
      system.staffGroups[0].staves.some((staff) => staff.staffId === rejected.upperStaffId),
    )
    const entries = owner?.staffGroups?.[0]?.rejectedPairings
    if (
      entries &&
      !entries.some(
        (entry) =>
          entry.upperStaffId === rejected.upperStaffId &&
          entry.lowerStaffId === rejected.lowerStaffId,
      )
    ) {
      entries.push(rejected)
    }
  }

  return { systems, pairCandidates, rejectedPairings }
}

/** Build one validated-shape page IR in reading order. */
export function analyzeOmrV3PageStructure(options = {}) {
  const {
    documentId,
    pageIndex = 0,
    pageWidth,
    pageHeight,
    instrumentId = null,
  } = options
  const staffResult = buildOmrV3StaffCandidates(options)
  const grouping = groupOmrV3StaffCandidates({
    pageId: staffResult.pageId,
    candidates: staffResult.candidates,
    instrumentId,
  })
  const unknownStaffIds = grouping.systems
    .flatMap((system) => system.staffGroups)
    .filter((group) => group.type === OMR_V3_STAFF_GROUP_TYPE.UNKNOWN)
    .flatMap((group) => group.staves.map((staff) => staff.staffId))
  const diagnostics = [
    ...staffResult.diagnostics,
    ...(unknownStaffIds.length
      ? [
          createOmrV3Diagnostic({
            code: 'unassigned-or-ambiguous-staves',
            severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
            stage: 'system-grouping',
            message: `${unknownStaffIds.length} staff observation(s) remain structurally ambiguous.`,
            data: { staffIds: unknownStaffIds },
          }),
        ]
      : []),
  ]
  const page = createOmrPageIR({
    pageId: staffResult.pageId,
    documentId,
    pageIndex,
    width: pageWidth,
    height: pageHeight,
    systems: grouping.systems,
    unassignedSymbols: [],
    confidence: {
      overall: grouping.systems.length
        ? average(grouping.systems.map((system) => system.confidence.overall))
        : 0,
      stages: {
        'staff-detection': staffResult.candidates.length ? 0.7 : 0,
        'system-grouping': grouping.systems.length
          ? average(grouping.systems.map((system) => system.confidence.overall))
          : 0,
      },
    },
    diagnostics,
    sourceRefs: staffResult.candidates.flatMap((staff) => staff.sourceRefs),
  })
  return { page, staffCandidates: staffResult.candidates, ...grouping }
}

export function summarizeOmrV3Structure(page) {
  const groups = (page?.systems ?? []).flatMap((system) => system.staffGroups ?? [])
  const groupTypes = {}
  let staffCount = 0
  for (const group of groups) {
    groupTypes[group.type] = (groupTypes[group.type] ?? 0) + 1
    staffCount += group.staves?.length ?? 0
  }
  return {
    pageIndex: page?.pageIndex ?? null,
    systemCount: page?.systems?.length ?? 0,
    staffGroupCount: groups.length,
    staffCount,
    groupTypes,
    unknownStaffGroupCount: groupTypes[OMR_V3_STAFF_GROUP_TYPE.UNKNOWN] ?? 0,
    rejectedPairingCount: groups.reduce(
      (sum, group) => sum + (group.rejectedPairings?.length ?? 0),
      0,
    ),
    confidence: page?.confidence ?? null,
  }
}
