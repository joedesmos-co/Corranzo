import { isInk } from './omrInk.js'

export const TIE_BEGIN_GLYPH = '\ue8e2'
export const TIE_END_GLYPH = '\ue8e3'
export const SLUR_BEGIN_GLYPH = '\ue8e4'
export const SLUR_END_GLYPH = '\ue8e5'

const MAX_SAME_MEASURE_TIE_PX = 96
const MAX_CROSS_MEASURE_TIE_PX = 140
/** Reject competing pairs whose scores differ by at most this margin. */
const TIE_MATCH_AMBIGUITY_MARGIN = 6
const TIE_ENDPOINT_CANDIDATE_LIMIT = 6

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function flattenMeasureNotes(measureRecords) {
  const instances = []
  for (const record of measureRecords) {
    for (let eventIndex = 0; eventIndex < (record.events ?? []).length; eventIndex += 1) {
      const event = record.events[eventIndex]
      if (event.type !== 'note') {
        continue
      }
      for (let noteIndex = 0; noteIndex < (event.notes ?? []).length; noteIndex += 1) {
        const note = event.notes[noteIndex]
        instances.push({
          measureNumber: record.measureNumber,
          page: record.page ?? null,
          systemIndex: record.systemIndex ?? null,
          eventIndex,
          noteIndex,
          startDivision: event.startDivision ?? 0,
          midi: note.midi,
          clef: note.clef,
          voice: note.voice ?? event.voice ?? null,
          cx: note.cx ?? event.cx,
          cy: note.cy,
          lineYs: note.pitchMapping?.lineYs ?? null,
          eventNoteCount: event.notes?.length ?? 0,
          beams: event.beams ?? 0,
          stem: note.stem ?? event.stem ?? null,
        })
      }
    }
  }
  return instances
    .sort(
    (left, right) =>
      left.measureNumber - right.measureNumber ||
      left.startDivision - right.startDivision ||
      left.clef.localeCompare(right.clef) ||
      left.cx - right.cx,
    )
    .map((instance, instanceIndex) => ({ ...instance, instanceIndex }))
}

function isLaterOnset(left, right) {
  return (
    right.measureNumber > left.measureNumber ||
    (right.measureNumber === left.measureNumber &&
      right.startDivision > left.startDivision)
  )
}

function hasInterveningOnset(instances, fromIndex, toIndex) {
  const from = instances[fromIndex]
  const to = instances[toIndex]
  for (let index = fromIndex + 1; index < toIndex; index += 1) {
    const mid = instances[index]
    if (mid.clef !== from.clef) {
      continue
    }
    // Chord mates at the destination onset are not intervening attacks.
    if (
      mid.measureNumber === to.measureNumber &&
      mid.startDivision === to.startDivision
    ) {
      continue
    }
    if (isLaterOnset(from, mid) && isLaterOnset(mid, to)) {
      return true
    }
  }
  return false
}

function findNextSamePitchInstance(instances, fromIndex) {
  const current = instances[fromIndex]
  for (let index = fromIndex + 1; index < instances.length; index += 1) {
    const candidate = instances[index]
    if (candidate.clef !== current.clef) {
      continue
    }
    if (candidate.midi !== current.midi) {
      continue
    }
    if (!isLaterOnset(current, candidate)) {
      continue
    }
    if (hasInterveningOnset(instances, fromIndex, index)) {
      continue
    }
    return { instance: candidate, index }
  }
  return null
}

function staffGapPx(fromNote, measureBox, imageData) {
  const staffLines = measureBox?.staffLines
  const lineYs =
    fromNote?.lineYs ??
    (fromNote?.clef === 'bass' ? staffLines?.bass : staffLines?.treble) ??
    staffLines?.treble
  if (Array.isArray(lineYs) && lineYs.length >= 2) {
    const sorted = [...lineYs].sort((left, right) => left - right)
    const gaps = []
    for (let index = 1; index < sorted.length; index += 1) {
      gaps.push((sorted[index] - sorted[index - 1]) * imageData.height)
    }
    gaps.sort((left, right) => left - right)
    const median = gaps[Math.floor(gaps.length / 2)]
    if (Number.isFinite(median) && median > 4) {
      return median
    }
  }
  return 11
}

function curveEndpointCandidates({
  endpoint,
  curve,
  role,
  instances,
  measureBoxByNumber,
  imageData,
}) {
  if (!Number.isFinite(endpoint?.x) || !Number.isFinite(endpoint?.y)) {
    return []
  }
  const candidates = []
  for (const instance of instances) {
    if (!Number.isFinite(instance.cx) || !Number.isFinite(instance.cy)) {
      continue
    }
    const box = measureBoxByNumber.get(instance.measureNumber)
    const gap = staffGapPx(instance, box, imageData)
    const maxDx = Math.max(13, Math.min(28, gap * 2.25))
    const maxDy = Math.max(11, Math.min(30, gap * 2.35))
    const dx = Math.abs(instance.cx - endpoint.x)
    const stemDirection =
      typeof instance.stem === 'string' ? instance.stem : instance.stem?.direction
    const stemLength =
      typeof instance.stem === 'object' && Number.isFinite(instance.stem?.length)
        ? instance.stem.length
        : null
    const stemTipY =
      stemLength != null && (stemDirection === 'up' || stemDirection === 'down')
        ? instance.cy + (stemDirection === 'up' ? -stemLength : stemLength)
        : null
    const noteheadDy = Math.abs(instance.cy - endpoint.y)
    const mayAttachStemTip = !curveLooksTieLike(
      curve,
      instance,
      measureBoxByNumber,
      imageData,
    )
    const stemTipDy =
      stemTipY == null || !mayAttachStemTip
        ? Infinity
        : Math.abs(stemTipY - endpoint.y)
    const anchor = stemTipDy < noteheadDy ? 'stem-tip' : 'notehead'
    const dy = Math.min(noteheadDy, stemTipDy)
    if (dx > maxDx || dy > maxDy) {
      continue
    }

    // A PDF lens starts at the source head and travels right, then finishes at
    // the destination head. Directional x gating prevents a system-start
    // continuation fragment from attaching both endpoints to its first note.
    const directionTolerance = Math.max(5, Math.min(9, gap * 0.75))
    if (role === 'start' && instance.cx - endpoint.x > directionTolerance) {
      continue
    }
    if (role === 'end' && endpoint.x - instance.cx > directionTolerance) {
      continue
    }

    // Endpoint tangent is deliberately part of attachment confidence. Closed
    // tie/slur lenses travel horizontally into and out of their noteheads.
    const tangentX = endpoint.tangent?.dx ?? 1
    const tangentPenalty = tangentX < 0.35 ? (0.35 - tangentX) * 18 : 0
    const score = dx * 2.4 + dy + tangentPenalty
    candidates.push({
      instance,
      score,
      dx,
      dy,
      anchor,
      anchorY: anchor === 'stem-tip' ? stemTipY : instance.cy,
      tangentX,
    })
  }
  return candidates.sort(
    (left, right) =>
      left.score - right.score ||
      left.instance.measureNumber - right.instance.measureNumber ||
      left.instance.startDivision - right.instance.startDivision ||
      left.instance.midi - right.instance.midi,
  )
}

function attachmentDiagnostic(candidate) {
  if (!candidate) {
    return null
  }
  return {
    measureNumber: candidate.instance.measureNumber,
    systemIndex: candidate.instance.systemIndex,
    eventIndex: candidate.instance.eventIndex,
    noteIndex: candidate.instance.noteIndex,
    startDivision: candidate.instance.startDivision,
    midi: candidate.instance.midi,
    clef: candidate.instance.clef,
    cx: candidate.instance.cx,
    cy: candidate.instance.cy,
    score: Number(candidate.score.toFixed(2)),
    dx: Number(candidate.dx.toFixed(2)),
    dy: Number(candidate.dy.toFixed(2)),
    anchor: candidate.anchor,
    anchorY: candidate.anchorY,
  }
}

function instanceReference(instance) {
  return {
    measureNumber: instance.measureNumber,
    page: instance.page,
    systemIndex: instance.systemIndex,
    eventIndex: instance.eventIndex,
    noteIndex: instance.noteIndex,
    startDivision: instance.startDivision,
    midi: instance.midi,
    clef: instance.clef,
    cx: instance.cx,
    cy: instance.cy,
  }
}

function curveDiagnostic(curve, startCandidates, endCandidates) {
  return {
    candidateId: curve.candidateId,
    source: curve.source,
    page: curve.page ?? null,
    start: curve.start,
    end: curve.end,
    bounds: curve.bounds,
    archDirection: curve.archDirection,
    startCandidates: startCandidates.slice(0, 4).map(attachmentDiagnostic),
    endCandidates: endCandidates.slice(0, 4).map(attachmentDiagnostic),
    selectedStart: null,
    selectedEnd: null,
    classification: 'unresolved',
    failureReason: null,
  }
}

function nextOnsetIsDirect(instances, from, to) {
  return !hasInterveningOnset(instances, from.instanceIndex, to.instanceIndex)
}

function curveLooksTieLike(curve, note, measureBoxByNumber, imageData) {
  const box = measureBoxByNumber.get(note.measureNumber)
  const gap = staffGapPx(note, box, imageData)
  const width = curve?.bounds?.width ?? Math.abs((curve?.end?.x ?? 0) - (curve?.start?.x ?? 0))
  const height = curve?.bounds?.height ?? 0
  const endpointDelta = Math.abs((curve?.start?.y ?? 0) - (curve?.end?.y ?? 0))
  return (
    width <= gap * 22 &&
    height <= gap * 1.75 &&
    endpointDelta <= gap * 0.8
  )
}

/**
 * Prefer same-pitch, same-clef, forward-onset attachments so stacked chord
 * heads each claim their own curve instead of collapsing onto one note.
 */
function selectBestCurveEndpointPair(startCandidates, endCandidates) {
  let best = null
  const starts = startCandidates.slice(0, TIE_ENDPOINT_CANDIDATE_LIMIT)
  const ends = endCandidates.slice(0, TIE_ENDPOINT_CANDIDATE_LIMIT)
  for (const start of starts) {
    for (const end of ends) {
      if (start.instance.instanceIndex === end.instance.instanceIndex) {
        continue
      }
      if (!isLaterOnset(start.instance, end.instance)) {
        continue
      }
      if ((start.instance.clef ?? 'treble') !== (end.instance.clef ?? 'treble')) {
        continue
      }
      const samePitch = start.instance.midi === end.instance.midi
      const sameVoice =
        start.instance.voice == null ||
        end.instance.voice == null ||
        start.instance.voice === end.instance.voice
      const total =
        start.score +
        end.score +
        (samePitch ? 0 : 12) +
        (sameVoice ? 0 : 8)
      if (
        !best ||
        total < best.total ||
        (total === best.total && samePitch && !best.samePitch)
      ) {
        best = { start, end, total, samePitch }
      }
    }
  }
  return best
}

function classifyCurvePair(
  instances,
  from,
  to,
  curve,
  measureBoxByNumber,
  imageData,
) {
  if (!from || !to) {
    return { classification: 'diagnostic', failureReason: 'missing-endpoint' }
  }
  if (from.systemIndex !== to.systemIndex) {
    return { classification: 'diagnostic', failureReason: 'cross-system-unsplit-path' }
  }
  if (from.clef !== to.clef) {
    return { classification: 'diagnostic', failureReason: 'cross-staff-without-evidence' }
  }
  if (!isLaterOnset(from, to)) {
    return { classification: 'diagnostic', failureReason: 'non-forward-onset' }
  }
  const tieLike = curveLooksTieLike(curve, from, measureBoxByNumber, imageData)
  if (
    from.midi === to.midi &&
    (tieLike || nextOnsetIsDirect(instances, from, to))
  ) {
    return { classification: 'tie', failureReason: null }
  }
  if (tieLike && from.midi !== to.midi) {
    return {
      classification: 'diagnostic',
      failureReason: 'tie-like-curve-with-pitch-mismatch',
    }
  }
  return { classification: 'slur', failureReason: null }
}

function systemHorizontalBounds(measureBoxByNumber, imageData) {
  const grouped = new Map()
  for (const box of measureBoxByNumber.values()) {
    const systemIndex = box.systemIndex
    if (!Number.isFinite(systemIndex)) {
      continue
    }
    const x0 = (box.playableX0 ?? box.x0) * imageData.width
    const x1 = box.x1 * imageData.width
    const current = grouped.get(systemIndex) ?? { x0: Infinity, x1: -Infinity }
    current.x0 = Math.min(current.x0, x0)
    current.x1 = Math.max(current.x1, x1)
    grouped.set(systemIndex, current)
  }
  return grouped
}

function isAtSystemEdge(endpoint, edge, bounds, imageData) {
  if (!bounds || !Number.isFinite(endpoint?.x)) {
    return false
  }
  const tolerance = Math.max(18, imageData.width * 0.025)
  return edge === 'left'
    ? endpoint.x <= bounds.x0 + tolerance
    : endpoint.x >= bounds.x1 - tolerance
}

function isAtMeasureEdge(endpoint, edge, measureBox, imageData) {
  if (!measureBox || !Number.isFinite(endpoint?.x)) {
    return false
  }
  const width = imageData.width
  const x0 = (measureBox.playableX0 ?? measureBox.x0) * width
  const x1 = measureBox.x1 * width
  const tolerance = Math.max(10, width * 0.016)
  return edge === 'left'
    ? endpoint.x <= x0 + tolerance
    : endpoint.x >= x1 - tolerance
}

/**
 * Cross-bar written ties usually land on the same beat in the next measure, or
 * on the first beat of the next system when the source is the last beat.
 */
function isStructuralCrossBarPair(from, to) {
  if ((from.clef ?? 'treble') !== (to.clef ?? 'treble')) {
    return false
  }
  if (to.measureNumber === from.measureNumber + 1) {
    if (
      from.systemIndex != null &&
      to.systemIndex != null &&
      from.systemIndex !== to.systemIndex
    ) {
      return to.startDivision === 0 && (from.startDivision ?? 0) >= 8
    }
    return to.startDivision === from.startDivision
  }
  if (
    from.systemIndex != null &&
    to.systemIndex != null &&
    to.systemIndex > from.systemIndex &&
    to.startDivision === 0 &&
    (from.startDivision ?? 0) >= 8
  ) {
    return true
  }
  return false
}

function findCrossBarTieDestination(instances, from) {
  const nextMeasure = from.measureNumber + 1
  const sameMeasureCandidates = instances.filter(
    (candidate) =>
      candidate.clef === from.clef &&
      candidate.measureNumber === nextMeasure &&
      (from.systemIndex == null || candidate.systemIndex === from.systemIndex) &&
      candidate.startDivision === from.startDivision,
  )
  if (sameMeasureCandidates.length === 1) {
    return sameMeasureCandidates[0]
  }
  if (sameMeasureCandidates.length > 1) {
    return [...sameMeasureCandidates].sort(
      (left, right) =>
        Math.abs(left.cy - from.cy) - Math.abs(right.cy - from.cy) ||
        left.midi - right.midi,
    )[0]
  }

  const nextMeasureStartCandidates = instances.filter(
    (candidate) =>
      candidate.clef === from.clef &&
      candidate.measureNumber === nextMeasure &&
      candidate.startDivision === 0,
  )
  if (nextMeasureStartCandidates.length === 1) {
    return nextMeasureStartCandidates[0]
  }
  if (nextMeasureStartCandidates.length > 1) {
    return [...nextMeasureStartCandidates].sort(
      (left, right) =>
        Math.abs(left.cy - from.cy) - Math.abs(right.cy - from.cy) ||
        left.midi - right.midi,
    )[0]
  }

  const nextSystemCandidates = instances.filter(
    (candidate) =>
      candidate.clef === from.clef &&
      from.systemIndex != null &&
      candidate.systemIndex != null &&
      candidate.systemIndex > from.systemIndex &&
      candidate.measureNumber > from.measureNumber &&
      candidate.startDivision === 0,
  )
  if (nextSystemCandidates.length === 1) {
    return nextSystemCandidates[0]
  }
  if (nextSystemCandidates.length > 1) {
    return [...nextSystemCandidates].sort(
      (left, right) =>
        left.measureNumber - right.measureNumber ||
        left.systemIndex - right.systemIndex ||
        Math.abs(left.cy - from.cy) - Math.abs(right.cy - from.cy),
    )[0]
  }

  return findNextSamePitchInstance(instances, from.instanceIndex)?.instance ?? null
}

function classifyCrossBarCurvePair(instances, from, to, curve, measureBoxByNumber, imageData) {
  if (!from || !to) {
    return { classification: 'diagnostic', failureReason: 'missing-cross-bar-endpoint' }
  }
  if (!isLaterOnset(from, to)) {
    return { classification: 'diagnostic', failureReason: 'non-forward-onset' }
  }
  const tieLike = curveLooksTieLike(curve, from, measureBoxByNumber, imageData)
  if (
    isStructuralCrossBarPair(from, to) &&
    (tieLike || from.midi === to.midi || nextOnsetIsDirect(instances, from, to))
  ) {
    return { classification: 'tie', failureReason: null, allowPitchMismatch: from.midi !== to.midi }
  }
  if (tieLike && from.midi !== to.midi && !isStructuralCrossBarPair(from, to)) {
    return {
      classification: 'diagnostic',
      failureReason: 'tie-like-curve-with-pitch-mismatch',
    }
  }
  return { classification: 'slur', failureReason: null }
}

function classifyStitchedCurvePair(
  instances,
  from,
  to,
  outgoingCurve,
  incomingCurve,
  measureBoxByNumber,
  imageData,
) {
  if (!from || !to) {
    return { classification: 'diagnostic', failureReason: 'missing-fragment-attachment' }
  }
  if (to.systemIndex !== from.systemIndex + 1) {
    return { classification: 'diagnostic', failureReason: 'non-adjacent-system-fragments' }
  }
  if (from.clef !== to.clef) {
    return { classification: 'diagnostic', failureReason: 'cross-staff-without-evidence' }
  }
  if (!isLaterOnset(from, to)) {
    return { classification: 'diagnostic', failureReason: 'non-forward-onset' }
  }
  const tieLike =
    curveLooksTieLike(outgoingCurve, from, measureBoxByNumber, imageData) &&
    curveLooksTieLike(incomingCurve, to, measureBoxByNumber, imageData)
  if (
    from.midi === to.midi &&
    (tieLike || nextOnsetIsDirect(instances, from, to))
  ) {
    return { classification: 'tie', failureReason: null }
  }
  if (
    tieLike &&
    isStructuralCrossBarPair(from, to) &&
    (nextOnsetIsDirect(instances, from, to) || isLaterOnset(from, to))
  ) {
    return {
      classification: 'tie',
      failureReason: null,
      allowPitchMismatch: from.midi !== to.midi,
    }
  }
  if (tieLike && from.midi !== to.midi) {
    return {
      classification: 'diagnostic',
      failureReason: 'tie-like-curve-with-pitch-mismatch',
    }
  }
  return { classification: 'slur', failureReason: null }
}

function collectPdfVectorCurvePairs({
  vectorCurves,
  instances,
  measureBoxByNumber,
  imageData,
}) {
  const diagnostics = []
  const directPairs = []
  const outgoingFragments = []
  const incomingFragments = []
  const measureOutgoingFragments = []
  const measureIncomingFragments = []
  const systemBounds = systemHorizontalBounds(measureBoxByNumber, imageData)

  for (const curve of vectorCurves) {
    const startCandidates = curveEndpointCandidates({
      endpoint: curve.start,
      curve,
      role: 'start',
      instances,
      measureBoxByNumber,
      imageData,
    })
    const endCandidates = curveEndpointCandidates({
      endpoint: curve.end,
      curve,
      role: 'end',
      instances,
      measureBoxByNumber,
      imageData,
    })
    const diagnostic = curveDiagnostic(curve, startCandidates, endCandidates)
    diagnostics.push(diagnostic)
    const selected = selectBestCurveEndpointPair(startCandidates, endCandidates)
    const start = selected?.start?.instance ?? null
    const end = selected?.end?.instance ?? null

    if (start && end && start.instanceIndex !== end.instanceIndex) {
      const decision = classifyCurvePair(
        instances,
        start,
        end,
        curve,
        measureBoxByNumber,
        imageData,
      )
      diagnostic.selectedStart = attachmentDiagnostic(selected.start)
      diagnostic.selectedEnd = attachmentDiagnostic(selected.end)
      diagnostic.classification = decision.classification
      diagnostic.failureReason = decision.failureReason
      if (decision.classification === 'tie' || decision.classification === 'slur') {
        const spanPx = Math.abs((end.cx ?? 0) - (start.cx ?? 0))
        directPairs.push({
          from: start,
          to: end,
          source: 'pdf-vector-path',
          candidateIds: [curve.candidateId],
          archDirection: curve.archDirection,
          classification: decision.classification,
          matchScore: selected.total + spanPx * 0.2,
        })
      }
      continue
    }

    const nearestStart = startCandidates[0]?.instance ?? null
    const nearestEnd = endCandidates[0]?.instance ?? null
    if (
      nearestStart &&
      nearestEnd &&
      nearestStart.instanceIndex !== nearestEnd.instanceIndex
    ) {
      diagnostic.selectedStart = attachmentDiagnostic(startCandidates[0])
      diagnostic.selectedEnd = attachmentDiagnostic(endCandidates[0])
      diagnostic.failureReason = 'no-valid-endpoint-pair'
      continue
    }

    if (nearestStart) {
      const startBox = measureBoxByNumber.get(nearestStart.measureNumber)
      if (startBox && isAtMeasureEdge(curve.end, 'right', startBox, imageData)) {
        diagnostic.selectedStart = attachmentDiagnostic(startCandidates[0])
        diagnostic.classification = 'outgoing-measure-fragment'
        measureOutgoingFragments.push({ curve, attachment: startCandidates[0], diagnostic })
        continue
      }
      const bounds = systemBounds.get(nearestStart.systemIndex)
      if (isAtSystemEdge(curve.end, 'right', bounds, imageData)) {
        diagnostic.selectedStart = attachmentDiagnostic(startCandidates[0])
        diagnostic.classification = 'outgoing-system-fragment'
        outgoingFragments.push({ curve, attachment: startCandidates[0], diagnostic })
        continue
      }
      const tieLike = curveLooksTieLike(
        curve,
        nearestStart,
        measureBoxByNumber,
        imageData,
      )
      const nextSamePitch = findNextSamePitchInstance(
        instances,
        nearestStart.instanceIndex,
      )?.instance
      if (
        tieLike &&
        nextSamePitch &&
        nextSamePitch.measureNumber === nearestStart.measureNumber &&
        isLaterOnset(nearestStart, nextSamePitch)
      ) {
        const decision = classifyCurvePair(
          instances,
          nearestStart,
          nextSamePitch,
          curve,
          measureBoxByNumber,
          imageData,
        )
        if (decision.classification === 'tie') {
          diagnostic.selectedStart = attachmentDiagnostic(startCandidates[0])
          diagnostic.selectedEnd = {
            measureNumber: nextSamePitch.measureNumber,
            midi: nextSamePitch.midi,
          }
          diagnostic.classification = 'tie'
          diagnostic.failureReason = null
          directPairs.push({
            from: nearestStart,
            to: nextSamePitch,
            source: 'pdf-vector-path',
            candidateIds: [curve.candidateId],
            archDirection: curve.archDirection,
            classification: 'tie',
            matchScore: startCandidates[0].score + 8,
          })
          continue
        }
      }
    }
    if (nearestEnd) {
      const endBox = measureBoxByNumber.get(nearestEnd.measureNumber)
      if (endBox && isAtMeasureEdge(curve.start, 'left', endBox, imageData)) {
        diagnostic.selectedEnd = attachmentDiagnostic(endCandidates[0])
        diagnostic.classification = 'incoming-measure-fragment'
        measureIncomingFragments.push({ curve, attachment: endCandidates[0], diagnostic })
        continue
      }
      const bounds = systemBounds.get(nearestEnd.systemIndex)
      if (isAtSystemEdge(curve.start, 'left', bounds, imageData)) {
        diagnostic.selectedEnd = attachmentDiagnostic(endCandidates[0])
        diagnostic.classification = 'incoming-system-fragment'
        incomingFragments.push({ curve, attachment: endCandidates[0], diagnostic })
        continue
      }
    }

    diagnostic.failureReason =
      nearestStart || nearestEnd ? 'orphan-curve-endpoint' : 'no-note-endpoint-attachment'
  }

  const stitchedPairs = []
  const possibleStitches = []
  for (const outgoing of outgoingFragments) {
    for (const incoming of incomingFragments) {
      const from = outgoing.attachment.instance
      const to = incoming.attachment.instance
      const decision = classifyStitchedCurvePair(
        instances,
        from,
        to,
        outgoing.curve,
        incoming.curve,
        measureBoxByNumber,
        imageData,
      )
      if (decision.classification !== 'tie' && decision.classification !== 'slur') {
        continue
      }
      const sourceOffset = outgoing.curve.start.y - from.cy
      const destinationOffset = incoming.curve.end.y - to.cy
      const sideMismatch =
        outgoing.curve.archDirection === incoming.curve.archDirection ? 0 : 24
      const pitchPenalty = from.midi === to.midi ? 0 : Math.abs(from.midi - to.midi) * 0.4
      possibleStitches.push({
        outgoing,
        incoming,
        decision,
        score: Math.abs(sourceOffset - destinationOffset) * 1.5 + sideMismatch + pitchPenalty,
      })
    }
  }
  possibleStitches.sort((left, right) => left.score - right.score)
  const usedOutgoing = new Set()
  const usedIncoming = new Set()
  for (const stitch of possibleStitches) {
    if (
      usedOutgoing.has(stitch.outgoing.curve.candidateId) ||
      usedIncoming.has(stitch.incoming.curve.candidateId)
    ) {
      continue
    }
    usedOutgoing.add(stitch.outgoing.curve.candidateId)
    usedIncoming.add(stitch.incoming.curve.candidateId)
    const from = stitch.outgoing.attachment.instance
    const to = stitch.incoming.attachment.instance
    stitch.outgoing.diagnostic.classification = `${stitch.decision.classification}-start-fragment`
    stitch.outgoing.diagnostic.failureReason = null
    stitch.outgoing.diagnostic.selectedEnd = attachmentDiagnostic(stitch.incoming.attachment)
    stitch.incoming.diagnostic.classification = `${stitch.decision.classification}-stop-fragment`
    stitch.incoming.diagnostic.failureReason = null
    stitch.incoming.diagnostic.selectedStart = attachmentDiagnostic(stitch.outgoing.attachment)
    stitchedPairs.push({
      from,
      to,
      source: 'pdf-vector-path-system-continuation',
      candidateIds: [
        stitch.outgoing.curve.candidateId,
        stitch.incoming.curve.candidateId,
      ],
      archDirection: stitch.outgoing.curve.archDirection,
      classification: stitch.decision.classification,
      matchScore: stitch.score,
    })
  }

  for (const fragment of [...outgoingFragments, ...incomingFragments]) {
    const used =
      usedOutgoing.has(fragment.curve.candidateId) ||
      usedIncoming.has(fragment.curve.candidateId)
    if (!used) {
      fragment.diagnostic.failureReason = 'orphan-system-fragment'
    }
  }

  const usedMeasureOutgoing = new Set()
  const usedMeasureIncoming = new Set()
  for (const outgoing of measureOutgoingFragments) {
    const from = outgoing.attachment.instance
    let matched = false
    for (const incoming of measureIncomingFragments) {
      if (
        usedMeasureOutgoing.has(outgoing.curve.candidateId) ||
        usedMeasureIncoming.has(incoming.curve.candidateId)
      ) {
        continue
      }
      const to = incoming.attachment.instance
      const decision = classifyCrossBarCurvePair(
        instances,
        from,
        to,
        outgoing.curve,
        measureBoxByNumber,
        imageData,
      )
      if (decision.classification !== 'tie' && decision.classification !== 'slur') {
        continue
      }
      usedMeasureOutgoing.add(outgoing.curve.candidateId)
      usedMeasureIncoming.add(incoming.curve.candidateId)
      outgoing.diagnostic.classification = `${decision.classification}-measure-start-fragment`
      outgoing.diagnostic.failureReason = null
      incoming.diagnostic.classification = `${decision.classification}-measure-stop-fragment`
      incoming.diagnostic.failureReason = null
      stitchedPairs.push({
        from,
        to,
        source: 'pdf-vector-path-measure-continuation',
        candidateIds: [outgoing.curve.candidateId, incoming.curve.candidateId],
        archDirection: outgoing.curve.archDirection,
        classification: decision.classification,
        allowPitchMismatch: Boolean(decision.allowPitchMismatch),
        matchScore: 12,
      })
      matched = true
      break
    }
    if (matched || usedMeasureOutgoing.has(outgoing.curve.candidateId)) {
      continue
    }
    const inferred = findCrossBarTieDestination(instances, from)
    if (!inferred) {
      outgoing.diagnostic.failureReason = 'orphan-measure-fragment'
      continue
    }
    const decision = classifyCrossBarCurvePair(
      instances,
      from,
      inferred,
      outgoing.curve,
      measureBoxByNumber,
      imageData,
    )
    if (decision.classification !== 'tie' && decision.classification !== 'slur') {
      outgoing.diagnostic.failureReason = 'orphan-measure-fragment'
      continue
    }
    usedMeasureOutgoing.add(outgoing.curve.candidateId)
    outgoing.diagnostic.classification = `${decision.classification}-measure-start-fragment`
    outgoing.diagnostic.failureReason = null
    outgoing.diagnostic.selectedEnd = attachmentDiagnostic({
      instance: inferred,
      score: 0,
      dx: 0,
      dy: 0,
      anchor: 'notehead',
      anchorY: inferred.cy,
    })
    stitchedPairs.push({
      from,
      to: inferred,
      source: 'pdf-vector-path-measure-continuation',
      candidateIds: [outgoing.curve.candidateId],
      archDirection: outgoing.curve.archDirection,
      classification: decision.classification,
      allowPitchMismatch: Boolean(decision.allowPitchMismatch),
      matchScore: 14,
    })
  }
  for (const incoming of measureIncomingFragments) {
    if (!usedMeasureIncoming.has(incoming.curve.candidateId)) {
      incoming.diagnostic.failureReason = 'orphan-measure-fragment'
    }
  }

  for (const outgoing of outgoingFragments) {
    if (usedOutgoing.has(outgoing.curve.candidateId)) {
      continue
    }
    const from = outgoing.attachment.instance
    const inferred = findCrossBarTieDestination(instances, from)
    if (!inferred) {
      continue
    }
    const decision = classifyCrossBarCurvePair(
      instances,
      from,
      inferred,
      outgoing.curve,
      measureBoxByNumber,
      imageData,
    )
    if (decision.classification !== 'tie' && decision.classification !== 'slur') {
      continue
    }
    usedOutgoing.add(outgoing.curve.candidateId)
    outgoing.diagnostic.classification = `${decision.classification}-system-start-fragment`
    outgoing.diagnostic.failureReason = null
    stitchedPairs.push({
      from,
      to: inferred,
      source: 'pdf-vector-path-system-continuation',
      candidateIds: [outgoing.curve.candidateId],
      archDirection: outgoing.curve.archDirection,
      classification: decision.classification,
      allowPitchMismatch: Boolean(decision.allowPitchMismatch),
      matchScore: 16,
    })
  }

  const systemIndices = instances
    .map((instance) => instance.systemIndex)
    .filter(Number.isFinite)
  const lastSystemIndex = systemIndices.length ? Math.max(...systemIndices) : null
  const openFragments = []
  for (const fragment of outgoingFragments) {
    if (
      !usedOutgoing.has(fragment.curve.candidateId) &&
      fragment.attachment.instance.systemIndex === lastSystemIndex
    ) {
      fragment.diagnostic.classification = 'outgoing-page-fragment'
      fragment.diagnostic.failureReason = null
      openFragments.push({
        role: 'start',
        page: fragment.curve.page,
        candidateId: fragment.curve.candidateId,
        archDirection: fragment.curve.archDirection,
        tieLike: curveLooksTieLike(
          fragment.curve,
          fragment.attachment.instance,
          measureBoxByNumber,
          imageData,
        ),
        ref: instanceReference(fragment.attachment.instance),
        endpointOffset:
          fragment.curve.start.y - fragment.attachment.anchorY,
      })
    }
  }
  for (const fragment of incomingFragments) {
    if (
      !usedIncoming.has(fragment.curve.candidateId) &&
      fragment.attachment.instance.systemIndex === 0
    ) {
      fragment.diagnostic.classification = 'incoming-page-fragment'
      fragment.diagnostic.failureReason = null
      openFragments.push({
        role: 'stop',
        page: fragment.curve.page,
        candidateId: fragment.curve.candidateId,
        archDirection: fragment.curve.archDirection,
        tieLike: curveLooksTieLike(
          fragment.curve,
          fragment.attachment.instance,
          measureBoxByNumber,
          imageData,
        ),
        ref: instanceReference(fragment.attachment.instance),
        endpointOffset:
          fragment.curve.end.y - fragment.attachment.anchorY,
      })
    }
  }

  return {
    tiePairs: [...directPairs, ...stitchedPairs].filter(
      (pair) => pair.classification === 'tie',
    ),
    slurPairs: [...directPairs, ...stitchedPairs].filter(
      (pair) => pair.classification === 'slur',
    ),
    diagnostics,
    openFragments,
  }
}

export function crossMeasureInkArcSegments(fromNote, toNote, fromMeasureBox, toMeasureBox, imageData) {
  const width = imageData.width
  return {
    seg1Start: Math.ceil(fromNote.cx + 8),
    seg1End: Math.floor(fromMeasureBox.x1 * width - 5),
    seg2Start: Math.ceil((toMeasureBox.playableX0 ?? toMeasureBox.x0) * width + 5),
    seg2End: Math.floor(toNote.cx - 8),
  }
}

/**
 * Probe one horizontal ink-arc window between two noteheads.
 * Exported for tie ink-arc diagnostics.
 */
export function probeInkArcWindow(
  imageData,
  fromNote,
  toNote,
  xStart,
  xEnd,
  measureBox,
  inkThreshold,
) {
  if (xEnd - xStart < 6) {
    return {
      passes: false,
      side: null,
      xStart,
      xEnd,
      columns: 0,
      midColumns: 0,
      covered: { below: 0, above: 0 },
      midCovered: { below: 0, above: 0 },
    }
  }

  const yMid = (fromNote.cy + toNote.cy) / 2
  const gap = staffGapPx(fromNote, measureBox, imageData)
  // Stay close to the noteheads. Wider bands pick up primary beams at stem
  // tips and flood incorrect-tie on clean beamed vector scores.
  const bandMin = 2
  const bandMax = Math.max(5, Math.round(gap * 0.95))

  const continuousRows = new Set()
  for (let offset = -(bandMax + 1); offset <= bandMax + 1; offset += 1) {
    const y = Math.round(yMid + offset)
    let inked = 0
    let total = 0
    for (let x = xStart; x <= xEnd; x += 1) {
      total += 1
      if (inkAt(imageData, x, y, inkThreshold)) {
        inked += 1
      }
    }
    if (total && inked / total >= 0.85) {
      continuousRows.add(y)
    }
  }
  const nearLineRow = (y) => {
    const row = Math.round(y)
    return (
      continuousRows.has(row) ||
      continuousRows.has(row - 1) ||
      continuousRows.has(row + 1)
    )
  }

  const midStart = xStart + (xEnd - xStart) / 3
  const midEnd = xEnd - (xEnd - xStart) / 3
  let columns = 0
  let midColumns = 0
  const covered = { below: 0, above: 0 }
  const midCovered = { below: 0, above: 0 }
  const inkYs = { below: [], above: [] }
  for (let x = xStart; x <= xEnd; x += 1) {
    columns += 1
    const inMiddle = x >= midStart && x <= midEnd
    if (inMiddle) {
      midColumns += 1
    }
    let belowY = null
    let aboveY = null
    for (let offset = bandMin; offset <= bandMax; offset += 1) {
      if (
        belowY == null &&
        !nearLineRow(yMid + offset) &&
        inkAt(imageData, x, yMid + offset, inkThreshold)
      ) {
        belowY = yMid + offset
      }
      if (
        aboveY == null &&
        !nearLineRow(yMid - offset) &&
        inkAt(imageData, x, yMid - offset, inkThreshold)
      ) {
        aboveY = yMid - offset
      }
      if (belowY != null && aboveY != null) {
        break
      }
    }
    if (belowY != null) {
      covered.below += 1
      inkYs.below.push(belowY)
      if (inMiddle) {
        midCovered.below += 1
      }
    }
    if (aboveY != null) {
      covered.above += 1
      inkYs.above.push(aboveY)
      if (inMiddle) {
        midCovered.above += 1
      }
    }
  }
  if (!columns || !midColumns) {
    return {
      passes: false,
      side: null,
      xStart,
      xEnd,
      columns,
      midColumns,
      covered,
      midCovered,
    }
  }

  const sidePasses = (side) =>
    covered[side] / columns >= 0.5 && midCovered[side] / midColumns >= 0.75
  // Ties bow; flat primary beams stay near-constant in y across the gap.
  const sideCurves = (side) => {
    const ys = inkYs[side]
    if (ys.length < 4) {
      return false
    }
    let minY = ys[0]
    let maxY = ys[0]
    for (let index = 1; index < ys.length; index += 1) {
      minY = Math.min(minY, ys[index])
      maxY = Math.max(maxY, ys[index])
    }
    return maxY - minY >= 2
  }
  let side = null
  if (sidePasses('below') && sideCurves('below')) {
    side = 'below'
  } else if (sidePasses('above') && sideCurves('above')) {
    side = 'above'
  }
  return {
    passes: side != null,
    side,
    xStart,
    xEnd,
    columns,
    midColumns,
    covered,
    midCovered,
  }
}

/**
 * A tie is a thin arc that spans the whole gap between two noteheads. Require
 * continuous column coverage inside the inter-note window on one consistent
 * side instead of a raw ink count: stems (one column) and fingering digits
 * (narrow) no longer read as ties. Rows that are continuous ink across the
 * whole window (staff lines) are measured empirically and excluded — an arc
 * curves, so it never lives on one single pixel row.
 *
 * Short gaps must use the same column-continuity probe. The old detectTieToNext
 * ink-count box (any 5–40 dark pixels near the head) false-fired on beams,
 * ledgers, and scan noise and flooded incorrect-tie on articulation scans.
 */
export function detectInkArcBetween(imageData, fromNote, toNote, measureBox, inkThreshold) {
  const dx = Math.abs(toNote.cx - fromNote.cx)
  const maxSpan =
    fromNote.measureNumber === toNote.measureNumber
      ? MAX_SAME_MEASURE_TIE_PX
      : MAX_CROSS_MEASURE_TIE_PX
  if (dx > maxSpan) {
    return false
  }

  // Keep an 8px inset so notehead blobs themselves do not satisfy coverage.
  // Spans too short for a real curved arc simply fail (no detectTieToNext fallback).
  const xStart = Math.ceil(Math.min(fromNote.cx, toNote.cx) + 8)
  const xEnd = Math.floor(Math.max(fromNote.cx, toNote.cx) - 8)
  if (xEnd - xStart < 6) {
    return false
  }

  return probeInkArcWindow(
    imageData,
    fromNote,
    toNote,
    xStart,
    xEnd,
    measureBox,
    inkThreshold,
  ).passes
}

function canTieNotePair(fromNote, toNote) {
  return (
    Number.isFinite(fromNote?.midi) &&
    fromNote.midi === toNote?.midi &&
    (fromNote?.clef ?? 'treble') === (toNote?.clef ?? 'treble')
  )
}

function noteHasStaccato(note) {
  return note?.articulation?.type === 'staccato'
}

function nearestInstance(instances, glyph, imageData) {
  void imageData
  let best = null
  let bestScore = Infinity
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index]
    const dx = Math.abs(instance.cx - glyph.x)
    const dy = Math.abs(instance.cy - glyph.y)
    if (dx > 28 || dy > 18) {
      continue
    }
    const score = dx + dy * 1.5
    if (score < bestScore) {
      bestScore = score
      best = { instance, index }
    }
  }
  return best
}

function pairControlGlyphs(glyphs, instances, imageData, measureBoxByNumber) {
  const begins = []
  const ends = []
  for (const glyph of glyphs) {
    if (glyph.text === TIE_BEGIN_GLYPH) {
      begins.push(glyph)
    } else if (glyph.text === TIE_END_GLYPH) {
      ends.push(glyph)
    }
  }

  const pairs = []
  const usedEnds = new Set()
  for (const begin of begins) {
    let bestEnd = null
    let bestScore = Infinity
    for (const end of ends) {
      if (usedEnds.has(end)) {
        continue
      }
      const dx = end.x - begin.x
      const dy = Math.abs(end.y - begin.y)
      if (dx <= 0 || dx > MAX_CROSS_MEASURE_TIE_PX || dy > 24) {
        continue
      }
      const score = dx + dy * 2
      if (score < bestScore) {
        bestScore = score
        bestEnd = end
      }
    }
    if (!bestEnd) {
      continue
    }
    usedEnds.add(bestEnd)
    const from = nearestInstance(instances, begin, imageData)
    const to = nearestInstance(instances, bestEnd, imageData)
    if (!from || !to || from.index >= to.index) {
      continue
    }
    if (from.instance.midi !== to.instance.midi) {
      continue
    }
    if (from.instance.clef !== to.instance.clef) {
      continue
    }
    pairs.push({
      from: from.instance,
      to: to.instance,
      source: 'control-glyph',
      measureBoxByNumber,
    })
  }
  return pairs
}

/**
 * Pair SMuFL slur begin/end glyphs. Unlike ties, destination pitch may differ.
 */
function pairSlurControlGlyphs(glyphs, instances, imageData) {
  const begins = []
  const ends = []
  for (const glyph of glyphs) {
    if (glyph.text === SLUR_BEGIN_GLYPH) {
      begins.push(glyph)
    } else if (glyph.text === SLUR_END_GLYPH) {
      ends.push(glyph)
    }
  }

  const pairs = []
  const usedEnds = new Set()
  for (const begin of begins) {
    let bestEnd = null
    let bestScore = Infinity
    for (const end of ends) {
      if (usedEnds.has(end)) {
        continue
      }
      const dx = end.x - begin.x
      const dy = Math.abs(end.y - begin.y)
      if (dx <= 0 || dx > MAX_CROSS_MEASURE_TIE_PX || dy > 36) {
        continue
      }
      const score = dx + dy * 2
      if (score < bestScore) {
        bestScore = score
        bestEnd = end
      }
    }
    if (!bestEnd) {
      continue
    }
    usedEnds.add(bestEnd)
    const from = nearestInstance(instances, begin, imageData)
    const to = nearestInstance(instances, bestEnd, imageData)
    if (!from || !to || from.index >= to.index) {
      continue
    }
    if (from.instance.clef !== to.instance.clef) {
      continue
    }
    // Same pitch with slur glyphs is rare; prefer the tie path when pitches match.
    if (from.instance.midi === to.instance.midi) {
      continue
    }
    pairs.push({
      from: from.instance,
      to: to.instance,
      source: 'slur-glyph',
    })
  }
  return pairs
}

/**
 * Same-measure different-pitch ink arcs are slur candidates (not ties).
 */
function collectInkArcSlurPairs(instances, imageData, inkThreshold, measureBoxByNumber, seenKeys) {
  const pairs = []
  for (let index = 0; index < instances.length - 1; index += 1) {
    const current = instances[index]
    const next = instances[index + 1]
    if (current.measureNumber !== next.measureNumber) {
      continue
    }
    if (current.clef !== next.clef) {
      continue
    }
    if (current.midi === next.midi) {
      continue
    }
    if ((current.eventNoteCount ?? 1) !== 1 || (next.eventNoteCount ?? 1) !== 1) {
      continue
    }
    if ((current.beams ?? 0) > 0 || (next.beams ?? 0) > 0) {
      continue
    }
    const key = `${eventRefKey(current)}->${eventRefKey(next)}`
    if (seenKeys.has(key)) {
      continue
    }
    const box = measureBoxByNumber.get(current.measureNumber)
    if (!box) {
      continue
    }
    if (!detectInkArcBetween(imageData, current, next, box, inkThreshold)) {
      continue
    }
    seenKeys.add(key)
    pairs.push({ from: current, to: next, source: 'slur-ink-arc' })
  }
  return pairs
}

function clearInheritedSlurMarks(measureRecords) {
  for (const record of measureRecords) {
    for (const event of record.events ?? []) {
      delete event.slurStart
      delete event.slurStop
      delete event.slurNumber
      delete event.slurPlacement
      for (const note of event.notes ?? []) {
        delete note.slurStart
        delete note.slurStop
        delete note.slurNumber
        delete note.slurPlacement
      }
    }
  }
}

function applySlurMarks(measureRecords, slurPairs) {
  const recordByMeasure = new Map(measureRecords.map((record) => [record.measureNumber, record]))
  const applied = new Set()
  let nextNumber = 1

  for (const pair of slurPairs) {
    const key = `${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`
    if (applied.has(key)) {
      continue
    }
    const fromRecord = recordByMeasure.get(pair.from.measureNumber)
    const toRecord = recordByMeasure.get(pair.to.measureNumber)
    const fromEvent = fromRecord?.events?.[pair.from.eventIndex]
    const toEvent = toRecord?.events?.[pair.to.eventIndex]
    const fromNote = fromEvent?.notes?.[pair.from.noteIndex]
    const toNote = toEvent?.notes?.[pair.to.noteIndex]
    if (!fromEvent || !toEvent || !fromNote || !toNote) {
      continue
    }
    // A phrase slur may legitimately begin/end on a note that also starts or
    // stops a tie. The curve pair itself was already classified above, so
    // sharing an endpoint is not a tie-to-slur conversion.
    const number = String(nextNumber)
    nextNumber += 1
    fromNote.slurStart = true
    fromNote.slurNumber = number
    fromNote.slurPlacement = pair.archDirection ?? null
    toNote.slurStop = true
    toNote.slurNumber = number
    toNote.slurPlacement = pair.archDirection ?? null
    if ((fromEvent.notes?.length ?? 0) === 1) {
      fromEvent.slurStart = true
      fromEvent.slurNumber = number
      fromEvent.slurPlacement = pair.archDirection ?? null
    }
    if ((toEvent.notes?.length ?? 0) === 1) {
      toEvent.slurStop = true
      toEvent.slurNumber = number
      toEvent.slurPlacement = pair.archDirection ?? null
    }
    applied.add(key)
  }

  return applied.size
}

function countUnpairedSlurGlyphs(glyphs) {
  const begins = glyphs.filter((glyph) => glyph.text === SLUR_BEGIN_GLYPH).length
  const ends = glyphs.filter((glyph) => glyph.text === SLUR_END_GLYPH).length
  return Math.abs(begins - ends)
}

function eventRefKey(ref) {
  return `${ref.measureNumber}:${ref.eventIndex}:${ref.noteIndex ?? 0}`
}

function tiePairMatchScore(pair) {
  if (Number.isFinite(pair.matchScore)) {
    return pair.matchScore
  }
  const from = pair.from
  const to = pair.to
  const dx = Math.abs((to.cx ?? 0) - (from.cx ?? 0))
  const dy = Math.abs((to.cy ?? 0) - (from.cy ?? 0))
  const sourceRank =
    pair.source === 'control-glyph'
      ? 0
      : pair.source?.startsWith('pdf-vector-path')
        ? 1
        : pair.source === 'ink-arc'
          ? 3
          : 2
  const voicePenalty =
    from.voice != null && to.voice != null && from.voice !== to.voice ? 8 : 0
  // Prefer locally spanning ties when multiple curves share an endpoint.
  return sourceRank * 20 + dy * 2 + dx * 0.2 + voicePenalty
}

/**
 * Mark tie start/stop on the specific pitch instances, not the whole event.
 * Event-level flags remain as a coarse signal for single-note events only.
 */
function clearInheritedTieMarks(measureRecords) {
  // enrichNoteheadRhythm stamps noisy detectTieToNext flags onto noteheads.
  // Those must not reach MusicXML — only pairs validated below may emit ties.
  for (const record of measureRecords) {
    for (const event of record.events ?? []) {
      delete event.tieStart
      delete event.tieStop
      delete event.tiePlacement
      for (const note of event.notes ?? []) {
        delete note.tieStart
        delete note.tieStop
        delete note.tiePlacement
      }
    }
  }
}

/**
 * Exclusive one-to-one ownership: a note may not be reused by multiple unrelated
 * curves. Prefer the highest-confidence valid pairing; reject ambiguous contests
 * rather than inventing a tie. Distinct chord pitches keep separate ownership.
 */
function applyTieMarks(measureRecords, tiePairs) {
  const recordByMeasure = new Map(measureRecords.map((record) => [record.measureNumber, record]))
  const applied = new Set()
  const usedSource = new Set()
  const usedDestination = new Set()
  const rejected = new Set()

  const candidates = []
  for (const pair of tiePairs) {
    const key = `${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`
    const fromRecord = recordByMeasure.get(pair.from.measureNumber)
    const toRecord = recordByMeasure.get(pair.to.measureNumber)
    const fromEvent = fromRecord?.events?.[pair.from.eventIndex]
    const toEvent = toRecord?.events?.[pair.to.eventIndex]
    const fromNote = fromEvent?.notes?.[pair.from.noteIndex]
    const toNote = toEvent?.notes?.[pair.to.noteIndex]
    if (!fromEvent || !toEvent || !fromNote || !toNote) {
      continue
    }
    if (!canTieNotePair(fromNote, toNote) && !pair.allowPitchMismatch) {
      continue
    }
    // Raster dots remain unsafe tie evidence. An original PDF Bézier is direct
    // curve evidence, however, and must not be discarded because an unrelated
    // dot classifier marked one endpoint as staccato.
    if (
      !pair.source?.startsWith('pdf-vector-path') &&
      (noteHasStaccato(fromNote) || noteHasStaccato(toNote))
    ) {
      continue
    }
    candidates.push({
      pair,
      key,
      fromKey: eventRefKey(pair.from),
      toKey: eventRefKey(pair.to),
      score: tiePairMatchScore(pair),
      fromEvent,
      toEvent,
      fromNote,
      toNote,
    })
  }

  candidates.sort(
    (left, right) =>
      left.score - right.score ||
      left.fromKey.localeCompare(right.fromKey) ||
      left.toKey.localeCompare(right.toKey),
  )

  for (const candidate of candidates) {
    if (rejected.has(candidate.key) || applied.has(candidate.key)) {
      continue
    }
    if (usedSource.has(candidate.fromKey) || usedDestination.has(candidate.toKey)) {
      continue
    }

    const competitors = candidates.filter(
      (other) =>
        other.key !== candidate.key &&
        !rejected.has(other.key) &&
        !applied.has(other.key) &&
        !usedSource.has(other.fromKey) &&
        !usedDestination.has(other.toKey) &&
        (other.fromKey === candidate.fromKey || other.toKey === candidate.toKey) &&
        other.score - candidate.score <= TIE_MATCH_AMBIGUITY_MARGIN,
    )
    if (competitors.length > 0) {
      rejected.add(candidate.key)
      for (const other of competitors) {
        rejected.add(other.key)
      }
      continue
    }

    candidate.fromNote.tieStart = true
    candidate.fromNote.tiePlacement = candidate.pair.archDirection ?? null
    candidate.toNote.tieStop = true
    candidate.toNote.tiePlacement = candidate.pair.archDirection ?? null
    if ((candidate.fromEvent.notes?.length ?? 0) === 1) {
      candidate.fromEvent.tieStart = true
      candidate.fromEvent.tiePlacement = candidate.pair.archDirection ?? null
    }
    if ((candidate.toEvent.notes?.length ?? 0) === 1) {
      candidate.toEvent.tieStop = true
      candidate.toEvent.tiePlacement = candidate.pair.archDirection ?? null
    }
    usedSource.add(candidate.fromKey)
    usedDestination.add(candidate.toKey)
    applied.add(candidate.key)
  }

  return applied.size
}

/**
 * Detect and apply conservative tie links for vector OMR measures.
 * Also applies validated slur pairs (different-pitch curves / slur glyphs).
 */
export function applyVectorPageTies({
  measureRecords = [],
  measureBoxByNumber = new Map(),
  glyphs = [],
  vectorCurves = [],
  imageData = null,
  inkThreshold = 170,
} = {}) {
  const empty = {
    diagnostics: {
      detectedTieCount: 0,
      appliedTieCount: 0,
      appliedTiePairs: [],
      appliedSlurCount: 0,
      uncertainSlurCount: 0,
      tieControlGlyphCount: 0,
      vectorCurveCandidateCount: 0,
      vectorCurveAppliedCount: 0,
      vectorCurveDiagnostics: [],
      openVectorCurveFragments: [],
    },
  }
  if (!measureRecords.length) {
    return empty
  }

  // Drop enrich-time detectTieToNext noise before any pairing. Only validated
  // pairs below may set note/event tie marks for MusicXML emission.
  clearInheritedTieMarks(measureRecords)
  clearInheritedSlurMarks(measureRecords)

  if (!imageData) {
    return empty
  }

  const instances = flattenMeasureNotes(measureRecords)
  const tiePairs = []
  const seen = new Set()
  const pathResult = collectPdfVectorCurvePairs({
    vectorCurves,
    instances,
    measureBoxByNumber,
    imageData,
  })

  for (const pair of pathResult.tiePairs) {
    const key = `${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    tiePairs.push(pair)
  }

  for (const pair of pairControlGlyphs(glyphs, instances, imageData, measureBoxByNumber)) {
    const key = `${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    tiePairs.push(pair)
  }

  const curveGlyphCount = glyphs.filter(
    (glyph) =>
      glyph.text === TIE_BEGIN_GLYPH ||
      glyph.text === TIE_END_GLYPH ||
      glyph.text === SLUR_BEGIN_GLYPH ||
      glyph.text === SLUR_END_GLYPH,
  ).length
  const mayRasterInferCurves = vectorCurves.length === 0 && curveGlyphCount === 0

  for (let index = 0; mayRasterInferCurves && index < instances.length; index += 1) {
    const nextMatch = findNextSamePitchInstance(instances, index)
    if (!nextMatch) {
      continue
    }
    const from = instances[index]
    const to = nextMatch.instance
    const key = `${eventRefKey(from)}->${eventRefKey(to)}`
    if (seen.has(key)) {
      continue
    }
    const box = measureBoxByNumber.get(from.measureNumber) ?? measureBoxByNumber.get(to.measureNumber)
    if (!box) {
      continue
    }
    if (from.measureNumber === to.measureNumber) {
      const measureWidth = (box.x1 - box.x0) * imageData.width
      if (to.cx - from.cx > measureWidth * 0.45) {
        continue
      }
    } else {
      // Cross-bar ink arcs are too easy to confuse with system furniture /
      // ledger noise. Require SMuFL tie glyphs for cross-measure links.
      continue
    }
    // Ink-arc pairing stays monophonic: chord false-arcs (beams/ledgers near
    // stacked heads) previously exploded incorrect-tie once per-pitch marks
    // were enabled. Partial chord ties still come from SMuFL control glyphs.
    if ((from.eventNoteCount ?? 1) !== 1 || (to.eventNoteCount ?? 1) !== 1) {
      continue
    }
    if ((from.beams ?? 0) > 0 || (to.beams ?? 0) > 0) {
      continue
    }
    if (!detectInkArcBetween(imageData, from, to, box, inkThreshold)) {
      continue
    }
    seen.add(key)
    tiePairs.push({ from, to, source: 'ink-arc' })
  }

  const appliedTieCount = applyTieMarks(measureRecords, tiePairs)

  const slurSeen = new Set()
  const slurPairs = []
  for (const pair of pathResult.slurPairs) {
    const key = `${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`
    if (slurSeen.has(key) || seen.has(key)) {
      continue
    }
    slurSeen.add(key)
    slurPairs.push(pair)
  }
  for (const pair of pairSlurControlGlyphs(glyphs, instances, imageData)) {
    const key = `${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`
    if (slurSeen.has(key) || seen.has(key)) {
      continue
    }
    slurSeen.add(key)
    slurPairs.push(pair)
  }
  if (mayRasterInferCurves) {
    for (const pair of collectInkArcSlurPairs(
      instances,
      imageData,
      inkThreshold,
      measureBoxByNumber,
      slurSeen,
    )) {
      if (seen.has(`${eventRefKey(pair.from)}->${eventRefKey(pair.to)}`)) {
        continue
      }
      slurPairs.push(pair)
    }
  }
  const appliedSlurCount = applySlurMarks(measureRecords, slurPairs)
  const uncertainSlurCount = Math.max(
    0,
    countUnpairedSlurGlyphs(glyphs) + Math.max(0, slurPairs.length - appliedSlurCount),
  )

  return {
    diagnostics: {
      detectedTieCount: tiePairs.length,
      appliedTieCount,
      appliedTiePairs: tiePairs.map((pair) => ({
        fromMeasure: pair.from.measureNumber,
        toMeasure: pair.to.measureNumber,
        midi: pair.from.midi,
        clef: pair.from.clef,
        source: pair.source,
        candidateIds: pair.candidateIds ?? [],
        archDirection: pair.archDirection ?? null,
      })),
      appliedSlurCount,
      appliedSlurPairs: slurPairs.slice(0, appliedSlurCount).map((pair) => ({
        fromMeasure: pair.from.measureNumber,
        toMeasure: pair.to.measureNumber,
        fromMidi: pair.from.midi,
        toMidi: pair.to.midi,
        source: pair.source,
        candidateIds: pair.candidateIds ?? [],
        archDirection: pair.archDirection ?? null,
      })),
      uncertainSlurCount,
      tieControlGlyphCount: glyphs.filter(
        (glyph) => glyph.text === TIE_BEGIN_GLYPH || glyph.text === TIE_END_GLYPH,
      ).length,
      vectorCurveCandidateCount: vectorCurves.length,
      vectorCurveAppliedCount: [...tiePairs, ...slurPairs].filter((pair) =>
        pair.source?.startsWith('pdf-vector-path'),
      ).length,
      vectorCurveDiagnostics: pathResult.diagnostics,
      openVectorCurveFragments: pathResult.openFragments,
    },
  }
}

/**
 * Pair only page-edge vector fragments after all page measure records exist.
 * Unmatched fragments remain diagnostics and never emit orphan MusicXML.
 */
export function applyDocumentVectorCurveContinuations({
  measureRecords = [],
  fragments = [],
} = {}) {
  const instances = flattenMeasureNotes(measureRecords)
  const byRef = new Map(instances.map((instance) => [eventRefKey(instance), instance]))
  const starts = fragments
    .filter((fragment) => fragment.role === 'start')
    .map((fragment) => ({ ...fragment, instance: byRef.get(eventRefKey(fragment.ref)) }))
    .filter((fragment) => fragment.instance)
  const stops = fragments
    .filter((fragment) => fragment.role === 'stop')
    .map((fragment) => ({ ...fragment, instance: byRef.get(eventRefKey(fragment.ref)) }))
    .filter((fragment) => fragment.instance)
  const candidates = []

  for (const start of starts) {
    for (const stop of stops) {
      if (stop.page !== start.page + 1) {
        continue
      }
      if (start.instance.clef !== stop.instance.clef) {
        continue
      }
      if (!isLaterOnset(start.instance, stop.instance)) {
        continue
      }
      const sameArch = start.archDirection === stop.archDirection
      candidates.push({
        start,
        stop,
        score:
          Math.abs((start.endpointOffset ?? 0) - (stop.endpointOffset ?? 0)) * 1.5 +
          (sameArch ? 0 : 24) +
          (start.instance.midi === stop.instance.midi
            ? 0
            : Math.abs(start.instance.midi - stop.instance.midi) * 0.4),
      })
    }
  }
  candidates.sort((left, right) => left.score - right.score)

  const tiePairs = []
  const slurPairs = []
  const usedStarts = new Set()
  const usedStops = new Set()
  for (const candidate of candidates) {
    if (
      usedStarts.has(candidate.start.candidateId) ||
      usedStops.has(candidate.stop.candidateId)
    ) {
      continue
    }
    const from = candidate.start.instance
    const to = candidate.stop.instance
    const tieLike = Boolean(candidate.start.tieLike && candidate.stop.tieLike)
    const isTie =
      from.midi === to.midi &&
      from.clef === to.clef &&
      (tieLike || nextOnsetIsDirect(instances, from, to))
    const pair = {
      from,
      to,
      source: 'pdf-vector-path-page-continuation',
      candidateIds: [candidate.start.candidateId, candidate.stop.candidateId],
      archDirection: candidate.start.archDirection,
    }
    if (isTie) {
      tiePairs.push(pair)
    } else if (tieLike && from.midi !== to.midi) {
      continue
    } else {
      slurPairs.push(pair)
    }
    usedStarts.add(candidate.start.candidateId)
    usedStops.add(candidate.stop.candidateId)
  }

  const appliedTieCount = applyTieMarks(measureRecords, tiePairs)
  const appliedSlurCount = applySlurMarks(measureRecords, slurPairs)
  return {
    detectedTieCount: tiePairs.length,
    appliedTieCount,
    appliedTiePairs: tiePairs.map((pair) => ({
      fromMeasure: pair.from.measureNumber,
      toMeasure: pair.to.measureNumber,
      midi: pair.from.midi,
      clef: pair.from.clef,
      source: pair.source,
      candidateIds: pair.candidateIds,
      archDirection: pair.archDirection,
    })),
    appliedSlurCount,
    appliedSlurPairs: slurPairs.slice(0, appliedSlurCount).map((pair) => ({
      fromMeasure: pair.from.measureNumber,
      toMeasure: pair.to.measureNumber,
      fromMidi: pair.from.midi,
      toMidi: pair.to.midi,
      source: pair.source,
      candidateIds: pair.candidateIds,
      archDirection: pair.archDirection,
    })),
    pairedFragmentCount: usedStarts.size + usedStops.size,
    orphanFragmentCount: Math.max(0, fragments.length - usedStarts.size - usedStops.size),
    pairedCandidateIds: [...usedStarts, ...usedStops],
  }
}
