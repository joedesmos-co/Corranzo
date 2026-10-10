/**
 * A5 — Solo guitar arrangement: ONE playable guitar part, standard tuning,
 * realistic string/fret via existing fretboard.js. Standard notation + TAB
 * (<technical> string/fret) downstream.
 */
import { PROVENANCE } from './musicAnalysis.js'
import { resolveSimultaneous, selectTexture } from './arrangementModel.js'
import { paramsForDifficulty } from './difficulty.js'
import { STANDARD_GUITAR_TUNING } from '../instruments/instruments.js'
import { assignChordPositions, candidatePositionsForMidi, stringFretForMidi } from '../instruments/fretboard.js'

export const GUITAR_STRINGS = {
  count: 6,
  tuning: STANDARD_GUITAR_TUNING, // E2 A2 D3 G3 B3 E4 sounding
  fretCount: 19,
  preferredMaxFret: 12,
}
export const GUITAR_MIN = 40 // E2
export const GUITAR_MAX = 88 // E6

function clampGuitar(midi) {
  return Math.max(GUITAR_MIN, Math.min(GUITAR_MAX, midi))
}

/**
 * Arrange into single guitar events with string/fret.
 * { midi, startBeat, durBeats, string, fret, role, positionShift }
 */
export function arrangeSoloGuitar({ quantizedNotes, chords, difficulty, beatsPerMeasure = 4, capo = 0, tuning = null }) {
  const params = paramsForDifficulty(difficulty)
  const strings = tuning ? { ...GUITAR_STRINGS, tuning } : GUITAR_STRINGS
  const byOnset = new Map()
  for (const n of quantizedNotes) {
    const key = Math.round((n.quantizedStartBeat ?? 0) * 4) / 4
    if (!byOnset.has(key)) byOnset.set(key, [])
    byOnset.get(key).push({ ...n, midi: clampGuitar(Math.round(n.midi)) - 0 })
  }
  const events = []
  const warnings = []
  let handFret = null
  const sortedOnsets = [...byOnset.keys()].sort((a, b) => a - b)
  for (const onset of sortedOnsets) {
    const group = byOnset.get(onset)
    const measureIndex = Math.floor(Math.max(0, onset) / beatsPerMeasure)
    const sorted = [...group].sort((a, b) => b.midi - a.midi)
    const melodyMidi = sorted[0]?.midi ?? null
    const tagged = sorted.map((n, i) => ({
      ...n,
      isMelody: i === 0,
      isBassRoot: i === sorted.length - 1 && sorted.length > 1,
      isChordTone: true,
      isPassingTone: false,
      strength: n.strength ?? 0.5,
      melodyMidi,
      measureIndex,
    }))
    // Guitar: max 4 simultaneous in advanced, fewer below; melody always kept.
    const resolved = resolveSimultaneous(tagged, { maxVoices: Math.min(4, params.maxVoicesPerOnset + 1), melodyMidi })
      .filter((e) => e.kept)
    const texture = selectTexture({ noteDensity: group.length, chordConfidence: 0.5, difficulty })
    if (resolved.length === 1) {
      const n = resolved[0]
      const pos = stringFretForMidi(strings, n.midi, { handFret })
      if (!pos) {
        warnings.push({ kind: 'unplayable-note-dropped', detail: `midi ${n.midi}`, measureIndex })
        continue
      }
      if (pos.fret > 0) {
        if (handFret != null && Math.abs(pos.fret - handFret) > 5) {
          warnings.push({ kind: 'position-shift', detail: `${handFret}→${pos.fret}`, measureIndex })
        }
        handFret = pos.fret
      }
      events.push({
        midi: n.midi,
        startBeat: onset,
        durBeats: Math.max(params.minNoteBeats, n.quantizedDurBeats ?? 0.5),
        string: pos.string,
        fret: pos.fret + capo * 0,
        role: n.isMelody ? 'melody' : 'harmony',
        texture,
        measureIndex,
        provenance: PROVENANCE.ARRANGED,
      })
    } else {
      const midis = resolved.map((r) => r.midi)
      const assignment = assignChordPositions(strings, midis, { handFret })
      const frets = []
      for (const r of resolved) {
        const pos = assignment.get(r.midi)
        if (!pos) {
          // Keep melody at all costs; drop unassignable inner voice.
          if (r.isMelody) {
            const fallback = stringFretForMidi(strings, r.midi, { handFret })
            if (!fallback) {
              warnings.push({ kind: 'unplayable-note-dropped', detail: `midi ${r.midi}`, measureIndex })
              continue
            }
            frets.push(fallback.fret)
            events.push({
              midi: r.midi, startBeat: onset,
              durBeats: Math.max(params.minNoteBeats, r.quantizedDurBeats ?? 0.5),
              string: fallback.string, fret: fallback.fret,
              role: 'melody', texture, measureIndex, provenance: PROVENANCE.ARRANGED,
            })
          } else {
            warnings.push({ kind: 'chord-voice-dropped', detail: `midi ${r.midi}`, measureIndex })
          }
          continue
        }
        frets.push(pos.fret)
        events.push({
          midi: r.midi, startBeat: onset,
          durBeats: Math.max(params.minNoteBeats, r.quantizedDurBeats ?? 0.5),
          string: pos.string, fret: pos.fret,
          role: r.isMelody ? 'melody' : r.isBassRoot ? 'bass' : 'harmony',
          texture, measureIndex, provenance: PROVENANCE.ARRANGED,
        })
      }
      const fretted = frets.filter((f) => f > 0)
      if (fretted.length >= 2) {
        const span = Math.max(...fretted) - Math.min(...fretted)
        if (span > params.maxFretSpan) {
          warnings.push({ kind: 'wide-stretch', detail: `span ${span}`, measureIndex })
        }
        handFret = Math.min(...fretted)
      }
    }
    void capo
    void chords
  }
  // Reachability audit: every event must have a candidate position.
  const playable = events.filter((e) => candidatePositionsForMidi(strings, e.midi).length > 0)
  if (playable.length !== events.length) {
    warnings.push({ kind: 'range-audit', detail: `${events.length - playable.length} out-of-range dropped` })
  }
  return { events: playable, warnings, strings }
}
