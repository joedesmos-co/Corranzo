/**
 * A5 — Solo guitar arrangement: ONE playable guitar part, standard tuning,
 * realistic string/fret via existing fretboard.js. Standard notation + TAB
 * (<technical> string/fret) downstream.
 */
import { PROVENANCE } from './musicAnalysis.js'
import { resolveSimultaneous, selectTexture, chooseMelodyMidi } from './arrangementModel.js'
import { paramsForDifficulty } from './difficulty.js'
import { STANDARD_GUITAR_TUNING } from '../instruments/instruments.js'
import { choosePlayableVoicing, positionsForMidi, validateGuitarArrangement } from './guitarPlayability.js'

export const GUITAR_STRINGS = {
  count: 6,
  tuning: STANDARD_GUITAR_TUNING, // E2 A2 D3 G3 B3 E4 sounding
  fretCount: 19,
  preferredMaxFret: 12,
}
export const GUITAR_MIN = 40 // E2
// Registry labels the top E6 (88), but the 19-fret board tops out at 83
// (B5); the per-note position check below enforces the real board.
export const GUITAR_MAX = 88 // nominal top; positions decide playability

/**
 * Arrange into single guitar events with string/fret.
 * { midi, startBeat, durBeats, string, fret, role, positionShift }
 */
export function arrangeSoloGuitar({ quantizedNotes, chords, difficulty, beatsPerMeasure = 4, capo = 0, tuning = null, melodyContour = null }) {
  const params = paramsForDifficulty(difficulty)
  const strings = tuning ? { ...GUITAR_STRINGS, tuning } : GUITAR_STRINGS
  const tuningValues = strings.tuning
  const maxSpan = params.maxFretSpan
  const byOnset = new Map()
  for (const n of quantizedNotes) {
    const key = Math.round((n.quantizedStartBeat ?? 0) * 4) / 4
    if (!byOnset.has(key)) byOnset.set(key, [])
    // A5: never pre-clamp out-of-range pitches — the range logic below
    // transposes deliberately (marked) or drops honestly (warned).
    byOnset.get(key).push({ ...n, midi: Math.round(n.midi) })
  }
  const events = []
  const warnings = []
  const droppedNotes = []
  let handFret = null
  const sortedOnsets = [...byOnset.keys()].sort((a, b) => a - b)
  for (const onset of sortedOnsets) {
    const group = byOnset.get(onset)
    const measureIndex = Math.floor(Math.max(0, onset) / beatsPerMeasure)
    const sorted = [...group].sort((a, b) => b.midi - a.midi)
    const contourBeat = melodyContour?.get?.(Math.round(onset * 2) / 2)
    const melodyMidi = chooseMelodyMidi(sorted.map((n) => n.midi), contourBeat) ?? sorted[0]?.midi ?? null
    const tagged = sorted.map((n, i) => ({
      ...n,
      isMelody: n.midi === melodyMidi,
      isBassRoot: sorted.length > 1 && i === sorted.length - 1 && n.midi !== melodyMidi,
      isChordTone: true,
      isPassingTone: false,
      strength: n.strength ?? 0.5,
      melodyMidi,
      measureIndex,
    }))
    // Melody comes from the DETECTED contour (evidence) so an upper octave
    // shadow cannot take the melody role and strand the real line.
    const resolved = resolveSimultaneous(tagged, { maxVoices: Math.min(4, params.maxVoicesPerOnset + 1), melodyMidi })
      .filter((e) => e.kept)
    const texture = selectTexture({ noteDensity: group.length, chordConfidence: 0.5, difficulty })
    // Deliberate octave transposition before dropping. A note outside the
    // guitar range is tried an octave down (high) or up (low) and marked
    // octaveShifted — never silently clamped to a nearby pitch.
    const ranged = []
    for (const r of resolved) {
      if (r.midi >= GUITAR_MIN && r.midi <= GUITAR_MAX) {
        ranged.push(r)
        continue
      }
      const shifted = r.midi > GUITAR_MAX ? r.midi - 12 : r.midi + 12
      if (shifted >= GUITAR_MIN && shifted <= GUITAR_MAX && positionsForMidi(tuningValues, shifted, { fretCount: strings.fretCount }).length > 0) {
        ranged.push({ ...r, midi: shifted, octaveShifted: shifted - r.midi })
        warnings.push({ kind: 'octave-transposed', detail: `midi ${r.midi}→${shifted}`, measureIndex })
      } else {
        warnings.push({ kind: 'unplayable-note-dropped', detail: `midi ${r.midi}`, measureIndex })
        droppedNotes.push({ midi: r.midi, reason: 'out-of-range', startBeat: onset })
      }
    }
    if (!ranged.length) continue
    // ONE playable voicing per onset, with HARD span/finger/string limits.
    // If the full chord is physically impossible, notes are dropped by
    // priority (melody, then bass, then harmony) and the loss is reported.
    const voicing = choosePlayableVoicing(ranged, {
      tuning: tuningValues,
      handFret,
      maxSpan,
      maxFingers: 4,
      fretCount: strings.fretCount,
      maxFret: strings.fretCount,
      preferredMaxFret: strings.preferredMaxFret ?? 12,
    })
    for (const drop of voicing.dropped) {
      if (!ranged.some((r) => r.midi === drop.midi)) continue
      warnings.push({
        kind: drop.reason === 'out-of-range' ? 'unplayable-note-dropped' : 'chord-voice-dropped',
        detail: `midi ${drop.midi}`,
        measureIndex,
      })
      droppedNotes.push({ midi: drop.midi, reason: drop.reason, startBeat: onset })
    }
    for (const pos of voicing.positions) {
      const n = pos.note
      if (!n) continue
      events.push({
        midi: n.midi,
        startBeat: onset,
        durBeats: Math.max(params.minNoteBeats, n.quantizedDurBeats ?? 0.5),
        string: pos.string,
        fret: pos.fret,
        role: n.isMelody ? 'melody' : n.isBassRoot ? 'bass' : 'harmony',
        isMelody: Boolean(n.isMelody),
        isBassRoot: Boolean(n.isBassRoot),
        texture,
        measureIndex,
        simplified: voicing.simplified,
        ...(n.octaveShifted ? { octaveShifted: n.octaveShifted } : {}),
        provenance: PROVENANCE.ARRANGED,
      })
    }
    const fretted = voicing.positions.map((p) => p.fret).filter((f) => f > 0)
    const anchor = fretted.length ? Math.min(...fretted) : null
    if (anchor != null) {
      if (handFret != null && Math.abs(anchor - handFret) > 5) {
        warnings.push({ kind: 'position-shift', detail: `${handFret}→${anchor}`, measureIndex })
      }
      handFret = anchor
    }
  }
  // Independent playability gate: the arrangement must pass before it is
  // allowed to become TAB or be labelled ready to practice.
  const playability = validateGuitarArrangement(events, {
    maxSpan,
    maxFingers: 4,
    maxFret: strings.fretCount,
    maxHandJump: maxSpan + 1,
  })
  if (!playability.playable) {
    warnings.push({ kind: 'arrangement-unplayable', detail: `${playability.violations.length} violation(s)` })
  }
  void capo
  void chords
  return { events, warnings, strings, droppedNotes, playability }
}
