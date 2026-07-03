/**
 * Fretboard math for fretted-string instruments.
 *
 * Pure functions over an instrument's `strings` config ({ count, tuning,
 * fretCount, preferredMaxFret }). String numbers follow the MusicXML
 * convention: string 1 = highest-sounding string.
 *
 * Position derivation is deliberately an MVP heuristic (lowest playable fret
 * with light hand-position continuity). Advanced fingering optimization is out
 * of scope; the data model — explicit positions always win over derived ones —
 * already supports replacing the heuristic later.
 */

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

function positionCost(candidate, handFret, preferredMaxFret) {
  // Lower frets read easier; open strings are free; drifting far from the
  // current hand position costs more than the fret number itself.
  const openBonus = candidate.fret === 0 ? -1.5 : 0
  const highPenalty = candidate.fret > preferredMaxFret ? (candidate.fret - preferredMaxFret) * 2 : 0
  const travel = handFret == null || candidate.fret === 0 ? 0 : Math.abs(candidate.fret - handFret)
  return candidate.fret + openBonus + highPenalty + travel * 1.25
}

/**
 * Best single position for one note given the current hand fret.
 */
export function stringFretForMidi(strings, midi, { handFret = null } = {}) {
  const candidates = candidatePositionsForMidi(strings, midi)
  if (!candidates.length) {
    return null
  }
  const preferredMaxFret = strings.preferredMaxFret ?? strings.fretCount
  let best = candidates[0]
  let bestCost = positionCost(best, handFret, preferredMaxFret)
  for (let index = 1; index < candidates.length; index += 1) {
    const cost = positionCost(candidates[index], handFret, preferredMaxFret)
    if (cost < bestCost) {
      best = candidates[index]
      bestCost = cost
    }
  }
  return best
}

/**
 * Assign distinct strings to a chord (simultaneous MIDI notes, any order).
 * Greedy from the highest pitch down; each note takes its cheapest remaining
 * string. Returns a Map midi → { string, fret } (misses omitted).
 */
export function assignChordPositions(strings, midis, { handFret = null } = {}) {
  const result = new Map()
  if (!strings?.tuning) {
    return result
  }
  const used = new Set()
  const sorted = [...new Set(midis)].sort((a, b) => b - a)
  const preferredMaxFret = strings.preferredMaxFret ?? strings.fretCount
  for (const midi of sorted) {
    const candidates = candidatePositionsForMidi(strings, midi).filter(
      (candidate) => !used.has(candidate.string),
    )
    if (!candidates.length) {
      continue
    }
    let best = candidates[0]
    let bestCost = positionCost(best, handFret, preferredMaxFret)
    for (let index = 1; index < candidates.length; index += 1) {
      const cost = positionCost(candidates[index], handFret, preferredMaxFret)
      if (cost < bestCost) {
        best = candidates[index]
        bestCost = cost
      }
    }
    used.add(best.string)
    result.set(midi, best)
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
 * positions; chord members (same onset) receive distinct strings.
 *
 * Returns a new array; never mutates input notes.
 */
export function deriveTabPositions(notes, strings, { chordEpsilonSeconds = 0.001 } = {}) {
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

  let index = 0
  while (index < output.length) {
    // Group simultaneous notes so chords get distinct strings.
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

    const pending = []
    for (const note of group) {
      if (note.isRest || note.midi == null) {
        continue
      }
      if (note.string != null && note.fret != null) {
        if (note.fret > 0) {
          handFret = note.fret
        }
        continue
      }
      pending.push(note)
    }

    if (pending.length === 1) {
      const position = stringFretForMidi(strings, pending[0].midi + octaveShift, { handFret })
      if (position) {
        pending[0].string = position.string
        pending[0].fret = position.fret
        pending[0].tabDerived = true
        if (position.fret > 0) {
          handFret = position.fret
        }
      }
    } else if (pending.length > 1) {
      const taken = new Set(
        group
          .filter((note) => note.string != null && note.fret != null)
          .map((note) => note.string),
      )
      const assigned = assignChordPositionsExcluding(
        strings,
        pending.map((note) => note.midi + octaveShift),
        taken,
        handFret,
      )
      for (const note of pending) {
        const position = assigned.get(note.midi + octaveShift)
        if (position) {
          note.string = position.string
          note.fret = position.fret
          note.tabDerived = true
        }
      }
      const fretted = pending.map((note) => note.fret).filter((fret) => fret > 0)
      if (fretted.length) {
        handFret = Math.min(...fretted)
      }
    }

    index = next
  }

  return output
}

function assignChordPositionsExcluding(strings, midis, takenStrings, handFret) {
  const result = new Map()
  const used = new Set(takenStrings)
  const preferredMaxFret = strings.preferredMaxFret ?? strings.fretCount
  const sorted = [...new Set(midis)].sort((a, b) => b - a)
  for (const midi of sorted) {
    const candidates = candidatePositionsForMidi(strings, midi).filter(
      (candidate) => !used.has(candidate.string),
    )
    if (!candidates.length) {
      continue
    }
    let best = candidates[0]
    let bestCost = positionCost(best, handFret, preferredMaxFret)
    for (let candidateIndex = 1; candidateIndex < candidates.length; candidateIndex += 1) {
      const cost = positionCost(candidates[candidateIndex], handFret, preferredMaxFret)
      if (cost < bestCost) {
        best = candidates[candidateIndex]
        bestCost = cost
      }
    }
    used.add(best.string)
    result.set(midi, best)
  }
  return result
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
