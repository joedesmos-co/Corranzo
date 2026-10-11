/**
 * OSMD <-> canonical note identity.
 *
 * The practice engine owns musical truth (checkpoints, evaluator, clock).
 * This module only ANSWERS "which engraved graphical note is this
 * canonical note?" so the OSMD surface can paint engine states. It never
 * decides advancement, matching, or timing.
 *
 * Identity is (measure number, quarter position inside the measure, MIDI):
 *   - canonical notes come from the timing map (written measure + quarterTime)
 *   - OSMD notes come from the engraved score (measure number + timestamp)
 * OSMD timestamps are quarter-note units within their own measure.
 *
 * When a score's structure makes the match ambiguous (repeats, voices
 * colliding on the same beat/pitch) the match is flagged approximate
 * instead of pretending to an exact anchor.
 */

/** Engraved note states, mirroring the PDF overlay palette (see App.css). */
export const OSMD_NOTE_COLORS = {
  current: '#2563eb',
  'current-partial': '#2563eb',
  completed: '#3f9e5f',
  wrong: '#e0494b',
  missed: '#b56b6d',
  // Per-tone chord split inside a partial chord.
  toneDone: '#3f9e5f',
  toneNeeded: '#2563eb',
  /** Position marker only (Preview cursor note) — deliberately neutral. */
  cursor: '#1f2937',
}

export function canonicalNoteKey(measureNumber, quarterInMeasure, midi) {
  return `m${measureNumber}|q${Number(quarterInMeasure).toFixed(4)}|${midi}`
}

/** Written measure start (quarters) keyed by measure number. */
export function measureStartsByNumber(timingMap) {
  const map = new Map()
  for (const measure of timingMap?.measures ?? []) {
    if (Number.isFinite(measure?.number) && Number.isFinite(measure?.startQuarters)) {
      map.set(measure.number, measure.startQuarters)
    }
  }
  return map
}

/** True when the performed clock differs from the written score (repeats). */
export function timingUsesRepeats(timingMap) {
  const entries = timingMap?.performedMeasureTimeline?.entries ?? []
  return entries.some((entry) => Number(entry?.repeatPass ?? 1) > 1)
}

/**
 * Canonical identity keys for every sounding note in the timing map.
 * Returns { keys: Map<key, notes[]>, approximate }.
 */
export function canonicalNoteKeys(timingMap) {
  const starts = measureStartsByNumber(timingMap)
  const keys = new Map()
  const notes = (timingMap?.notes ?? []).filter(
    (note) => !note.isRest && Number.isFinite(note.midi) && Number.isFinite(note.quarterTime),
  )
  for (const note of notes) {
    const start = starts.get(note.measureNumber)
    const quarterInMeasure = Number.isFinite(start) ? note.quarterTime - start : note.quarterTime
    const key = canonicalNoteKey(note.measureNumber, quarterInMeasure, note.midi)
    if (!keys.has(key)) keys.set(key, [])
    keys.get(key).push(note)
  }
  return { keys, approximate: timingUsesRepeats(timingMap) }
}

/**
 * Read the engraved score out of a rendered OSMD instance.
 * Pure traversal of OSMD's model (no DOM), so it is unit-testable with a
 * fake graph. MusicXML TAB staves are included: `isTabNote` separates them
 * so the same canonical note maps to both the notation and TAB noteheads.
 */
export function collectOsmdNotes(osmd) {
  const listed = osmd?.GraphicSheet?.MeasureList ?? []
  const lines = listed.length && !Array.isArray(listed[0]) ? [listed] : listed
  const notes = []
  for (const line of lines) {
    for (const graphicalMeasure of line ?? []) {
      for (const staffEntry of graphicalMeasure?.staffEntries ?? []) {
        for (const voiceEntry of staffEntry?.graphicalVoiceEntries ?? []) {
          for (const graphicalNote of voiceEntry?.notes ?? []) {
            const source = graphicalNote?.sourceNote
            const quarterInMeasure = Number(
              source?.voiceEntry?.Timestamp?.RealValue ?? Number.NaN,
            )
            const measureNumber = Number(source?.sourceMeasure?.MeasureNumber)
            const pitchModel = source?.pitch ?? null
            const pitchFromModel =
              pitchModel && typeof pitchModel.getHalfTone === 'function'
                ? Number(pitchModel.getHalfTone())
                : Number.NaN
            // OSMD's model pitches are C0-based half tones (C4 = 48); the
            // canonical timing map uses MIDI (C4 = 60), hence the offset.
            const halfTones = [
              pitchFromModel + MIDI_OCTAVE_OFFSET,
              Number(pitchModel?.halfTone) + MIDI_OCTAVE_OFFSET,
              Number(source?.halfTone) + MIDI_OCTAVE_OFFSET,
            ].filter((value) => Number.isFinite(value))
            const midi = halfTones.length ? halfTones[0] : Number.NaN
            const lengthQuarters = Number(source?.length?.RealValue)
            if (!Number.isFinite(quarterInMeasure) || !Number.isFinite(measureNumber)) {
              continue
            }
            let isTab = false
            try {
              isTab = typeof graphicalNote.isTabNote === 'function' ? graphicalNote.isTabNote() : false
            } catch {
              isTab = false
            }
            notes.push({
              key: canonicalNoteKey(measureNumber, quarterInMeasure, midi),
              measureNumber,
              quarterInMeasure,
              midi,
              lengthQuarters,
              isRest: Boolean(source?.isRestFlag),
              isTab,
              string: Number.isFinite(Number(source?.stringNumberTab)) ? Number(source.stringNumberTab) : null,
              fret: Number.isFinite(Number(source?.fretNumber)) ? Number(source.fretNumber) : null,
              graphicalNote,
            })
          }
        }
      }
    }
  }
  return notes
}

/** Index OSMD notes by canonical key (notation + TAB staves both listed). */
export function buildOsmdNoteIndex(osmdNotes) {
  const index = new Map()
  for (const note of osmdNotes) {
    if (note.isRest) continue
    if (!index.has(note.key)) index.set(note.key, [])
    index.get(note.key).push(note)
  }
  return index
}

/** OSMD pitch offset: its model is C0-based, Corranzo is MIDI. */
const MIDI_OCTAVE_OFFSET = 12

/**
 * Ordered pairing of canonical notes and engraved notes.
 *
 * Exact quarter positions cannot match: the timing map reads MusicXML
 * sequentially (rests folded into the preceding note's duration), while the
 * engraver keeps the engraved onsets. Order within a measure and pitch is
 * identical on both sides, so notes are paired per (measure, pitch) in
 * document order — robust to rests, rhythm folding and ties.
 */
export function pairOsmdNotes(timingMap, osmdNotes) {
  const starts = measureStartsByNumber(timingMap)
  const canonicalByKey = new Map()
  for (const note of timingMap?.notes ?? []) {
    if (note.isRest || !Number.isFinite(note.midi) || !Number.isFinite(note.quarterTime)) continue
    const key = `${note.measureNumber}|${note.midi}`
    if (!canonicalByKey.has(key)) canonicalByKey.set(key, [])
    canonicalByKey.get(key).push(note)
  }
  const engravingByKey = new Map()
  for (const note of osmdNotes) {
    if (note.isRest) continue
    const key = `${note.measureNumber}|${note.midi}`
    if (!engravingByKey.has(key)) engravingByKey.set(key, [])
    engravingByKey.get(key).push(note)
  }
  const pairs = new Map()
  let unmatched = 0
  let approximate = timingUsesRepeats(timingMap)
  for (const [key, canonicalNotes] of canonicalByKey) {
    const engravings = (engravingByKey.get(key) ?? []).sort(
      (a, b) => a.quarterInMeasure - b.quarterInMeasure,
    )
    canonicalNotes.sort((a, b) => a.quarterTime - b.quarterTime)
    canonicalNotes.forEach((note, index) => {
      const engraving = engravings[index]
      if (!engraving) {
        unmatched += 1
        approximate = true
        pairs.set(note, [])
        return
      }
      pairs.set(note, [engraving])
    })
    if (engravings.length > canonicalNotes.length) {
      // Tie continuations appear as extra engraved pieces for one canonical
      // note: keep them with their parent instead of dropping them.
      const last = canonicalNotes[canonicalNotes.length - 1]
      if (last) {
        const existing = pairs.get(last) ?? []
        pairs.set(last, existing.concat(engravings.slice(canonicalNotes.length)))
      }
    }
  }
  return { pairs, unmatched, approximate }
}
export function matchCheckpointNotes(pairs, checkpoint) {
  const result = { notes: [], approximate: false, missing: 0 }
  if (!pairs || !checkpoint || !pairs.pairs) return result
  const measureNumber = Number(checkpoint.measureNumber)
  const timeSeconds = Number(checkpoint.timeSeconds)
  const expectedMidis = Array.isArray(checkpoint.expectedMidis) ? checkpoint.expectedMidis : []
  // Canonical notes of this checkpoint: same measure, same onset.
  const candidates = []
  for (const [note, engravings] of pairs.pairs) {
    if (note.measureNumber !== measureNumber) continue
    if (Math.abs(note.timeSeconds - timeSeconds) > 5e-3) continue
    if (expectedMidis.length && !expectedMidis.includes(note.midi)) continue
    if (engravings.length === 0) {
      result.missing += 1
      result.approximate = true
      continue
    }
    candidates.push(...engravings)
  }
  result.notes = candidates.sort((a, b) => a.quarterInMeasure - b.quarterInMeasure)
  if (pairs.approximate) result.approximate = true
  return result
}

/**
 * Written musical quarters (measure + position) at a practice time.
 * Interpolates between real note onsets — the same points playback uses —
 * so the engraved cursor lands on the notehead, not an average position.
 */
export function musicalQuartersAtTime(timingMap, seconds, measureStarts) {
  const notes = (timingMap?.notes ?? [])
    .filter((note) => !note.isRest && Number.isFinite(note.quarterTime) && Number.isFinite(note.timeSeconds))
    .slice()
    .sort((a, b) => a.timeSeconds - b.timeSeconds || a.quarterTime - b.quarterTime)
  if (notes.length === 0 || !Number.isFinite(seconds)) {
    return { quarter: null, measureNumber: null, found: false, approximate: false }
  }
  const total = Math.max(...notes.map((note) => note.timeSeconds + (note.durationSeconds ?? 0)))
  const clamped = Math.max(0, Math.min(seconds, total))
  let previous = notes[0]
  for (let i = 1; i < notes.length; i += 1) {
    const current = notes[i]
    if (clamped <= current.timeSeconds + 1e-6) {
      const span = current.timeSeconds - previous.timeSeconds
      if (span <= 1e-6) {
        continue
      }
      const ratio = (clamped - previous.timeSeconds) / span
      const quarter = previous.quarterTime + ratio * (current.quarterTime - previous.quarterTime)
      const measureNumber = ratio < 0.5 ? previous.measureNumber : current.measureNumber
      return { quarter, measureNumber, found: true, approximate: timingUsesRepeats(timingMap) }
    }
    previous = current
  }
  const last = notes[notes.length - 1]
  return {
    quarter: last.quarterTime,
    measureNumber: last.measureNumber,
    found: true,
    approximate: timingUsesRepeats(timingMap),
  }
}

/** Position (measure, quarter inside measure) of the cursor for OSMD. */
export function cursorPositionFor(quarter, measureStarts) {
  if (!Number.isFinite(quarter) || !measureStarts || measureStarts.size === 0) {
    return null
  }
  let measureNumber = null
  let start = 0
  for (const [number, quarters] of measureStarts) {
    if (quarter + 1e-6 >= quarters && quarters >= start) {
      measureNumber = number
      start = quarters
    }
  }
  if (measureNumber == null) {
    return null
  }
  return { measureNumber, quarterInMeasure: Math.max(0, quarter - start) }
}

/**
 * Walk the OSMD cursor to a musical position without resetting from 0.
 * Monotonic walking keeps seeks cheap in the common case; a backward jump
 * resets once and replays forward (bounded by the score's note count).
 */
export function moveOsmdCursor(cursor, target) {
  if (!cursor || !target) return false
  const current = Number(cursor.Iterator?.currentTimeStamp?.RealValue ?? Number.NaN)
  if (Number.isFinite(current) && current > target.quarterInMeasure + 1e-6) {
    cursor.reset()
  }
  let guard = 0
  while (Number(cursor.Iterator?.currentTimeStamp?.RealValue ?? 0) < target.quarterInMeasure - 1e-6) {
    if (!cursor.next()) break
    guard += 1
    if (guard > 20000) break
  }
  if (cursor.Hidden) cursor.show()
  cursor.update()
  return true
}
