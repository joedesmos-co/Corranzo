import { isInk } from './omrInk.js'

const DEFAULT_CONFIDENCE = 0.5
const BEAM_STRENGTH_THRESHOLD = 8
const SIXTEENTH_BEAM_STRENGTH = 14
const DEFAULT_INK_THRESHOLD = 170
const STEM_SCAN_MAX = 46
const STEM_MIN_LENGTH = 9
const STEM_START_OFFSET = 3
const STEM_ANCHOR_X_TOLERANCE = 2
const STEM_ANCHOR_Y_TOLERANCE = 4
const BEAM_PAIR_MIN_X_GAP = 7
const BEAM_PAIR_MAX_X_GAP = 72
const BEAM_PAIR_MAX_Y_GAP = 8
const BEAM_CONNECTION_MIN_INK_RATE = 0.72
const BEAM_CONNECTION_MIN_THICK_RATE = 0.45
const BEAM_CONNECTION_MIN_THICKNESS = 3

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return 0
  }
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function average(values) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) {
    return 0
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function ratio(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator) : 0
}

function noteId(note, index, measureNumber) {
  return [
    'n',
    measureNumber ?? note.measureNumber ?? 0,
    index,
    Math.round(note.cx ?? 0),
    Math.round(note.cy ?? 0),
  ].join('-')
}

function stemId(noteheadId) {
  return `${noteheadId}-stem`
}

function beamSeedId(leftAnchor, rightAnchor) {
  return `${leftAnchor.id}-${rightAnchor.id}-beam`
}

function rhythmicGroupId(measureNumber, index) {
  return `rg-${measureNumber ?? 0}-${index}`
}

function hasBeamEvidence(note) {
  return (note?.beams ?? 0) > 0 || (note?.beamStrength ?? 0) >= BEAM_STRENGTH_THRESHOLD
}

function beamLevel(note) {
  if ((note?.beamStrength ?? 0) >= SIXTEENTH_BEAM_STRENGTH) {
    return 2
  }
  return Math.max(1, Math.min(3, note?.beams ?? 1))
}

function stemConfidence(stem) {
  const length = stem?.length ?? Math.abs((stem?.y1 ?? 0) - (stem?.y0 ?? 0))
  return round(Math.min(0.98, DEFAULT_CONFIDENCE + Math.min(42, length) / 90))
}

function beamConfidence(note) {
  const strength = note?.beamStrength ?? 0
  const beamBonus = Math.min(0.28, Math.max(0, strength - BEAM_STRENGTH_THRESHOLD) / 50)
  const countBonus = Math.min(0.12, (note?.beams ?? 0) * 0.06)
  return round(Math.min(0.96, 0.58 + beamBonus + countBonus))
}

function noteStemSide(note, stem) {
  if (!Number.isFinite(note?.cx) || !Number.isFinite(stem?.x)) {
    return 'unknown'
  }
  return stem.x >= note.cx ? 'right' : 'left'
}

function inkAt(imageData, x, y, threshold = DEFAULT_INK_THRESHOLD) {
  if (!imageData?.data?.length) {
    return false
  }
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) {
    return false
  }
  return isInk(imageData.data, (py * imageData.width + px) * 4, threshold)
}

function verticalInkAt(imageData, x, y, threshold) {
  return (
    inkAt(imageData, x, y, threshold) ||
    inkAt(imageData, x - 1, y, threshold) ||
    inkAt(imageData, x + 1, y, threshold)
  )
}

function scanStemRun(imageData, cx, cy, stemX, direction, threshold) {
  let run = 0
  let bestRun = 0
  let misses = 0
  for (let step = STEM_START_OFFSET; step <= STEM_SCAN_MAX; step += 1) {
    const y = cy + direction * step
    if (verticalInkAt(imageData, stemX, y, threshold)) {
      run += 1
      bestRun = Math.max(bestRun, run)
      misses = 0
      continue
    }
    if (run > 0 && misses < 1) {
      misses += 1
      continue
    }
    if (run > 0) {
      break
    }
  }
  return bestRun
}

function detectStemAroundNotehead(note, imageData, threshold) {
  if (!imageData?.data?.length || !Number.isFinite(note?.cx) || !Number.isFinite(note?.cy)) {
    return null
  }
  const candidates = []
  for (const offset of [4, -4, 5, -5, 3, -3]) {
    const x = note.cx + offset
    for (const direction of [-1, 1]) {
      const length = scanStemRun(imageData, note.cx, note.cy, x, direction, threshold)
      if (length >= STEM_MIN_LENGTH) {
        candidates.push({ x, length, direction, side: offset >= 0 ? 'right' : 'left' })
      }
    }
  }
  if (!candidates.length) {
    return null
  }
  const best = candidates.sort((left, right) => right.length - left.length)[0]
  return {
    x: best.x,
    tipY: note.cy + best.direction * (STEM_START_OFFSET + best.length - 1),
    length: STEM_START_OFFSET + best.length,
    direction: best.direction < 0 ? 'up' : 'down',
    side: best.side,
    recovered: true,
  }
}

function localVerticalThickness(imageData, x, y, threshold) {
  if (!imageData?.data?.length) {
    return 0
  }
  let best = 0
  for (let centerOffset = -2; centerOffset <= 2; centerOffset += 1) {
    const centerY = y + centerOffset
    if (!inkAt(imageData, x, centerY, threshold)) {
      continue
    }
    let thickness = 1
    for (let dy = 1; dy <= 5; dy += 1) {
      if (!inkAt(imageData, x, centerY - dy, threshold)) {
        break
      }
      thickness += 1
    }
    for (let dy = 1; dy <= 5; dy += 1) {
      if (!inkAt(imageData, x, centerY + dy, threshold)) {
        break
      }
      thickness += 1
    }
    best = Math.max(best, thickness)
  }
  return best
}

function beamConnectionStats(leftAnchor, rightAnchor, imageData, threshold) {
  if (!imageData?.data?.length) {
    return null
  }
  const dx = rightAnchor.x - leftAnchor.x
  if (dx <= 0) {
    return null
  }
  const samples = Math.max(5, Math.min(18, Math.floor(dx / 4)))
  let inkSamples = 0
  let thickSamples = 0
  let thicknessSum = 0
  for (let sample = 0; sample < samples; sample += 1) {
    const t = (sample + 0.5) / samples
    const x = leftAnchor.x + dx * t
    const y = leftAnchor.tipY + (rightAnchor.tipY - leftAnchor.tipY) * t
    const thickness = localVerticalThickness(imageData, x, y, threshold)
    if (thickness > 0) {
      inkSamples += 1
      thicknessSum += thickness
    }
    if (thickness >= BEAM_CONNECTION_MIN_THICKNESS) {
      thickSamples += 1
    }
  }
  const inkRate = inkSamples / samples
  const thickRate = thickSamples / samples
  return {
    samples,
    inkRate,
    thickRate,
    averageThickness: inkSamples > 0 ? thicknessSum / inkSamples : 0,
    connected:
      inkRate >= BEAM_CONNECTION_MIN_INK_RATE &&
      thickRate >= BEAM_CONNECTION_MIN_THICK_RATE,
  }
}

function measureBoundsPx(measureBox, imageData) {
  if (!measureBox || !imageData) {
    return null
  }
  return {
    x0: round((measureBox.x0 ?? 0) * imageData.width, 2),
    y0: round((measureBox.y0 ?? 0) * imageData.height, 2),
    x1: round((measureBox.x1 ?? 1) * imageData.width, 2),
    y1: round((measureBox.y1 ?? 1) * imageData.height, 2),
  }
}

function candidateNoteheads(notes, measureNumber) {
  return notes.map((note, index) => ({
    id: noteId(note, index, measureNumber),
    page: note.page ?? null,
    measureNumber: note.measureNumber ?? measureNumber ?? null,
    systemIndex: note.systemIndex ?? null,
    staffRole: note.pitchMapping?.staffRole ?? (note.clef === 'bass' ? 'lower' : 'upper'),
    clef: note.clef ?? 'treble',
    cx: round(note.cx, 2),
    cy: round(note.cy, 2),
    xNorm: round(note.xNorm ?? 0),
    yNorm: round(note.yNorm ?? 0),
    midi: note.midi ?? note.naturalMidi ?? null,
    source: note.source ?? 'unknown',
    visualBounds: {
      x0: round((note.cx ?? 0) - 5, 2),
      y0: round((note.cy ?? 0) - 4, 2),
      x1: round((note.cx ?? 0) + 5, 2),
      y1: round((note.cy ?? 0) + 4, 2),
    },
    rhythmProbe: {
      hollow: note.hollow === true,
      dotted: note.dotted === true,
      beams: note.beams ?? 0,
      beamStrength: note.beamStrength ?? 0,
      durationDivisions: note.durationDivisions ?? null,
      stem: Boolean(note.stem),
    },
    attachedStemIds: [],
    attachedBeamIds: [],
    rhythmicGroupIds: [],
  }))
}

function buildStemCandidates(notes, noteheads, imageData, inkThreshold) {
  const stems = []
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index]
    const stem = note.stem ?? detectStemAroundNotehead(note, imageData, inkThreshold)
    if (!stem || !Number.isFinite(stem.x) || !Number.isFinite(stem.tipY)) {
      continue
    }
    const head = noteheads[index]
    const y0 = Math.min(note.cy ?? stem.tipY, stem.tipY)
    const y1 = Math.max(note.cy ?? stem.tipY, stem.tipY)
    const candidate = {
      id: stemId(head.id),
      page: head.page,
      measureNumber: head.measureNumber,
      source: 'rendered-image',
      recovered: stem.recovered === true,
      x: round(stem.x, 2),
      y0: round(y0, 2),
      y1: round(y1, 2),
      tipY: round(stem.tipY, 2),
      length: round(stem.length ?? y1 - y0, 2),
      direction: stem.direction ?? 'unknown',
      side: stem.side ?? noteStemSide(note, stem),
      confidence: stemConfidence(stem),
      attachedNoteheadIds: [head.id],
      attachedBeamIds: [],
    }
    head.attachedStemIds.push(candidate.id)
    stems.push(candidate)
  }
  return stems
}

function groupStemAnchors(notes, noteheads, stems) {
  const noteheadById = new Map(noteheads.map((head) => [head.id, head]))
  const noteByHeadId = new Map(noteheads.map((head, index) => [head.id, notes[index]]))
  const anchors = []

  for (const stem of stems) {
    const noteheadIdValue = stem.attachedNoteheadIds[0]
    const head = noteheadById.get(noteheadIdValue)
    const note = noteByHeadId.get(noteheadIdValue)
    if (!head) {
      continue
    }
    const existing = anchors.find(
      (anchor) =>
        anchor.measureNumber === stem.measureNumber &&
        anchor.staffRole === head.staffRole &&
        anchor.direction === stem.direction &&
        anchor.side === stem.side &&
        Math.abs(anchor.x - stem.x) <= STEM_ANCHOR_X_TOLERANCE &&
        Math.abs(anchor.tipY - stem.tipY) <= STEM_ANCHOR_Y_TOLERANCE,
    )
    if (existing) {
      existing.stemIds.push(stem.id)
      existing.noteheadIds.push(head.id)
      existing.hasBeamEvidence ||= hasBeamEvidence(note)
      existing.maxBeamStrength = Math.max(existing.maxBeamStrength, note?.beamStrength ?? 0)
      existing.maxBeamLevel = Math.max(existing.maxBeamLevel, beamLevel(note))
      existing.x = round(average([existing.x, stem.x]), 2)
      existing.tipY = round(average([existing.tipY, stem.tipY]), 2)
      continue
    }
    anchors.push({
      id: `stem-anchor-${anchors.length + 1}`,
      page: stem.page,
      measureNumber: stem.measureNumber,
      staffRole: head.staffRole,
      direction: stem.direction,
      side: stem.side,
      x: stem.x,
      tipY: stem.tipY,
      stemIds: [stem.id],
      noteheadIds: [head.id],
      hasBeamEvidence: hasBeamEvidence(note),
      maxBeamStrength: note?.beamStrength ?? 0,
      maxBeamLevel: beamLevel(note),
    })
  }

  return anchors.sort(
    (left, right) =>
      (left.measureNumber ?? 0) - (right.measureNumber ?? 0) ||
      String(left.staffRole).localeCompare(String(right.staffRole)) ||
      left.x - right.x ||
      left.tipY - right.tipY,
  )
}

function anchorsAreBeamCompatible(left, right) {
  if (left.measureNumber !== right.measureNumber || left.staffRole !== right.staffRole) {
    return false
  }
  if (left.direction !== right.direction || left.side !== right.side) {
    return false
  }
  const xGap = right.x - left.x
  const yGap = Math.abs(left.tipY - right.tipY)
  return (
    xGap >= BEAM_PAIR_MIN_X_GAP &&
    xGap <= BEAM_PAIR_MAX_X_GAP &&
    yGap <= BEAM_PAIR_MAX_Y_GAP
  )
}

function beamSeedConfidence(leftAnchor, rightAnchor, connectionStats) {
  const probe = Math.max(leftAnchor.maxBeamStrength, rightAnchor.maxBeamStrength)
  const probeConfidence = beamConfidence({
    beamStrength: probe,
    beams: Math.max(leftAnchor.maxBeamLevel, rightAnchor.maxBeamLevel),
  })
  if (!connectionStats) {
    return probeConfidence
  }
  const imageConfidence = 0.56 + Math.min(0.2, connectionStats.inkRate * 0.18) +
    Math.min(0.18, connectionStats.thickRate * 0.2)
  return round(Math.min(0.96, Math.max(probeConfidence, imageConfidence)))
}

function rawBeamSeeds(notes, noteheads, stems, imageData, inkThreshold) {
  const anchors = groupStemAnchors(notes, noteheads, stems)
  const seeds = []
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const left = anchors[index]
    const right = anchors[index + 1]
    if (!anchorsAreBeamCompatible(left, right)) {
      continue
    }
    const connectionStats = beamConnectionStats(left, right, imageData, inkThreshold)
    const hasImageConnection = connectionStats?.connected === true
    const hasProbeConnection = left.hasBeamEvidence && right.hasBeamEvidence
    if (imageData?.data?.length ? !hasImageConnection : !hasProbeConnection) {
      continue
    }
    const y0 = Math.min(left.tipY, right.tipY)
    const y1 = Math.max(left.tipY, right.tipY)
    seeds.push({
      id: beamSeedId(left, right),
      page: left.page,
      measureNumber: left.measureNumber,
      source: 'rendered-image',
      x0: round(left.x, 2),
      x1: round(right.x, 2),
      y0: round(y0 - 1.5, 2),
      y1: round(y1 + 1.5, 2),
      slope: round((right.tipY - left.tipY) / Math.max(1, right.x - left.x)),
      thickness: round(connectionStats?.averageThickness ?? 3, 2),
      level: Math.max(left.maxBeamLevel, right.maxBeamLevel),
      confidence: beamSeedConfidence(left, right, connectionStats),
      attachedStemIds: [...new Set([...left.stemIds, ...right.stemIds])],
      evidence: {
        leftAnchorId: left.id,
        rightAnchorId: right.id,
        inkRate: round(connectionStats?.inkRate ?? 0),
        thickRate: round(connectionStats?.thickRate ?? 0),
        existingRhythmProbe: hasProbeConnection,
      },
    })
  }
  return seeds
}

function beamsAreAdjacent(left, right) {
  const yGap = Math.abs(average([left.y0, left.y1]) - average([right.y0, right.y1]))
  const xGap = Math.max(0, Math.max(left.x0, right.x0) - Math.min(left.x1, right.x1))
  return yGap <= 5 && xGap <= 10
}

function mergeBeamSeeds(seeds) {
  const beams = []
  const sorted = [...seeds].sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0)
  for (const seed of sorted) {
    const existing = beams.find((beam) => beamsAreAdjacent(beam, seed))
    if (!existing) {
      beams.push({ ...seed, id: `beam-${beams.length + 1}` })
      continue
    }
    existing.x0 = round(Math.min(existing.x0, seed.x0), 2)
    existing.x1 = round(Math.max(existing.x1, seed.x1), 2)
    existing.y0 = round(Math.min(existing.y0, seed.y0), 2)
    existing.y1 = round(Math.max(existing.y1, seed.y1), 2)
    existing.level = Math.max(existing.level, seed.level)
    existing.confidence = round(average([existing.confidence, seed.confidence]))
    existing.attachedStemIds = [...new Set([...existing.attachedStemIds, ...seed.attachedStemIds])]
  }
  return beams
}

function attachBeamsToStemsAndNotes(beams, stems, noteheads) {
  const stemById = new Map(stems.map((stem) => [stem.id, stem]))
  const noteheadByStem = new Map(
    stems.flatMap((stem) => stem.attachedNoteheadIds.map((id) => [stem.id, id])),
  )
  const noteheadById = new Map(noteheads.map((head) => [head.id, head]))
  for (const beam of beams) {
    for (const stemIdValue of beam.attachedStemIds) {
      const stem = stemById.get(stemIdValue)
      if (stem) {
        stem.attachedBeamIds.push(beam.id)
      }
      const notehead = noteheadById.get(noteheadByStem.get(stemIdValue))
      if (notehead) {
        notehead.attachedBeamIds.push(beam.id)
      }
    }
  }
}

function eventDurationByNote(notes, events) {
  const durationByNote = new WeakMap()
  for (const event of events ?? []) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      durationByNote.set(note, event.durationDivisions ?? null)
    }
  }
  return notes.map((note) => durationByNote.get(note) ?? null)
}

function buildRhythmicGroups(noteheads, stems, beams) {
  const groups = []
  const groupedNoteheads = new Set()
  const stemById = new Map(stems.map((stem) => [stem.id, stem]))
  const noteheadByStemId = new Map(
    stems.flatMap((stem) => stem.attachedNoteheadIds.map((id) => [stem.id, id])),
  )
  const noteheadById = new Map(noteheads.map((head) => [head.id, head]))

  for (const beam of beams) {
    const noteheadIds = beam.attachedStemIds
      .map((id) => noteheadByStemId.get(id))
      .filter(Boolean)
    const group = {
      id: rhythmicGroupId(beam.measureNumber, groups.length + 1),
      measureNumber: beam.measureNumber,
      staffRole: noteheadIds.length
        ? noteheadById.get(noteheadIds[0])?.staffRole ?? 'upper'
        : 'upper',
      noteheadIds,
      stemIds: beam.attachedStemIds.filter((id) => stemById.has(id)),
      beamIds: [beam.id],
      inferredUnit: beam.level >= 2 ? 'sixteenth' : 'eighth',
      attackOrder: groups.length,
      confidence: beam.confidence,
      evidence: ['beam-connected-stems'],
    }
    for (const id of noteheadIds) {
      groupedNoteheads.add(id)
      noteheadById.get(id)?.rhythmicGroupIds.push(group.id)
    }
    groups.push(group)
  }

  for (const stem of stems) {
    const noteheadIdValue = stem.attachedNoteheadIds[0]
    if (!noteheadIdValue || groupedNoteheads.has(noteheadIdValue)) {
      continue
    }
    const head = noteheadById.get(noteheadIdValue)
    const group = {
      id: rhythmicGroupId(stem.measureNumber, groups.length + 1),
      measureNumber: stem.measureNumber,
      staffRole: head?.staffRole ?? 'upper',
      noteheadIds: [noteheadIdValue],
      stemIds: [stem.id],
      beamIds: [],
      inferredUnit: 'quarter-or-longer',
      attackOrder: groups.length,
      confidence: stem.confidence,
      evidence: ['stem-without-beam'],
    }
    groupedNoteheads.add(noteheadIdValue)
    head?.rhythmicGroupIds.push(group.id)
    groups.push(group)
  }

  for (const head of noteheads) {
    if (groupedNoteheads.has(head.id)) {
      continue
    }
    const group = {
      id: rhythmicGroupId(head.measureNumber, groups.length + 1),
      measureNumber: head.measureNumber,
      staffRole: head.staffRole ?? 'upper',
      noteheadIds: [head.id],
      stemIds: [],
      beamIds: [],
      inferredUnit: 'unknown',
      attackOrder: groups.length,
      confidence: DEFAULT_CONFIDENCE,
      evidence: ['unattached-notehead'],
    }
    head.rhythmicGroupIds.push(group.id)
    groups.push(group)
  }
  return groups
}

function expectedDivisionsForGroup(group) {
  if (group.inferredUnit === 'sixteenth') {
    return 1
  }
  if (group.inferredUnit === 'eighth') {
    return 2
  }
  return null
}

function ownershipRole({ hasBeams, hasStem, beamLevelValue }) {
  if (hasBeams) {
    return beamLevelValue >= 2 ? 'beamed-sixteenth-voice' : 'beamed-eighth-voice'
  }
  if (hasStem) {
    return 'stemmed-sustain-or-quarter-voice'
  }
  return 'unattached-or-rest-like-notehead'
}

function inferLikelyVoiceId({ staffRole, stemDirection, beamGroupId, rhythmicGroupId, role }) {
  const staff = staffRole ?? 'unknown-staff'
  const direction = stemDirection ?? 'unknown-stem'
  if (beamGroupId) {
    return `${staff}:${direction}:beam:${beamGroupId}`
  }
  if (rhythmicGroupId) {
    return `${staff}:${direction}:${role}:${rhythmicGroupId}`
  }
  return `${staff}:${direction}:${role}`
}

function attachBeamOwnership(noteheads, stems, beams, rhythmicGroups) {
  const stemById = new Map(stems.map((stem) => [stem.id, stem]))
  const beamById = new Map(beams.map((beam) => [beam.id, beam]))
  const groupById = new Map(rhythmicGroups.map((group) => [group.id, group]))

  for (const head of noteheads) {
    const stem = head.attachedStemIds
      .map((id) => stemById.get(id))
      .find(Boolean)
    const attachedBeams = head.attachedBeamIds
      .map((id) => beamById.get(id))
      .filter(Boolean)
    const groups = head.rhythmicGroupIds
      .map((id) => groupById.get(id))
      .filter(Boolean)
    const beamedGroup = groups.find((group) => (group.beamIds ?? []).length > 0) ?? null
    const primaryGroup = beamedGroup ?? groups[0] ?? null
    const beamLevelValue = attachedBeams.reduce(
      (maxLevel, beam) => Math.max(maxLevel, beam.level ?? 0),
      head.rhythmProbe?.beams ?? 0,
    )
    const hasBeams = attachedBeams.length > 0 || beamLevelValue > 0
    const hasStem = Boolean(stem)
    const role = ownershipRole({ hasBeams, hasStem, beamLevelValue })
    const expectedDivisions = expectedDivisionsForGroup(beamedGroup ?? primaryGroup ?? {})
    const stemDirection = stem?.direction ?? null
    const rhythmicGroupIdValue = primaryGroup?.id ?? null
    const beamGroupId = beamedGroup?.id ?? null
    const confidenceValues = [
      stem?.confidence,
      ...attachedBeams.map((beam) => beam.confidence),
      primaryGroup?.confidence,
    ].filter(Number.isFinite)

    head.beamOwnership = {
      noteheadId: head.id,
      measureNumber: head.measureNumber,
      staffRole: head.staffRole,
      clef: head.clef,
      midi: head.midi,
      stemDirection,
      attachedStemId: stem?.id ?? null,
      attachedStemIds: [...head.attachedStemIds],
      attachedBeamIds: [...head.attachedBeamIds],
      beamCandidateCount: attachedBeams.length,
      beamCount: beamLevelValue,
      beamLevel: beamLevelValue,
      beamGroupId,
      rhythmicGroupId: rhythmicGroupIdValue,
      expectedDivisions,
      likelyVoiceId: inferLikelyVoiceId({
        staffRole: head.staffRole,
        stemDirection,
        beamGroupId,
        rhythmicGroupId: rhythmicGroupIdValue,
        role,
      }),
      likelyVoiceRole: role,
      confidence: round(average(confidenceValues)),
    }
  }
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))]
}

function reasonCountsForEvents(events) {
  const counts = {}
  for (const event of events) {
    for (const reason of event.reasons ?? []) {
      counts[reason] = (counts[reason] ?? 0) + 1
    }
  }
  return Object.fromEntries(Object.entries(counts).sort())
}

function mergeCounts(target, source = {}) {
  for (const [key, count] of Object.entries(source ?? {})) {
    target[key] = (target[key] ?? 0) + count
  }
}

function buildEventOwnershipSummaries({ notes, events, noteheads }) {
  const noteheadByNote = new WeakMap()
  notes.forEach((note, index) => {
    if (note && typeof note === 'object' && noteheads[index]) {
      noteheadByNote.set(note, noteheads[index])
    }
  })

  const summaries = []
  for (let eventIndex = 0; eventIndex < (events ?? []).length; eventIndex += 1) {
    const event = events[eventIndex]
    if (event?.type !== 'note') {
      continue
    }
    const heads = (event.notes ?? [])
      .map((note) => noteheadByNote.get(note))
      .filter(Boolean)
    const ownerships = heads.map((head) => head.beamOwnership).filter(Boolean)
    const beamedOwnerships = ownerships.filter((ownership) => ownership.beamCount > 0)
    const notesWithBeams = beamedOwnerships.length
    const notesWithoutBeams = ownerships.length - notesWithBeams
    const stemDirections = uniqueValues(ownerships.map((ownership) => ownership.stemDirection))
    const beamGroupIds = uniqueValues(ownerships.map((ownership) => ownership.beamGroupId))
    const voiceIds = uniqueValues(ownerships.map((ownership) => ownership.likelyVoiceId))
    const voiceRoles = uniqueValues(ownerships.map((ownership) => ownership.likelyVoiceRole))
    const beamedExpectedValues = beamedOwnerships
      .map((ownership) => ownership.expectedDivisions)
      .filter(Number.isFinite)
    const beamedExpectedDivisions = beamedExpectedValues.length
      ? Math.min(...beamedExpectedValues)
      : null
    const eventDurationDivisions = event.durationDivisions ?? null
    const eventLongerThanBeamUnit =
      Number.isFinite(eventDurationDivisions) &&
      Number.isFinite(beamedExpectedDivisions) &&
      eventDurationDivisions > beamedExpectedDivisions
    const reasons = []
    if (notesWithBeams > 0 && notesWithoutBeams > 0) {
      reasons.push('beamed-and-unbeamed-notes')
    }
    if (stemDirections.length > 1) {
      reasons.push('mixed-stem-directions')
    }
    if (beamGroupIds.length > 1) {
      reasons.push('multiple-beam-groups')
    }
    if (voiceIds.length > 1) {
      reasons.push('multiple-likely-voices')
    }
    if (eventLongerThanBeamUnit) {
      reasons.push('event-longer-than-beam-unit')
    }
    const mixedOwnership =
      notesWithBeams > 0 &&
      (notesWithoutBeams > 0 || stemDirections.length > 1 || beamGroupIds.length > 1)
    const splitCandidate = mixedOwnership && eventLongerThanBeamUnit

    summaries.push({
      eventIndex,
      measureNumber: heads[0]?.measureNumber ?? null,
      startDivision: event.startDivision ?? null,
      durationDivisions: eventDurationDivisions,
      noteheadIds: heads.map((head) => head.id),
      noteCount: ownerships.length,
      notesWithBeams,
      notesWithoutBeams,
      stemDirections,
      beamGroupIds,
      voiceIds,
      voiceRoles,
      beamedExpectedDivisions,
      eventLongerThanBeamUnit,
      mixedOwnership,
      splitCandidate,
      reasons,
      ownerships,
    })
  }
  return summaries
}

function graphDisagreements({ noteheads, notes, rhythmicGroups, eventDurations }) {
  const groupByNotehead = new Map()
  for (const group of rhythmicGroups) {
    for (const noteheadIdValue of group.noteheadIds ?? []) {
      groupByNotehead.set(noteheadIdValue, group)
    }
  }
  const disagreements = {
    graphBeamedButCurrentLong: 0,
    currentShortWithoutBeamGraph: 0,
    currentBeamProbeWithoutGraph: 0,
    samples: [],
  }

  for (let index = 0; index < noteheads.length; index += 1) {
    const head = noteheads[index]
    const note = notes[index]
    const group = groupByNotehead.get(head.id)
    const expected = expectedDivisionsForGroup(group ?? {})
    const eventDuration = eventDurations[index]
    const beamAttached = head.attachedBeamIds.length > 0
    if (expected != null && Number.isFinite(eventDuration) && eventDuration > expected) {
      disagreements.graphBeamedButCurrentLong += 1
      if (disagreements.samples.length < 20) {
        disagreements.samples.push({
          type: 'graph-beamed-current-long',
          noteheadId: head.id,
          measureNumber: head.measureNumber,
          inferredUnit: group.inferredUnit,
          eventDurationDivisions: eventDuration,
        })
      }
    }
    if (!beamAttached && Number.isFinite(eventDuration) && eventDuration <= 2) {
      disagreements.currentShortWithoutBeamGraph += 1
    }
    if (hasBeamEvidence(note) && !beamAttached) {
      disagreements.currentBeamProbeWithoutGraph += 1
    }
  }

  return {
    ...disagreements,
    total: disagreements.graphBeamedButCurrentLong +
      disagreements.currentShortWithoutBeamGraph +
      disagreements.currentBeamProbeWithoutGraph,
    rate: ratio(
      disagreements.graphBeamedButCurrentLong +
        disagreements.currentShortWithoutBeamGraph +
        disagreements.currentBeamProbeWithoutGraph,
      noteheads.length,
    ),
  }
}

export function buildBeamStemGraph({
  notes = [],
  events = [],
  measureBox = null,
  imageData = null,
  inkThreshold = DEFAULT_INK_THRESHOLD,
} = {}) {
  const measureNumber = measureBox?.measureNumber ?? notes[0]?.measureNumber ?? null
  const noteheads = candidateNoteheads(notes, measureNumber)
  const stems = buildStemCandidates(notes, noteheads, imageData, inkThreshold)
  const beamSeeds = rawBeamSeeds(notes, noteheads, stems, imageData, inkThreshold)
  const beams = mergeBeamSeeds(beamSeeds)
  attachBeamsToStemsAndNotes(beams, stems, noteheads)
  const rhythmicGroups = buildRhythmicGroups(noteheads, stems, beams)
  attachBeamOwnership(noteheads, stems, beams, rhythmicGroups)
  const eventOwnership = buildEventOwnershipSummaries({ notes, events, noteheads })
  const eventDurations = eventDurationByNote(notes, events)
  const disagreements = graphDisagreements({
    noteheads,
    notes,
    rhythmicGroups,
    eventDurations,
  })
  return {
    version: 1,
    source: 'rendered-image',
    page: measureBox?.page ?? notes[0]?.page ?? null,
    measureNumber,
    systemIndex: measureBox?.systemIndex ?? null,
    image: imageData
      ? { width: imageData.width, height: imageData.height }
      : null,
    measureBounds: measureBoundsPx(measureBox, imageData),
    noteheads,
    stems,
    beams,
    rhythmicGroups,
    eventOwnership,
    disagreements,
  }
}

export function summarizeBeamOwnershipGraph(graph) {
  const noteOwnerships = (graph?.noteheads ?? [])
    .map((head) => head.beamOwnership)
    .filter(Boolean)
  const events = graph?.eventOwnership ?? []
  const stemDirections = {}
  const voiceRoles = {}
  const beamGroups = new Set()
  let notesWithStemDirection = 0
  let notesWithBeamGroup = 0
  let notesWithBeams = 0
  let notesWithoutBeams = 0

  for (const ownership of noteOwnerships) {
    if (ownership.stemDirection) {
      notesWithStemDirection += 1
      stemDirections[ownership.stemDirection] =
        (stemDirections[ownership.stemDirection] ?? 0) + 1
    }
    if (ownership.beamGroupId) {
      notesWithBeamGroup += 1
      beamGroups.add(ownership.beamGroupId)
    }
    if (ownership.beamCount > 0) {
      notesWithBeams += 1
    } else {
      notesWithoutBeams += 1
    }
    voiceRoles[ownership.likelyVoiceRole] =
      (voiceRoles[ownership.likelyVoiceRole] ?? 0) + 1
  }

  const mixedOwnershipEvents = events.filter((event) => event.mixedOwnership)
  const splitCandidates = events.filter((event) => event.splitCandidate)
  return {
    noteCount: noteOwnerships.length,
    notesWithStemDirection,
    notesWithBeams,
    notesWithoutBeams,
    notesWithBeamGroup,
    beamGroupCount: beamGroups.size,
    stemDirections: Object.fromEntries(Object.entries(stemDirections).sort()),
    voiceRoles: Object.fromEntries(Object.entries(voiceRoles).sort()),
    eventCount: events.length,
    mixedOwnershipEventCount: mixedOwnershipEvents.length,
    splitCandidateEventCount: splitCandidates.length,
    splitCandidateNoteCount: splitCandidates.reduce(
      (total, event) => total + (event.noteCount ?? 0),
      0,
    ),
    mixedOwnershipReasons: reasonCountsForEvents(mixedOwnershipEvents),
    splitCandidateReasons: reasonCountsForEvents(splitCandidates),
    splitCandidateSamples: splitCandidates.slice(0, 20),
    mixedOwnershipSamples: mixedOwnershipEvents.slice(0, 20),
  }
}

export function summarizeBeamStemGraph(graph) {
  const noteCount = graph?.noteheads?.length ?? 0
  const stemAttachedNoteCount = (graph?.noteheads ?? []).filter(
    (notehead) => notehead.attachedStemIds?.length,
  ).length
  const beamAttachedNoteCount = (graph?.noteheads ?? []).filter(
    (notehead) => notehead.attachedBeamIds?.length,
  ).length
  const confidences = [
    ...(graph?.stems ?? []).map((stem) => stem.confidence),
    ...(graph?.beams ?? []).map((beam) => beam.confidence),
    ...(graph?.rhythmicGroups ?? []).map((group) => group.confidence),
  ]
  return {
    noteCount,
    stemCandidateCount: graph?.stems?.length ?? 0,
    beamCandidateCount: graph?.beams?.length ?? 0,
    rhythmicGroupCount: graph?.rhythmicGroups?.length ?? 0,
    stemAttachedNoteCount,
    beamAttachedNoteCount,
    stemAttachmentRate: ratio(stemAttachedNoteCount, noteCount),
    beamAttachmentRate: ratio(beamAttachedNoteCount, noteCount),
    averageConfidence: round(average(confidences)),
    disagreementCount: graph?.disagreements?.total ?? 0,
    disagreementRate: graph?.disagreements?.rate ?? 0,
    ownership: summarizeBeamOwnershipGraph(graph),
    disagreements: graph?.disagreements ?? {
      graphBeamedButCurrentLong: 0,
      currentShortWithoutBeamGraph: 0,
      currentBeamProbeWithoutGraph: 0,
      total: 0,
      rate: 0,
      samples: [],
    },
  }
}

export function aggregateBeamStemDiagnostics(
  pages = [],
  { sampleLimit = 16, ownershipSampleLimit = 64 } = {},
) {
  const totals = {
    measuresWithGraph: 0,
    noteCount: 0,
    stemCandidateCount: 0,
    beamCandidateCount: 0,
    rhythmicGroupCount: 0,
    stemAttachedNoteCount: 0,
    beamAttachedNoteCount: 0,
    disagreementCount: 0,
    confidenceSum: 0,
    confidenceCount: 0,
  }
  const ownershipTotals = {
    noteCount: 0,
    notesWithStemDirection: 0,
    notesWithBeams: 0,
    notesWithoutBeams: 0,
    notesWithBeamGroup: 0,
    beamGroupCount: 0,
    eventCount: 0,
    mixedOwnershipEventCount: 0,
    splitCandidateEventCount: 0,
    splitCandidateNoteCount: 0,
    stemDirections: {},
    voiceRoles: {},
    mixedOwnershipReasons: {},
    splitCandidateReasons: {},
    splitCandidateSamples: [],
    mixedOwnershipSamples: [],
  }
  const disagreements = {
    graphBeamedButCurrentLong: 0,
    currentShortWithoutBeamGraph: 0,
    currentBeamProbeWithoutGraph: 0,
  }
  const visualSamples = []
  const measureSamples = []

  for (const page of pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        const graph = measure.beamStemGraph
        if (!graph) {
          continue
        }
        const summary = summarizeBeamStemGraph(graph)
        totals.measuresWithGraph += 1
        totals.noteCount += summary.noteCount
        totals.stemCandidateCount += summary.stemCandidateCount
        totals.beamCandidateCount += summary.beamCandidateCount
        totals.rhythmicGroupCount += summary.rhythmicGroupCount
        totals.stemAttachedNoteCount += summary.stemAttachedNoteCount
        totals.beamAttachedNoteCount += summary.beamAttachedNoteCount
        totals.disagreementCount += summary.disagreementCount
        totals.confidenceSum += summary.averageConfidence
        totals.confidenceCount += 1
        const ownership = summary.ownership ?? summarizeBeamOwnershipGraph(graph)
        ownershipTotals.noteCount += ownership.noteCount
        ownershipTotals.notesWithStemDirection += ownership.notesWithStemDirection
        ownershipTotals.notesWithBeams += ownership.notesWithBeams
        ownershipTotals.notesWithoutBeams += ownership.notesWithoutBeams
        ownershipTotals.notesWithBeamGroup += ownership.notesWithBeamGroup
        ownershipTotals.beamGroupCount += ownership.beamGroupCount
        ownershipTotals.eventCount += ownership.eventCount
        ownershipTotals.mixedOwnershipEventCount += ownership.mixedOwnershipEventCount
        ownershipTotals.splitCandidateEventCount += ownership.splitCandidateEventCount
        ownershipTotals.splitCandidateNoteCount += ownership.splitCandidateNoteCount
        mergeCounts(ownershipTotals.stemDirections, ownership.stemDirections)
        mergeCounts(ownershipTotals.voiceRoles, ownership.voiceRoles)
        mergeCounts(ownershipTotals.mixedOwnershipReasons, ownership.mixedOwnershipReasons)
        mergeCounts(ownershipTotals.splitCandidateReasons, ownership.splitCandidateReasons)
        disagreements.graphBeamedButCurrentLong +=
          summary.disagreements.graphBeamedButCurrentLong ?? 0
        disagreements.currentShortWithoutBeamGraph +=
          summary.disagreements.currentShortWithoutBeamGraph ?? 0
        disagreements.currentBeamProbeWithoutGraph +=
          summary.disagreements.currentBeamProbeWithoutGraph ?? 0
        if (measureSamples.length < sampleLimit && summary.noteCount > 0) {
          measureSamples.push({
            page: graph.page,
            systemIndex: graph.systemIndex,
            measureNumber: graph.measureNumber,
            ...summary,
          })
        }
        if (ownershipTotals.splitCandidateSamples?.length < ownershipSampleLimit) {
          ownershipTotals.splitCandidateSamples.push(
            ...ownership.splitCandidateSamples.slice(
              0,
              ownershipSampleLimit - ownershipTotals.splitCandidateSamples.length,
            ),
          )
        }
        if (ownershipTotals.mixedOwnershipSamples?.length < ownershipSampleLimit) {
          ownershipTotals.mixedOwnershipSamples.push(
            ...ownership.mixedOwnershipSamples.slice(
              0,
              ownershipSampleLimit - ownershipTotals.mixedOwnershipSamples.length,
            ),
          )
        }
        if (visualSamples.length < sampleLimit && (graph.beams.length || graph.stems.length)) {
          visualSamples.push(graph)
        }
      }
    }
  }

  return {
    ...totals,
    stemAttachmentRate: ratio(totals.stemAttachedNoteCount, totals.noteCount),
    beamAttachmentRate: ratio(totals.beamAttachedNoteCount, totals.noteCount),
    averageConfidence: ratio(totals.confidenceSum, totals.confidenceCount),
    disagreementRate: ratio(totals.disagreementCount, totals.noteCount),
    disagreements: {
      ...disagreements,
      total: totals.disagreementCount,
    },
    ownership: {
      ...ownershipTotals,
      stemDirections: Object.fromEntries(Object.entries(ownershipTotals.stemDirections).sort()),
      voiceRoles: Object.fromEntries(Object.entries(ownershipTotals.voiceRoles).sort()),
      mixedOwnershipReasons: Object.fromEntries(
        Object.entries(ownershipTotals.mixedOwnershipReasons).sort(),
      ),
      splitCandidateReasons: Object.fromEntries(
        Object.entries(ownershipTotals.splitCandidateReasons).sort(),
      ),
      splitCandidateSamples: ownershipTotals.splitCandidateSamples ?? [],
      mixedOwnershipSamples: ownershipTotals.mixedOwnershipSamples ?? [],
    },
    measureSamples,
    visualSamples,
  }
}

function svgEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function buildBeamStemDiagnosticsSvg(graphs = [], { width = 1000, height = 1400 } = {}) {
  const resolvedWidth = graphs.find((graph) => graph.image?.width)?.image?.width ?? width
  const resolvedHeight = graphs.find((graph) => graph.image?.height)?.image?.height ?? height
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${resolvedWidth}" height="${resolvedHeight}" viewBox="0 0 ${resolvedWidth} ${resolvedHeight}">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    '<style>text{font:12px sans-serif}.measure{fill:none;stroke:#999;stroke-width:1;stroke-dasharray:4 4}.note{fill:#2f6fed;fill-opacity:.55;stroke:#174ea6;stroke-width:1}.stem{stroke:#198754;stroke-width:2}.beam{fill:#f28c28;fill-opacity:.5;stroke:#b85d00;stroke-width:1}.group{fill:#111}</style>',
  ]
  for (const graph of graphs) {
    const bounds = graph.measureBounds
    if (bounds) {
      parts.push(
        `<rect class="measure" x="${bounds.x0}" y="${bounds.y0}" width="${Math.max(0, bounds.x1 - bounds.x0)}" height="${Math.max(0, bounds.y1 - bounds.y0)}"/>`,
      )
      parts.push(
        `<text class="group" x="${bounds.x0 + 3}" y="${Math.max(12, bounds.y0 - 4)}">m${svgEscape(graph.measureNumber)}</text>`,
      )
    }
    for (const beam of graph.beams ?? []) {
      parts.push(
        `<rect class="beam" x="${beam.x0}" y="${beam.y0}" width="${Math.max(1, beam.x1 - beam.x0)}" height="${Math.max(1, beam.y1 - beam.y0)}"><title>${svgEscape(beam.id)} stems=${beam.attachedStemIds.length}</title></rect>`,
      )
    }
    for (const stem of graph.stems ?? []) {
      parts.push(
        `<line class="stem" x1="${stem.x}" y1="${stem.y0}" x2="${stem.x}" y2="${stem.y1}"><title>${svgEscape(stem.id)}</title></line>`,
      )
    }
    for (const note of graph.noteheads ?? []) {
      parts.push(
        `<circle class="note" cx="${note.cx}" cy="${note.cy}" r="4"><title>${svgEscape(note.id)} stems=${note.attachedStemIds.length} beams=${note.attachedBeamIds.length}</title></circle>`,
      )
    }
  }
  parts.push('</svg>')
  return `${parts.join('\n')}\n`
}
