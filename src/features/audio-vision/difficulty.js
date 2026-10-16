/**
 * A7 — Difficulty simplification with measurable effect.
 * EASY < INTERMEDIATE < ADVANCED must differ in notes/beat, polyphony, span.
 */
import { DIFFICULTIES } from './arrangementModel.js'

export const DIFFICULTY_PARAMS = {
  [DIFFICULTIES.EASY]: {
    maxVoicesPerOnset: 2,
    maxNotesPerBeat: 1.5,
    minNoteBeats: 0.5,
    melodyOnlyMeasuresAllowed: true,
    maxFretSpan: 3,
    maxHandSpanSemitones: 12,
    dropPassingTones: true,
    dropExtensions: true,
  },
  [DIFFICULTIES.INTERMEDIATE]: {
    maxVoicesPerOnset: 3,
    maxNotesPerBeat: 2.5,
    minNoteBeats: 0.25,
    melodyOnlyMeasuresAllowed: false,
    maxFretSpan: 4,
    maxHandSpanSemitones: 14,
    dropPassingTones: false,
    dropExtensions: true,
  },
  [DIFFICULTIES.ADVANCED]: {
    maxVoicesPerOnset: 4,
    maxNotesPerBeat: 4,
    minNoteBeats: 0.25,
    melodyOnlyMeasuresAllowed: false,
    maxFretSpan: 5,
    maxHandSpanSemitones: 16,
    dropPassingTones: false,
    dropExtensions: false,
  },
}

export function paramsForDifficulty(difficulty) {
  const params = DIFFICULTY_PARAMS[difficulty]
  if (!params) throw new TypeError(`Unknown difficulty: ${difficulty}`)
  return params
}

/** Simplify quantized events per difficulty: thin ornaments, enforce min durations. */
export function simplifyForDifficulty(events, difficulty) {
  const params = paramsForDifficulty(difficulty)
  const out = []
  for (const e of events) {
    if (params.dropPassingTones && e.isPassingTone && !e.isMelody) continue
    if (params.dropExtensions && e.isExtension && !e.isMelody) continue
    const durBeats = Math.max(params.maxVoicesPerOnset ? params.minNoteBeats : 0.25, e.quantizedDurBeats ?? e.durBeats ?? 0.5)
    out.push({ ...e, quantizedDurBeats: Math.round(durBeats * 100) / 100, durBeats: Math.round(durBeats * 100) / 100 })
  }
  // Density cap per beat window. Melody is the musical identity of an
  // arrangement: the cap may thin harmony/bass, never the melody (except
  // exact same-pitch duplicates on the same beat). Dropping melody to meet a
  // budget is what makes Easy feel like a damaged copy instead of a simple one.
  // The bass ROOT is protected alongside the melody: Easy is then
  // melody + root (2 voices), the classic simple texture — not a bare melody.
  const budgetBase = params.maxVoicesPerOnset
  const byBeat = new Map()
  for (const e of out) {
    const key = Math.round((e.quantizedStartBeat ?? 0) * 2) / 2
    if (!byBeat.has(key)) byBeat.set(key, [])
    byBeat.get(key).push(e)
  }
  const thinned = []
  for (const [, group] of byBeat) {
    const seenEssential = new Set()
    const essential = group.filter((e) => (e.isMelody || e.isBassRoot) && (() => {
      const k = `${e.midi}:${Math.round((e.quantizedStartBeat ?? 0) * 4)}`
      if (seenEssential.has(k)) return false
      seenEssential.add(k)
      return true
    })())
    const others = group.filter((e) => !e.isMelody && !e.isBassRoot)
    // Harmony priority when over budget: bass-root-ish first, then strength.
    const sortedOthers = others.sort((a, b) => {
      const av = (a.isBassRoot ? 2 : 0) + Math.min(1.5, (a.strength ?? 0.5))
      const bv = (b.isBassRoot ? 2 : 0) + Math.min(1.5, (b.strength ?? 0.5))
      return bv - av
    })
    const othersBudget = Math.max(0, budgetBase - essential.length)
    thinned.push(...essential, ...sortedOthers.slice(0, othersBudget))
  }
  thinned.sort((a, b) => (a.quantizedStartBeat ?? 0) - (b.quantizedStartBeat ?? 0))
  return thinned
}
