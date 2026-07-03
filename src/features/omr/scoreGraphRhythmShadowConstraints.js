/**
 * Phase 2B — structural preservation checks for shadow rhythm solver variants.
 * Rejects phase shifts that trade onset alignment for chord/duration regressions.
 */

export const RHYTHM_SHADOW_REJECT = {
  NOTE_COUNT_CHANGED: 'note-count-changed',
  DURATION_CHANGED: 'duration-changed',
  CHORD_SPLIT: 'chord-split',
  SAME_START_COLLISION: 'same-start-collision',
  ONSET_GROUP_REGRESSION: 'onset-group-regression',
}

function noteKey(note) {
  return `${note.midi}|${note.clef ?? 'treble'}`
}

function eventVoice(event) {
  if (event.type === 'rest') {
    return event.clef === 'bass' ? 2 : 1
  }
  return event.notes?.[0]?.clef === 'bass' ? 2 : 1
}

function totalNoteCount(events = []) {
  let count = 0
  for (const event of events) {
    if (event.type === 'note') {
      count += event.notes?.length ?? 0
    }
  }
  return count
}

function eventContainsNoteKey(event, key) {
  return event.type === 'note' && (event.notes ?? []).some((note) => noteKey(note) === key)
}

function sameVoiceStartCollisions(events = []) {
  const byVoiceStart = new Map()
  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    const voice = eventVoice(event)
    const start = event.startDivision ?? 0
    const key = `${voice}:${start}`
    if (!byVoiceStart.has(key)) {
      byVoiceStart.set(key, [])
    }
    byVoiceStart.get(key).push(event)
  }
  return [...byVoiceStart.values()].filter((group) => group.length > 1)
}

function detectChordSplits(baselineEvents = [], candidateEvents = []) {
  for (const baseEvent of baselineEvents) {
    if (baseEvent.type !== 'note' || (baseEvent.notes?.length ?? 0) < 2) {
      continue
    }
    const keys = (baseEvent.notes ?? []).map(noteKey)
    const matchingEvents = candidateEvents.filter(
      (event) => event.type === 'note' && keys.some((key) => eventContainsNoteKey(event, key)),
    )
    if (matchingEvents.length !== 1) {
      return true
    }
    const candidateEvent = matchingEvents[0]
    if ((candidateEvent.notes?.length ?? 0) !== keys.length) {
      return true
    }
    const candidateKeys = new Set((candidateEvent.notes ?? []).map(noteKey))
    if (!keys.every((key) => candidateKeys.has(key))) {
      return true
    }
  }
  return false
}

function durationsUnchanged(baselineEvents = [], variantEvents = []) {
  const variantByKey = new Map()
  for (const event of variantEvents) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      variantByKey.set(noteKey(note), event.durationDivisions ?? 0)
    }
  }
  for (const event of baselineEvents) {
    if (event.type !== 'note') {
      continue
    }
    const duration = event.durationDivisions ?? 0
    for (const note of event.notes ?? []) {
      if (variantByKey.get(noteKey(note)) !== duration) {
        return false
      }
    }
  }
  return true
}

function collectOnsetGroups(events = [], toleranceDivisions = 1) {
  const notes = []
  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      notes.push({
        onset: event.startDivision ?? 0,
        midi: note.midi,
      })
    }
  }
  notes.sort((left, right) => left.onset - right.onset || left.midi - right.midi)

  const groups = []
  for (const note of notes) {
    let group = groups.find((entry) => Math.abs(entry.onset - note.onset) <= toleranceDivisions)
    if (!group) {
      group = { onset: note.onset, notes: [] }
      groups.push(group)
    }
    group.notes.push(note)
    group.onset =
      group.notes.reduce((sum, entry) => sum + entry.onset, 0) / group.notes.length
  }
  return groups.map((group) => group.notes.length).sort((left, right) => left - right)
}

function onsetGroupRegression(baselineEvents = [], variantEvents = [], toleranceDivisions = 1) {
  const baselineSizes = collectOnsetGroups(baselineEvents, toleranceDivisions)
  const variantSizes = collectOnsetGroups(variantEvents, toleranceDivisions)
  const baselineSingletons = baselineSizes.filter((size) => size === 1).length
  const variantSingletons = variantSizes.filter((size) => size === 1).length
  const baselineMulti = baselineSizes.filter((size) => size > 1).length
  const variantMulti = variantSizes.filter((size) => size > 1).length

  if (variantSingletons > baselineSingletons) {
    return true
  }
  if (variantMulti < baselineMulti) {
    return true
  }
  if (baselineSizes.join(',') !== variantSizes.join(',')) {
    const baselineMass = baselineSizes.reduce((sum, size) => sum + size, 0)
    const variantMass = variantSizes.reduce((sum, size) => sum + size, 0)
    if (variantMass !== baselineMass) {
      return true
    }
  }
  return false
}

/**
 * Reject shadow variants that would break chord grouping or note/duration invariants.
 */
export function validateRhythmShadowPreservation(baselineEvents = [], variantEvents = [], options = {}) {
  const toleranceDivisions = options.onsetToleranceDivisions ?? 1
  const violations = []

  if (totalNoteCount(baselineEvents) !== totalNoteCount(variantEvents)) {
    violations.push(RHYTHM_SHADOW_REJECT.NOTE_COUNT_CHANGED)
  }

  if (!durationsUnchanged(baselineEvents, variantEvents)) {
    violations.push(RHYTHM_SHADOW_REJECT.DURATION_CHANGED)
  }

  if (detectChordSplits(baselineEvents, variantEvents)) {
    violations.push(RHYTHM_SHADOW_REJECT.CHORD_SPLIT)
  }

  const baselineCollisions = sameVoiceStartCollisions(baselineEvents)
  const variantCollisions = sameVoiceStartCollisions(variantEvents)
  if (variantCollisions.length > baselineCollisions.length) {
    violations.push(RHYTHM_SHADOW_REJECT.SAME_START_COLLISION)
  }

  if (onsetGroupRegression(baselineEvents, variantEvents, toleranceDivisions)) {
    violations.push(RHYTHM_SHADOW_REJECT.ONSET_GROUP_REGRESSION)
  }

  return {
    pass: violations.length === 0,
    violations,
    baselineCollisions: baselineCollisions.length,
    variantCollisions: variantCollisions.length,
  }
}

function maxBaselineDurationByNoteKey(baselineEvents = []) {
  const map = new Map()
  for (const event of baselineEvents) {
    if (event.type !== 'note') {
      continue
    }
    const duration = event.durationDivisions ?? 0
    for (const note of event.notes ?? []) {
      const key = noteKey(note)
      map.set(key, Math.max(map.get(key) ?? 0, duration))
    }
  }
  return map
}

function durationsOnlyShortenedOrUnchanged(baselineEvents = [], variantEvents = []) {
  const baselineMax = maxBaselineDurationByNoteKey(baselineEvents)
  for (const event of variantEvents) {
    if (event.type !== 'note') {
      continue
    }
    const duration = event.durationDivisions ?? 0
    for (const note of event.notes ?? []) {
      const key = noteKey(note)
      const allowed = baselineMax.get(key)
      if (allowed == null) {
        return false
      }
      if (duration > allowed) {
        return false
      }
    }
  }
  return true
}

/**
 * Phase 7 — preservation for duration-coupled lane variants.
 * Allows intentional onset moves and duration shortening; never lengthens.
 */
export function validateDurationCoupledPreservation(baselineEvents = [], variantEvents = [], options = {}) {
  const violations = []

  if (totalNoteCount(baselineEvents) !== totalNoteCount(variantEvents)) {
    violations.push(RHYTHM_SHADOW_REJECT.NOTE_COUNT_CHANGED)
  }

  if (!durationsOnlyShortenedOrUnchanged(baselineEvents, variantEvents)) {
    violations.push(RHYTHM_SHADOW_REJECT.DURATION_CHANGED)
  }

  if (detectChordSplits(baselineEvents, variantEvents)) {
    violations.push(RHYTHM_SHADOW_REJECT.CHORD_SPLIT)
  }

  const baselineCollisions = sameVoiceStartCollisions(baselineEvents)
  const variantCollisions = sameVoiceStartCollisions(variantEvents)
  if (variantCollisions.length > baselineCollisions.length) {
    violations.push(RHYTHM_SHADOW_REJECT.SAME_START_COLLISION)
  }

  return {
    pass: violations.length === 0,
    violations,
    baselineCollisions: baselineCollisions.length,
    variantCollisions: variantCollisions.length,
  }
}
