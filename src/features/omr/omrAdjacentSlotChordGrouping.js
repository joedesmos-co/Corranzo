/**
 * Conservative adjacent-slot exception for stacked chord tones.
 * Used only when provisional beat slots differ by exactly one.
 * Does not loosen same-slot grouping.
 */

import { OMR_CHORD_MERGE_X } from './omrRhythmConstants.js'

/** Tight horizontal gate for crossing a slot boundary (px). */
export const ADJACENT_SLOT_MAX_DX = OMR_CHORD_MERGE_X

/** Minimum vertical separation (px) treated as stacked chord heads. */
const VERTICAL_STACK_MIN_DY = 8

let activeDiagnostics = null

export function beginAdjacentSlotDiagnostics() {
  activeDiagnostics = {
    attempted: 0,
    accepted: 0,
    rejected: 0,
    reasons: {},
    samples: [],
  }
  return activeDiagnostics
}

export function takeAdjacentSlotDiagnostics() {
  const snapshot = activeDiagnostics
  activeDiagnostics = null
  return snapshot
}

export function peekAdjacentSlotDiagnostics() {
  return activeDiagnostics
}

function record(decision, reason, detail = null) {
  if (!activeDiagnostics) {
    return
  }
  activeDiagnostics.attempted += 1
  if (decision === 'accept') {
    activeDiagnostics.accepted += 1
  } else {
    activeDiagnostics.rejected += 1
    activeDiagnostics.reasons[reason] = (activeDiagnostics.reasons[reason] ?? 0) + 1
  }
  if (activeDiagnostics.samples.length < 24) {
    activeDiagnostics.samples.push({ decision, reason, detail })
  }
}

function noteStemDirection(note) {
  if (typeof note?.stem === 'string') {
    return note.stem
  }
  if (typeof note?.stemDirection === 'string') {
    return note.stemDirection
  }
  return note?.stem?.direction ?? null
}

function noteStaffKey(note) {
  if (note?.staff != null) {
    return String(note.staff)
  }
  return note?.clef ?? 'treble'
}

function noteBeamGroup(note) {
  return note?.beamGroupId ?? note?.beamGroup ?? null
}

function noteStemGroup(note) {
  return note?.stemGroupId ?? note?.stemGroup ?? null
}

function isGraceOrOrnament(note) {
  return Boolean(note?.isGrace || note?.grace || note?.ornament)
}

function pairMinDx(leftNotes, rightNotes) {
  let minDx = Infinity
  for (const left of leftNotes) {
    for (const right of rightNotes) {
      if (!Number.isFinite(left?.cx) || !Number.isFinite(right?.cx)) {
        continue
      }
      minDx = Math.min(minDx, Math.abs(left.cx - right.cx))
    }
  }
  return Number.isFinite(minDx) ? minDx : null
}

function pairMaxDx(leftNotes, rightNotes) {
  let maxDx = 0
  let saw = false
  for (const left of leftNotes) {
    for (const right of rightNotes) {
      if (!Number.isFinite(left?.cx) || !Number.isFinite(right?.cx)) {
        continue
      }
      saw = true
      maxDx = Math.max(maxDx, Math.abs(left.cx - right.cx))
    }
  }
  return saw ? maxDx : null
}

function hasOpposingStems(leftNotes, rightNotes) {
  const leftDirs = new Set(
    leftNotes.map(noteStemDirection).filter((value) => value === 'up' || value === 'down'),
  )
  const rightDirs = new Set(
    rightNotes.map(noteStemDirection).filter((value) => value === 'up' || value === 'down'),
  )
  if (!leftDirs.size || !rightDirs.size) {
    return false
  }
  return (
    (leftDirs.has('up') && rightDirs.has('down')) ||
    (leftDirs.has('down') && rightDirs.has('up'))
  )
}

function hasSharedStemGroup(leftNotes, rightNotes) {
  const leftGroups = new Set(leftNotes.map(noteStemGroup).filter(Boolean))
  const rightGroups = new Set(rightNotes.map(noteStemGroup).filter(Boolean))
  for (const group of leftGroups) {
    if (rightGroups.has(group)) {
      return true
    }
  }
  return false
}

function hasCompatibleStemOwnership(leftNotes, rightNotes) {
  if (hasSharedStemGroup(leftNotes, rightNotes)) {
    return true
  }
  const leftDirs = [
    ...new Set(
      leftNotes.map(noteStemDirection).filter((value) => value === 'up' || value === 'down'),
    ),
  ]
  const rightDirs = [
    ...new Set(
      rightNotes.map(noteStemDirection).filter((value) => value === 'up' || value === 'down'),
    ),
  ]
  if (!leftDirs.length || !rightDirs.length) {
    return true
  }
  return leftDirs.some((direction) => rightDirs.includes(direction))
}

function hasStrongVerticalStackEvidence(leftNotes, rightNotes) {
  for (const left of leftNotes) {
    for (const right of rightNotes) {
      if (!Number.isFinite(left?.cy) || !Number.isFinite(right?.cy)) {
        continue
      }
      const dy = Math.abs(left.cy - right.cy)
      const dx =
        Number.isFinite(left.cx) && Number.isFinite(right.cx)
          ? Math.abs(left.cx - right.cx)
          : Infinity
      if (dy >= VERTICAL_STACK_MIN_DY && dx <= ADJACENT_SLOT_MAX_DX) {
        return true
      }
      if (
        Number.isFinite(left.midi) &&
        Number.isFinite(right.midi) &&
        Math.abs(left.midi - right.midi) >= 2 &&
        dx <= ADJACENT_SLOT_MAX_DX
      ) {
        return true
      }
    }
  }
  return false
}

function hasConflictingBeamGroups(leftNotes, rightNotes) {
  const leftGroups = new Set(leftNotes.map(noteBeamGroup).filter(Boolean))
  const rightGroups = new Set(rightNotes.map(noteBeamGroup).filter(Boolean))
  if (!leftGroups.size || !rightGroups.size) {
    // Distinct beam counts without shared ids: treat as conflicting when both
    // sides are explicitly beamed (neighboring beamed attacks).
    const leftBeamed = leftNotes.some((note) => (note?.beams ?? 0) >= 1)
    const rightBeamed = rightNotes.some((note) => (note?.beams ?? 0) >= 1)
    if (leftBeamed && rightBeamed && !hasSharedStemGroup(leftNotes, rightNotes)) {
      return true
    }
    return false
  }
  for (const group of leftGroups) {
    if (rightGroups.has(group)) {
      return false
    }
  }
  return true
}

function sameStaff(leftNotes, rightNotes) {
  const leftStaff = new Set(leftNotes.map(noteStaffKey))
  const rightStaff = new Set(rightNotes.map(noteStaffKey))
  if (leftStaff.size !== 1 || rightStaff.size !== 1) {
    return false
  }
  return [...leftStaff][0] === [...rightStaff][0]
}

/**
 * Decide whether two note collections in adjacent provisional slots may share
 * a chord group. Returns { ok, reason }.
 */
export function evaluateAdjacentSlotChordShare(leftNotes = [], rightNotes = [], {
  chordMergeX = OMR_CHORD_MERGE_X,
} = {}) {
  const left = leftNotes.filter(Boolean)
  const right = rightNotes.filter(Boolean)
  if (!left.length || !right.length) {
    return { ok: false, reason: 'empty-side' }
  }

  if (!sameStaff(left, right)) {
    return { ok: false, reason: 'different-staff' }
  }

  if (left.some(isGraceOrOrnament) || right.some(isGraceOrOrnament)) {
    return { ok: false, reason: 'grace-or-ornament' }
  }

  const minDx = pairMinDx(left, right)
  const maxDx = pairMaxDx(left, right)
  const dxGate = Math.min(ADJACENT_SLOT_MAX_DX, chordMergeX)
  if (minDx == null || minDx > dxGate) {
    return { ok: false, reason: 'dx-above-threshold', detail: { minDx, dxGate } }
  }
  if (maxDx != null && maxDx > dxGate) {
    return { ok: false, reason: 'implausible-horizontal-span', detail: { maxDx, dxGate } }
  }

  if (hasOpposingStems(left, right) && !hasSharedStemGroup(left, right)) {
    return { ok: false, reason: 'opposing-stems-independent-voice' }
  }

  if (hasConflictingBeamGroups(left, right)) {
    return { ok: false, reason: 'conflicting-beam-group' }
  }

  const stemOk = hasCompatibleStemOwnership(left, right)
  const stackOk = hasStrongVerticalStackEvidence(left, right)
  if (!stemOk && !stackOk) {
    return { ok: false, reason: 'no-stem-or-stack-evidence' }
  }

  return {
    ok: true,
    reason: stemOk && stackOk ? 'stem-and-stack' : stemOk ? 'compatible-stem' : 'vertical-stack',
    detail: { minDx, maxDx, dxGate },
  }
}

/**
 * When slots differ by exactly one, apply the conservative adjacent-slot chord
 * exception. Records diagnostics when a collector is active.
 */
export function adjacentSlotChordShareAllowed(leftNotes, rightNotes, options = {}) {
  const verdict = evaluateAdjacentSlotChordShare(leftNotes, rightNotes, options)
  record(verdict.ok ? 'accept' : 'reject', verdict.reason, verdict.detail ?? null)
  return verdict.ok
}
