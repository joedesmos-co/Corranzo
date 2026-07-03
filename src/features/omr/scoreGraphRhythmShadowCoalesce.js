/**
 * Phase 2C — merge same-voice same-start note events into chord events after phase shift.
 * Shadow-only; never mutates runtime output.
 */

function noteKey(note) {
  return `${note.midi}|${note.clef ?? 'treble'}`
}

function eventVoice(event) {
  if (event.type === 'rest') {
    return event.clef === 'bass' ? 2 : 1
  }
  return event.notes?.[0]?.clef === 'bass' ? 2 : 1
}

function cloneEvent(event) {
  return {
    ...event,
    notes: event.notes ? event.notes.map((note) => ({ ...note })) : undefined,
  }
}

/**
 * Two note events can merge when they share voice, onset, duration, and articulation flags.
 */
export function eventsMusicallyCompatibleForMerge(left, right) {
  if (left.type !== 'note' || right.type !== 'note') {
    return false
  }
  if (eventVoice(left) !== eventVoice(right)) {
    return false
  }
  if ((left.startDivision ?? 0) !== (right.startDivision ?? 0)) {
    return false
  }
  if ((left.durationDivisions ?? 0) !== (right.durationDivisions ?? 0)) {
    return false
  }
  if (Boolean(left.dotted) !== Boolean(right.dotted)) {
    return false
  }
  if (Boolean(left.tieStart) !== Boolean(right.tieStart)) {
    return false
  }
  if (Boolean(left.tieStop) !== Boolean(right.tieStop)) {
    return false
  }
  return true
}

function mergeNotesInto(target, source) {
  const seen = new Set((target.notes ?? []).map(noteKey))
  for (const note of source.notes ?? []) {
    const key = noteKey(note)
    if (!seen.has(key)) {
      target.notes.push({ ...note })
      seen.add(key)
    }
  }
}

/**
 * Coalesce colliding same-voice note events into chord events.
 */
export function coalesceSameVoiceChordEvents(events = []) {
  const rests = []
  const noteEvents = []
  for (const event of events) {
    if (event.type === 'rest') {
      rests.push(cloneEvent(event))
    } else if (event.type === 'note') {
      noteEvents.push(cloneEvent(event))
    }
  }

  const byVoiceStart = new Map()
  for (const event of noteEvents) {
    const voice = eventVoice(event)
    const start = event.startDivision ?? 0
    const key = `${voice}:${start}`
    if (!byVoiceStart.has(key)) {
      byVoiceStart.set(key, [])
    }
    byVoiceStart.get(key).push(event)
  }

  const mergedNotes = []
  const coalescedChords = []

  for (const [voiceStartKey, group] of byVoiceStart) {
    if (group.length === 1) {
      mergedNotes.push(group[0])
      continue
    }

    const clusters = []
    for (const event of group) {
      let placed = false
      for (const cluster of clusters) {
        if (eventsMusicallyCompatibleForMerge(cluster.representative, event)) {
          mergeNotesInto(cluster.event, event)
          placed = true
          break
        }
      }
      if (!placed) {
        clusters.push({ representative: event, event: cloneEvent(event) })
      }
    }

    for (const cluster of clusters) {
      mergedNotes.push(cluster.event)
      if ((cluster.event.notes?.length ?? 0) > 1 && group.length > 1) {
        const [voice, start] = voiceStartKey.split(':')
        coalescedChords.push({
          voice: Number(voice),
          startDivision: Number(start),
          noteCount: cluster.event.notes.length,
          mergedFromEvents: group.length,
        })
      }
    }
  }

  const merged = [...rests, ...mergedNotes].sort(
    (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
  )

  return {
    events: merged,
    coalescedChords,
    coalescedCount: coalescedChords.length,
  }
}
