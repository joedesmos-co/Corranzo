/**
 * Guitar playability model for Audio Vision arrangements.
 *
 * A transcription can contain any set of pitches; a solo-guitar arrangement
 * must be playable by one hand. This module assigns string/fret positions with
 * HARD physical constraints (never a soft penalty that still exports the note):
 *
 *   - standard tuning (configurable), 19 frets by default;
 *   - no two simultaneous notes on the same string;
 *   - fretted span within the difficulty's max span (open strings excluded);
 *   - at most four fretted fingers (the lowest fret may barre);
 *   - a hand anchor and bounded travel between successive shapes.
 *
 * When a chord cannot be played exactly, notes are removed by priority
 * (melody first, then bass, then harmony) and the simplification is REPORTED
 * instead of exporting impossible TAB.
 */

// String 1 = highest-sounding (E4) ... string 6 = lowest (E2), matching
// instruments.js and the MusicXML <string> convention.
export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40]

export const DEFAULT_PLAYABILITY = Object.freeze({
  fretCount: 19,
  maxSpan: 4,
  maxFingers: 4,
  maxFret: 19,
  maxHandJump: 5,
  preferredMaxFret: 12,
})

export function positionsForMidi(tuning, midi, { fretCount = 19 } = {}) {
  const out = []
  for (let i = 0; i < tuning.length; i += 1) {
    const fret = Math.round(midi) - tuning[i]
    if (fret >= 0 && fret <= fretCount) out.push({ string: i + 1, fret })
  }
  return out
}

/** Structural facts about a candidate shape. */
export function describeShape(positions) {
  const fretted = positions.filter((p) => p.fret > 0)
  const frets = fretted.map((p) => p.fret)
  const span = frets.length > 1 ? Math.max(...frets) - Math.min(...frets) : 0
  const distinctFrets = new Set(frets)
  // The lowest fret may be a barre, so it costs one finger for any number of
  // strings; every other fretted fret costs one finger each.
  const minFret = frets.length ? Math.min(...frets) : null
  const fingers = frets.length
    ? 1 + [...distinctFrets].filter((f) => f !== minFret).length
    : 0
  const strings = positions.map((p) => p.string)
  return {
    span,
    fingers,
    minFret,
    maxFret: frets.length ? Math.max(...frets) : null,
    openStrings: positions.filter((p) => p.fret === 0).length,
    duplicateString: new Set(strings).size !== strings.length,
  }
}

/**
 * Hard feasibility check. Returns { playable, reasons }.
 * `requireAll` is not used here; callers drop notes and re-check.
 */
export function evaluateShape(positions, options = {}) {
  const opts = { ...DEFAULT_PLAYABILITY, ...options }
  const reasons = []
  if (!positions.length) return { playable: false, reasons: ['empty'] }
  const shape = describeShape(positions)
  if (shape.duplicateString) reasons.push('same-string-conflict')
  if (shape.span > opts.maxSpan) reasons.push(`span-${shape.span}-gt-${opts.maxSpan}`)
  if (shape.fingers > opts.maxFingers) reasons.push(`fingers-${shape.fingers}-gt-${opts.maxFingers}`)
  if (positions.some((p) => p.fret < 0 || p.fret > opts.fretCount)) reasons.push('out-of-range')
  if (shape.maxFret != null && shape.maxFret > opts.maxFret) reasons.push(`max-fret-${shape.maxFret}-gt-${opts.maxFret}`)
  return { playable: reasons.length === 0, reasons, shape }
}

function voicingCost(positions, { handFret, preferredMaxFret, melodyMidi, bassMidi }) {
  const shape = describeShape(positions)
  let cost = shape.span * 10 + shape.fingers * 2
  const anchor = shape.minFret
  if (handFret != null && anchor != null) cost += Math.abs(anchor - handFret) * 8
  for (const p of positions) {
    cost += p.fret * 0.5
    if (p.fret > preferredMaxFret) cost += (p.fret - preferredMaxFret) * 3
    if (p.fret === 0) cost -= 1.5
    // Melody near the top strings, bass near the bottom strings.
    if (melodyMidi != null && p.midi === melodyMidi && p.string <= 2) cost -= 4
    if (bassMidi != null && p.midi === bassMidi && p.string >= 5) cost -= 3
  }
  return cost
}

function searchVoicing(midis, opts) {
  const candidatesByMidi = midis.map((midi) => ({
    midi,
    positions: positionsForMidi(opts.tuning, midi, { fretCount: opts.fretCount }),
  }))
  if (candidatesByMidi.some((c) => c.positions.length === 0)) return null
  const product = candidatesByMidi.reduce((n, c) => n * c.positions.length, 1)
  if (product > 12000) return null // caller falls back to greedy-by-priority
  let best = null
  let bestCost = Infinity
  const chosen = []
  const usedStrings = new Set()
  function recurse(depth) {
    if (depth === midis.length) {
      const check = evaluateShape(chosen, opts)
      if (!check.playable) return
      const cost = voicingCost(chosen, opts)
      if (cost < bestCost) {
        bestCost = cost
        best = chosen.map((p) => ({ ...p }))
      }
      return
    }
    for (const pos of candidatesByMidi[depth].positions) {
      if (usedStrings.has(pos.string)) continue
      const trial = [...chosen, { ...pos, midi: candidatesByMidi[depth].midi }]
      // Early prune: a partial shape already over span cannot recover.
      const frets = trial.filter((p) => p.fret > 0).map((p) => p.fret)
      if (frets.length > 1 && Math.max(...frets) - Math.min(...frets) > opts.maxSpan) continue
      usedStrings.add(pos.string)
      chosen.push({ ...pos, midi: candidatesByMidi[depth].midi })
      recurse(depth + 1)
      chosen.pop()
      usedStrings.delete(pos.string)
    }
  }
  recurse(0)
  return best
}

/**
 * Choose a playable voicing for a set of simultaneous pitches.
 * Keeps melody first, then bass, then harmony; reports what was dropped.
 *
 * notes: [{ midi, isMelody, isBassRoot }]
 * Returns { positions: [{ midi, string, fret }], dropped: [{ midi, reason }], simplified }
 */
export function choosePlayableVoicing(notes, {
  tuning = STANDARD_TUNING,
  handFret = null,
  maxSpan = 4,
  maxFingers = 4,
  fretCount = 19,
  maxFret = 19,
  preferredMaxFret = 12,
} = {}) {
  const opts = { tuning, handFret, maxSpan, maxFingers, fretCount, maxFret, preferredMaxFret }
  const melodyMidi = notes.find((n) => n.isMelody)?.midi ?? null
  const bassMidi = notes.find((n) => n.isBassRoot)?.midi ?? null
  // Priority: melody, bass, then harmony by pitch proximity to the melody.
  const ordered = [...notes].sort((a, b) => {
    const pa = a.isMelody ? 0 : a.isBassRoot ? 1 : 2
    const pb = b.isMelody ? 0 : b.isBassRoot ? 1 : 2
    if (pa !== pb) return pa - pb
    return b.midi - a.midi
  })
  const kept = []
  const dropped = []
  // Try the full set, then progressively drop from the end (harmony first).
  for (let count = ordered.length; count >= 1; count -= 1) {
    const subset = ordered.slice(0, count)
    const voicing = searchVoicing(subset.map((n) => n.midi), { ...opts, melodyMidi, bassMidi })
    if (voicing) {
      // searchVoicing preserves subset order, so zip by index (never by midi:
      // two notes can share a pitch on different strings).
      const positions = voicing.map((p, i) => ({ ...p, note: subset[i] }))
      for (const n of ordered.slice(count)) {
        dropped.push({ midi: n.midi, reason: 'playability' })
      }
      void kept
      return { positions, dropped, simplified: dropped.length > 0 }
    }
  }
  // Even a single note failed (out of range): report it.
  for (const n of ordered) dropped.push({ midi: n.midi, reason: 'out-of-range' })
  return { positions: [], dropped, simplified: true }
}

/**
 * Validate a finished arrangement. Returns violations that MUST NOT be
 * exported as playable. Used as an independent gate before TAB output.
 */
export function validateGuitarArrangement(events, {
  maxSpan = 4,
  maxFingers = 4,
  maxFret = 19,
  maxHandJump = 5,
} = {}) {
  const violations = []
  const byOnset = new Map()
  for (const e of events) {
    const key = Number(e.startBeat ?? 0).toFixed(3)
    if (!byOnset.has(key)) byOnset.set(key, [])
    byOnset.get(key).push(e)
  }
  const onsets = [...byOnset.keys()].map(Number).sort((a, b) => a - b)
  let prevAnchor = null
  for (const onset of onsets) {
    const group = byOnset.get(onset.toFixed(3))
    const positions = group.map((e) => ({ string: e.string, fret: e.fret, midi: e.midi }))
    const check = evaluateShape(positions, { maxSpan, maxFingers, maxFret })
    if (!check.playable) {
      violations.push({ startBeat: onset, kind: 'unplayable-shape', reasons: check.reasons, events: group.length })
    }
    const anchor = check.shape.minFret
    if (prevAnchor != null && anchor != null && Math.abs(anchor - prevAnchor) > maxHandJump) {
      violations.push({ startBeat: onset, kind: 'hand-jump', detail: `${prevAnchor}->${anchor}` })
    }
    if (anchor != null) prevAnchor = anchor
  }
  return {
    playable: violations.length === 0,
    violations,
    onsets: onsets.length,
    playableOnsets: onsets.length - violations.filter((v) => v.kind === 'unplayable-shape').length,
  }
}
