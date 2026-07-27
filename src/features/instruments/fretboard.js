/**
 * Fretboard math for fretted-string instruments.
 *
 * Pure functions over an instrument's `strings` config ({ count, tuning,
 * fretCount, preferredMaxFret }). String numbers follow the MusicXML
 * convention: string 1 = highest-sounding string.
 *
 * Explicit MusicXML/OMR positions always win. Derived positions use joint
 * chord search with hand-position continuity and sustain string occupancy.
 */

import { NOTE_TIME_GROUP_SECONDS } from '../practice/noteTimeGrouping.js'

/** Default playable fretted span inside one chord shape (open strings ignored). */
export const DEFAULT_MAX_CHORD_SPAN = 4


/** Sounding MIDI for a (string, fret); null when out of range. */
export function midiForStringFret(strings, stringNumber, fret) {
  if (!strings?.tuning || !Number.isFinite(stringNumber) || !Number.isFinite(fret)) {
    return null
  }
  const open = strings.tuning[stringNumber - 1]
  if (open == null || fret < 0 || fret > strings.fretCount) {
    return null
  }
  return open + fret
}

/** All playable (string, fret) candidates for a sounding MIDI note. */
export function candidatePositionsForMidi(strings, midi) {
  if (!strings?.tuning || !Number.isFinite(midi)) {
    return []
  }
  const candidates = []
  for (let index = 0; index < strings.tuning.length; index += 1) {
    const fret = midi - strings.tuning[index]
    if (fret >= 0 && fret <= strings.fretCount) {
      candidates.push({ string: index + 1, fret })
    }
  }
  return candidates
}

function frettedSpan(positions) {
  const frets = positions.map((position) => position.fret).filter((fret) => fret > 0)
  if (frets.length < 2) {
    return 0
  }
  return Math.max(...frets) - Math.min(...frets)
}

function positionCost(candidate, handFret, preferredMaxFret, { preferString = null } = {}) {
  // MVP low-fret preference with light continuity (open strings free unless a
  // preferred string is active — handled by hard retain in stringFretForMidi).
  const openBonus = candidate.fret === 0 ? -1.5 : 0
  const highPenalty =
    candidate.fret > preferredMaxFret ? (candidate.fret - preferredMaxFret) * 2 : 0
  const travel =
    handFret == null || candidate.fret === 0 ? 0 : Math.abs(candidate.fret - handFret)
  void preferString
  return candidate.fret + openBonus + highPenalty + travel * 1.25
}

function chordAssignmentCost(
  positions,
  { handFret = null, preferredMaxFret, preferByMidi = null, maxSpan = DEFAULT_MAX_CHORD_SPAN } = {},
) {
  const span = frettedSpan(positions)
  const fretted = positions.map((position) => position.fret).filter((fret) => fret > 0)
  const anchor = fretted.length ? Math.min(...fretted) : null
  const travel = handFret != null && anchor != null ? Math.abs(anchor - handFret) : 0
  let cost = travel * 12 + span * 6
  if (span > maxSpan) {
    cost += (span - maxSpan) * 40
  }
  for (const position of positions) {
    cost += position.fret * 0.55
    if (position.fret > preferredMaxFret) {
      cost += (position.fret - preferredMaxFret) * 2
    }
    if (position.fret === 0) {
      cost -= 0.8
    }
    const preferString = preferByMidi?.get(position.midi) ?? null
    if (preferString != null && position.string === preferString) {
      cost -= 6
    }
  }
  return cost
}

/**
 * Best single position for one note given the current hand fret.
 */
export function stringFretForMidi(
  strings,
  midi,
  { handFret = null, preferString = null, blockedStrings = null } = {},
) {
  const candidates = candidatePositionsForMidi(strings, midi).filter(
    (candidate) => !blockedStrings?.has(candidate.string),
  )
  if (!candidates.length) {
    return null
  }
  // Prefer the previous string for repeated pitches when it stays near the hand.
  if (preferString != null) {
    const retained = candidates.find((candidate) => candidate.string === preferString)
    if (
      retained &&
      (handFret == null ||
        retained.fret === 0 ||
        Math.abs(retained.fret - handFret) <= 4)
    ) {
      return retained
    }
  }
  const preferredMaxFret = strings.preferredMaxFret ?? strings.fretCount
  let best = candidates[0]
  let bestCost = positionCost(best, handFret, preferredMaxFret, { preferString })
  for (let index = 1; index < candidates.length; index += 1) {
    const cost = positionCost(candidates[index], handFret, preferredMaxFret, { preferString })
    if (cost < bestCost) {
      best = candidates[index]
      bestCost = cost
    }
  }
  return best
}

/**
 * Jointly assign distinct strings to a chord. Searches valid combinations and
 * scores span + continuity; falls back to greedy when the search space is huge.
 * Returns a Map midi → { string, fret } (misses omitted). Unison midis are not
 * supported here — use assignChordNotePositions for per-note unisons.
 */
export function assignChordPositions(
  strings,
  midis,
  { handFret = null, blockedStrings = null, preferByMidi = null } = {},
) {
  const result = new Map()
  if (!strings?.tuning) {
    return result
  }
  const unique = [...new Set(midis)]
  const pending = unique.map((midi) => ({ midi }))
  const taken = new Set(blockedStrings ?? [])
  assignChordNotePositions(strings, pending, taken, handFret, 0, preferByMidi)
  for (const note of pending) {
    if (note.string != null) {
      result.set(note.midi, { string: note.string, fret: note.fret })
    }
  }
  return result
}

/**
 * Octave fit: MusicXML guitar pitches are normally sounding pitch, but some
 * exports store written pitch (an octave up) without a clef octave-change.
 * Returns the semitone shift (0 or ±12) that makes the most notes playable.
 */
export function detectOctaveShiftForPlayability(strings, midis) {
  if (!strings?.tuning || !midis?.length) {
    return 0
  }
  const playable = (shift) =>
    midis.reduce(
      (count, midi) => count + (candidatePositionsForMidi(strings, midi + shift).length > 0 ? 1 : 0),
      0,
    )
  const asIs = playable(0)
  if (asIs >= midis.length * 0.98) {
    return 0
  }
  const down = playable(-12)
  const up = playable(12)
  if (down > asIs && down >= up) {
    return -12
  }
  if (up > asIs) {
    return 12
  }
  return 0
}

/**
 * Fill missing tab positions for a time-ordered note list.
 *
 * Notes with explicit `string`/`fret` (from MusicXML <technical> or OMR TAB)
 * are kept untouched and anchor the hand position. Others get derived
 * positions; chord members (same onset) receive jointly chosen distinct strings.
 *
 * Returns a new array; never mutates input notes. Never changes `midi`.
 */
export function deriveTabPositions(
  notes,
  strings,
  { chordEpsilonSeconds = NOTE_TIME_GROUP_SECONDS } = {},
) {
  if (!strings?.tuning || !Array.isArray(notes)) {
    return notes ?? []
  }

  const sounding = notes.filter((note) => !note.isRest && note.midi != null)
  const octaveShift = detectOctaveShiftForPlayability(
    strings,
    sounding.map((note) => note.midi),
  )

  const output = notes.map((note) => ({ ...note }))
  let handFret = null
  /** @type {Map<number, { midi: number, until: number }>} */
  const occupied = new Map()
  /** @type {Map<number, number>} midi → last string */
  const lastStringByMidi = new Map()

  let index = 0
  while (index < output.length) {
    const group = [output[index]]
    let next = index + 1
    while (
      next < output.length &&
      Math.abs((output[next].timeSeconds ?? 0) - (output[index].timeSeconds ?? 0)) <=
        chordEpsilonSeconds
    ) {
      group.push(output[next])
      next += 1
    }

    const onset = output[index].timeSeconds ?? 0
    // Release sustain locks that have ended before this onset.
    for (const [stringNumber, hold] of [...occupied.entries()]) {
      if (hold.until <= onset + 1e-6) {
        occupied.delete(stringNumber)
      }
    }

    const pending = []
    for (const note of group) {
      if (note.isRest || note.midi == null) {
        continue
      }
      if (note.string != null && note.fret != null) {
        if (note.fret > 0) {
          handFret = note.fret
        }
        lastStringByMidi.set(note.midi, note.string)
        const release = onset + (note.durationSeconds ?? 0)
        occupied.set(note.string, { midi: note.midi, until: release })
        continue
      }
      pending.push(note)
    }

    const blocked = new Set()
    for (const [stringNumber, hold] of occupied) {
      // A sustained different pitch occupies its string until release.
      if (
        hold.until > onset + 1e-6 &&
        !pending.some((note) => note.midi === hold.midi)
      ) {
        blocked.add(stringNumber)
      }
    }
    for (const note of group) {
      if (note.string != null && note.fret != null) {
        blocked.add(note.string)
      }
    }

    if (pending.length === 1) {
      const note = pending[0]
      const position = stringFretForMidi(strings, note.midi + octaveShift, {
        handFret,
        preferString: lastStringByMidi.get(note.midi) ?? null,
        blockedStrings: blocked,
      })
      if (position) {
        note.string = position.string
        note.fret = position.fret
        note.tabDerived = true
        if (position.fret > 0) {
          handFret = position.fret
        }
        lastStringByMidi.set(note.midi, position.string)
        occupied.set(position.string, {
          midi: note.midi,
          until: onset + (note.durationSeconds ?? 0),
        })
      }
    } else if (pending.length > 1) {
      assignChordNotePositions(
        strings,
        pending,
        blocked,
        handFret,
        octaveShift,
        lastStringByMidi,
      )
      const fretted = pending.map((note) => note.fret).filter((fret) => fret > 0)
      if (fretted.length) {
        handFret = Math.min(...fretted)
      }
      for (const note of pending) {
        if (note.string == null) {
          continue
        }
        lastStringByMidi.set(note.midi, note.string)
        occupied.set(note.string, {
          midi: note.midi,
          until: onset + (note.durationSeconds ?? 0),
        })
      }
    }

    index = next
  }

  return output
}

/**
 * Place each pending note on a free string via joint search when needed.
 * Tries a fast greedy pass first so open-position continuity stays intact;
 * joint search runs when greedy leaves gaps or an over-wide shape.
 */
function assignChordNotePositions(
  strings,
  pending,
  takenStrings,
  handFret,
  octaveShift = 0,
  preferByMidi = null,
) {
  const preferredMaxFret = strings.preferredMaxFret ?? strings.fretCount
  const used = new Set(takenStrings)
  const ordered = [...pending].sort(
    (left, right) => right.midi + octaveShift - (left.midi + octaveShift),
  )

  const greedyUsed = new Set(used)
  greedyAssignWithStrings(
    strings,
    ordered,
    greedyUsed,
    handFret,
    preferredMaxFret,
    octaveShift,
    preferByMidi,
  )
  const greedyComplete = ordered.every((note) => note.string != null)
  const greedySpan = frettedSpan(
    ordered.map((note) => ({ fret: note.fret ?? 0, string: note.string })),
  )
  if (greedyComplete && greedySpan <= DEFAULT_MAX_CHORD_SPAN) {
    return
  }

  // Reset for joint search.
  for (const note of ordered) {
    delete note.string
    delete note.fret
    delete note.tabDerived
  }

  const candidateLists = ordered.map((note) => {
    const midi = note.midi + octaveShift
    return candidatePositionsForMidi(strings, midi)
      .filter((candidate) => !used.has(candidate.string))
      .map((candidate) => ({ ...candidate, midi: note.midi }))
  })

  if (candidateLists.some((list) => !list.length)) {
    greedyAssignWithStrings(
      strings,
      ordered,
      new Set(used),
      handFret,
      preferredMaxFret,
      octaveShift,
      preferByMidi,
    )
    return
  }

  const searchSpace = candidateLists.reduce((product, list) => product * list.length, 1)
  if (searchSpace > 8000 || ordered.length > 6) {
    greedyAssignWithStrings(
      strings,
      ordered,
      new Set(used),
      handFret,
      preferredMaxFret,
      octaveShift,
      preferByMidi,
    )
    return
  }

  let best = null
  let bestCost = Infinity

  function search(depth, chosen, usedStrings) {
    if (depth === ordered.length) {
      const cost = chordAssignmentCost(chosen, {
        handFret,
        preferredMaxFret,
        preferByMidi,
      })
      if (cost < bestCost) {
        bestCost = cost
        best = chosen.map((position) => ({ ...position }))
      }
      return
    }
    for (const candidate of candidateLists[depth]) {
      if (usedStrings.has(candidate.string)) {
        continue
      }
      const trial = [...chosen, candidate]
      if (frettedSpan(trial) > DEFAULT_MAX_CHORD_SPAN + 3) {
        continue
      }
      usedStrings.add(candidate.string)
      search(depth + 1, trial, usedStrings)
      usedStrings.delete(candidate.string)
    }
  }

  search(0, [], new Set())
  if (!best) {
    greedyAssignWithStrings(
      strings,
      ordered,
      new Set(used),
      handFret,
      preferredMaxFret,
      octaveShift,
      preferByMidi,
    )
    return
  }

  for (let index = 0; index < ordered.length; index += 1) {
    ordered[index].string = best[index].string
    ordered[index].fret = best[index].fret
    ordered[index].tabDerived = true
  }
}

/** Greedy fallback with span-aware incremental cost. */
function greedyAssignWithStrings(
  strings,
  ordered,
  used,
  handFret,
  preferredMaxFret,
  octaveShift,
  preferByMidi,
) {
  const chosen = []
  for (const note of ordered) {
    const midi = note.midi + octaveShift
    const preferString = preferByMidi?.get(note.midi) ?? null
    const candidates = candidatePositionsForMidi(strings, midi).filter(
      (candidate) => !used.has(candidate.string),
    )
    if (!candidates.length) {
      continue
    }
    let best = null
    let bestCost = Infinity
    for (const candidate of candidates) {
      const trial = [...chosen, { ...candidate, midi: note.midi }]
      const cost =
        chordAssignmentCost(trial, {
          handFret,
          preferredMaxFret,
          preferByMidi,
        }) + (preferString != null && candidate.string === preferString ? -2 : 0)
      if (cost < bestCost) {
        best = candidate
        bestCost = cost
      }
    }
    if (!best) {
      continue
    }
    used.add(best.string)
    note.string = best.string
    note.fret = best.fret
    note.tabDerived = true
    chosen.push({ ...best, midi: note.midi })
  }
}

/** "3rd fret · B string" style label for one position. */
export function describeTabPosition(position, strings) {
  if (!position || position.string == null || position.fret == null) {
    return null
  }
  const open = strings?.tuning?.[position.string - 1]
  const stringName = open != null ? midiPitchClassName(open) : `string ${position.string}`
  if (position.fret === 0) {
    return `open ${stringName} string`
  }
  return `fret ${position.fret} · ${stringName} string`
}

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function midiPitchClassName(midi) {
  return PITCH_CLASS_NAMES[((midi % 12) + 12) % 12]
}
