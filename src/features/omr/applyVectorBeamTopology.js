import { OMR_DURATION_DIVISIONS } from './omrRhythmConstants.js'

const MIN_BEAM_CONFIDENCE = 0.7
// FROZEN (Phase 1 browser accept, 2026-07-27): do not lower without a new
// regression proving safety. Written durations may only be overridden by a
// fully connected, thick beam bar. Under beamSeedConfidence scoring, 0.9
// requires the tip-to-tip probe to be inked across the whole span with
// beam-scale thickness; partial strokes such as unbeamed flags bridging
// nearby stems score below it (guitar-standard-chords).
const MIN_DURATION_OVERRIDE_CONFIDENCE = 0.9
const PRIMARY_BEAM_LEVEL = 1

function hasDottedEvidence(event) {
  return (
    event?.dotted === true ||
    (event?.notes ?? []).some((note) => note?.dotted === true)
  )
}

function hasLongNoteheadEvidence(event) {
  return (event?.notes ?? []).some(
    (note) =>
      note?.hollow === true ||
      note?.hollowGlyph === true ||
      note?.noteheadType === 'hollow',
  )
}

function primaryBeamOwnership(entry) {
  const owned = (entry?.ownerships ?? []).filter(
    (ownership) =>
      ownership?.beamGroupId &&
      (ownership?.attachedBeamIds?.length ?? 0) > 0 &&
      ownership?.beamCount === PRIMARY_BEAM_LEVEL &&
      Number(ownership?.beamConfidence ?? ownership?.confidence ?? 0) >=
        MIN_BEAM_CONFIDENCE,
  )
  const groupIds = [...new Set(owned.map((ownership) => ownership.beamGroupId))]
  if (groupIds.length !== 1) {
    return null
  }
  return {
    groupId: groupIds[0],
    confidence: Math.min(
      ...owned.map((ownership) =>
        Number(ownership?.beamConfidence ?? ownership?.confidence ?? 0),
      ),
    ),
  }
}

function writtenMetaForDuration(durationDivisions) {
  if (durationDivisions === OMR_DURATION_DIVISIONS.sixteenth) {
    return { durationType: 'sixteenth', dotted: false }
  }
  if (durationDivisions === OMR_DURATION_DIVISIONS.eighth) {
    return { durationType: 'eighth', dotted: false }
  }
  if (
    durationDivisions ===
    Math.round(OMR_DURATION_DIVISIONS.eighth * 1.5)
  ) {
    return { durationType: 'eighth', dotted: true }
  }
  return null
}

function correctedPrimaryBeamDuration(event, nextEvent) {
  if (hasDottedEvidence(event) || hasLongNoteheadEvidence(event)) {
    return null
  }
  const current = Number(event?.durationDivisions)
  if (!Number.isFinite(current)) {
    return null
  }
  if (nextEvent) {
    const gap =
      Number(nextEvent.startDivision) - Number(event?.startDivision ?? 0)
    const meta = writtenMetaForDuration(gap)
    if (
      meta &&
      gap >= OMR_DURATION_DIVISIONS.eighth &&
      current > gap
    ) {
      return { durationDivisions: gap, ...meta }
    }
    return writtenMetaForDuration(current)
      ? { durationDivisions: current, ...writtenMetaForDuration(current) }
      : null
  }
  // A strongly connected primary beam proves a short written value even when
  // measure packing stretched the final member to a quarter. Do not lengthen
  // already-short values or override explicit dot/hollow evidence.
  if (current > OMR_DURATION_DIVISIONS.eighth) {
    return {
      durationDivisions: OMR_DURATION_DIVISIONS.eighth,
      durationType: 'eighth',
      dotted: false,
    }
  }
  const meta = writtenMetaForDuration(current)
  return meta ? { durationDivisions: current, ...meta } : null
}

/**
 * Promote only strong, connected primary-beam topology from the diagnostic
 * graph into shared vector-event semantics.
 *
 * Secondary levels remain diagnostic-only because the current graph merges
 * adjacent segments and cannot yet distinguish partial secondary beams/hooks
 * without broadcasting them across the entire group.
 */
export function applyVectorPrimaryBeamTopology(
  events = [],
  beamStemGraph = null,
) {
  const byGroup = new Map()
  for (const entry of beamStemGraph?.eventOwnership ?? []) {
    if (!Number.isInteger(entry?.eventIndex)) {
      continue
    }
    const event = events[entry.eventIndex]
    if (
      event?.type !== 'note' ||
      event?.timeModification ||
      event?.tupletRecovered
    ) {
      continue
    }
    const ownership = primaryBeamOwnership(entry)
    if (!ownership) {
      continue
    }
    const members = byGroup.get(ownership.groupId) ?? []
    members.push({
      event,
      eventIndex: entry.eventIndex,
      confidence: ownership.confidence,
    })
    byGroup.set(ownership.groupId, members)
  }

  const replacements = new Map()
  for (const [groupId, rawMembers] of byGroup) {
    const members = [...rawMembers].sort(
      (left, right) =>
        Number(left.event?.startDivision ?? 0) -
          Number(right.event?.startDivision ?? 0) ||
        left.eventIndex - right.eventIndex,
    )
    if (
      members.length < 2 ||
      new Set(members.map((member) => member.event.startDivision)).size < 2
    ) {
      continue
    }
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index]
      const next = members[index + 1]?.event ?? null
      const duration =
        member.confidence >= MIN_DURATION_OVERRIDE_CONFIDENCE
          ? correctedPrimaryBeamDuration(member.event, next)
          : null
      replacements.set(member.event, {
        ...(duration ?? {}),
        beams: Math.max(PRIMARY_BEAM_LEVEL, Number(member.event.beams ?? 0)),
        beamTopologyGroupId: groupId,
        beamTopologyConfidence: member.confidence,
        beamTopologyApplied: true,
        beamTopologyDurationAdjusted:
          duration != null &&
          duration.durationDivisions !== member.event.durationDivisions,
      })
    }
  }

  if (!replacements.size) {
    return events
  }
  return events.map((event) => {
    const replacement = replacements.get(event)
    return replacement ? { ...event, ...replacement } : event
  })
}

export function summarizeAppliedVectorBeamTopology(events = []) {
  const applied = events.filter((event) => event?.beamTopologyApplied)
  return {
    appliedEventCount: applied.length,
    appliedGroupCount: new Set(
      applied.map((event) => event.beamTopologyGroupId).filter(Boolean),
    ).size,
    durationAdjustedCount: applied.filter(
      (event) => event.beamTopologyDurationAdjusted,
    ).length,
  }
}
