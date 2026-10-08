/**
 * Neural hybrid prototype (Stage 5, N4) — EXPERIMENTAL, offline only.
 *
 * Pipeline:
 *
 *   AUDIO → pretrained neural model → INDEPENDENT note candidates
 *     → acoustic confirmation (expected∩heard, never manufactured)
 *     → chord grouping → canonical input events → bounded evaluator
 *
 * The neural model (Basic Pitch) emits note events WITHOUT confidence
 * scores, so candidacy itself is the evidence: a tone confirms only when
 * the model independently placed it near the attack window. Score notes
 * may select WHICH candidates confirm, but a tone with no neural note
 * behind it can never confirm — the same anti-manufacture contract as
 * the spectral hybrid, with far stronger detection underneath.
 *
 * Preserved per event: individual pitches, neural onset/offset,
 * chord grouping, attempt identity. Confidence is marked
 * 'neural-note-presence' (documented assumption, not a model posterior).
 *
 * Pure + testable. NOT wired into any live path.
 */
import { confirmBlindCandidates } from '../microphone-input/micHybridConfirmation.js'

export const NEURAL_HYBRID_DEFAULTS = {
  /** Candidates must start inside the attack window to confirm it. */
  windowBeforeSeconds: 0.3,
  windowAfterSeconds: 1.0,
  /** Neural note within this many semitones of expected confirms. */
  centsTolerance: 50,
  /** Documented assumed confidence (Basic Pitch emits no posterior). */
  assumedConfidence: 0.85,
}

function centsDistance(midiFloat, expectedMidi) {
  if (!Number.isFinite(midiFloat) || !Number.isFinite(expectedMidi)) {
    return Infinity
  }
  return Math.abs(midiFloat - expectedMidi) * 100
}

/**
 * Confirm expected tones against independent neural note candidates.
 *
 * @param {Array<{midi:number,start:number,end:number}>} neuralNotes
 * @param {number[]} expectedMidis
 * @param {number|null} anchorOnset attack reference (null = whole take)
 * @returns confirmation verdict + per-tone neural onset evidence
 */
export function confirmNeuralNotes(neuralNotes = [], expectedMidis = [], anchorOnset = null, options = {}) {
  const config = { ...NEURAL_HYBRID_DEFAULTS, ...options }
  const lo = anchorOnset != null ? anchorOnset - config.windowBeforeSeconds : -Infinity
  const hi = anchorOnset != null ? anchorOnset + config.windowAfterSeconds : Infinity
  const pool = []
  for (const note of neuralNotes ?? []) {
    if (!Number.isFinite(note?.midi) || note.start == null) {
      continue
    }
    if (note.start < lo || note.start > hi) {
      continue
    }
    pool.push({
      midi: Math.round(note.midi),
      midiFloat: note.midi,
      confidence: config.assumedConfidence,
      detected: true,
      neuralStart: note.start,
      neuralEnd: note.end ?? null,
    })
  }
  const verdict = confirmBlindCandidates(pool, expectedMidis, {
    centsTolerance: config.centsTolerance,
    minConfidence: 0,
  })
  // Attach neural onset evidence to each confirmation.
  const onsets = {}
  for (const midi of Object.keys(verdict.evidence)) {
    const candidate = pool.find(
      (entry) => Math.round(entry.midi) === Number(midi) &&
        centsDistance(entry.midiFloat, Number(midi)) <= config.centsTolerance,
    )
    onsets[midi] = candidate?.neuralStart ?? null
  }
  return { ...verdict, neuralOnsets: onsets, candidateCount: pool.length }
}
