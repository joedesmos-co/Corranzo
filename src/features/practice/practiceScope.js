import { INSTRUMENT_IDS, normalizeInstrumentId } from '../instruments/instruments.js'

export const PRACTICE_SCOPE = {
  RIGHT_HAND: 'right-hand',
  LEFT_HAND: 'left-hand',
  BOTH_HANDS: 'both-hands',
}

export const PRACTICE_SCOPE_LABELS = {
  [PRACTICE_SCOPE.RIGHT_HAND]: 'Right hand',
  [PRACTICE_SCOPE.LEFT_HAND]: 'Left hand',
  [PRACTICE_SCOPE.BOTH_HANDS]: 'Both hands',
}

const HAND_BY_SCOPE = {
  [PRACTICE_SCOPE.RIGHT_HAND]: 'right',
  [PRACTICE_SCOPE.LEFT_HAND]: 'left',
}

export function normalizePracticeScope(scope) {
  return Object.values(PRACTICE_SCOPE).includes(scope)
    ? scope
    : PRACTICE_SCOPE.BOTH_HANDS
}

function partRole(part) {
  if (!part) {
    return null
  }
  const name = String(part.name ?? '')
  if (/\b(left|lh|bass)\b/i.test(name)) {
    return 'left'
  }
  if (/\b(right|rh|treble)\b/i.test(name)) {
    return 'right'
  }
  const clefs = part.clefs ?? []
  if (clefs.some((clef) => clef.sign === 'F')) {
    return 'left'
  }
  if (clefs.some((clef) => clef.sign === 'G')) {
    return 'right'
  }
  return null
}

function partById(timingMap) {
  return new Map((timingMap?.parts ?? []).map((part) => [part.id, part]))
}

export function resolveNotePracticeHand(note, timingMap = null) {
  if (!note || note.isRest || note.midi == null) {
    return null
  }

  const part = partById(timingMap).get(note.partId)
  if ((part?.staves ?? 1) > 1) {
    if (note.staff === 1) return 'right'
    if (note.staff === 2) return 'left'
  }

  const role = partRole(part)
  if (role) {
    return role
  }

  if (note.staff === 1 && (timingMap?.stavesPerSystem ?? 1) > 1) {
    return 'right'
  }
  if (note.staff === 2) {
    return 'left'
  }

  return null
}

export function practiceScopeAppliesToTimingMap(timingMap, instrumentId) {
  if (normalizeInstrumentId(instrumentId) !== INSTRUMENT_IDS.PIANO) {
    return false
  }
  if (!timingMap?.notes?.length) {
    return false
  }
  if ((timingMap.stavesPerSystem ?? 1) < 2) {
    return false
  }

  const hands = new Set()
  for (const note of timingMap.notes) {
    const hand = resolveNotePracticeHand(note, timingMap)
    if (hand) {
      hands.add(hand)
    }
  }
  return hands.has('right') && hands.has('left')
}

export function noteMatchesPracticeScope(note, practiceScope, timingMap = null) {
  const scope = normalizePracticeScope(practiceScope)
  const targetHand = HAND_BY_SCOPE[scope]
  if (!targetHand) {
    return true
  }
  const hand = resolveNotePracticeHand(note, timingMap)
  return hand == null || hand === targetHand
}

export function filterNotesForPracticeScope(notes, practiceScope, timingMap = null) {
  const scope = normalizePracticeScope(practiceScope)
  if (scope === PRACTICE_SCOPE.BOTH_HANDS) {
    return notes
  }
  return (notes ?? []).filter((note) =>
    noteMatchesPracticeScope(note, scope, timingMap),
  )
}
