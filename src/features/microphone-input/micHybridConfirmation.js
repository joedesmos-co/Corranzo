/**
 * Hybrid confirmation (Stage 2, S4) — EXPERIMENTAL, offline only.
 *
 * Pipeline position:
 *
 *   blind detector → independent pitch candidates
 *       → score-informed V2/V3 confirmation → canonical mic event
 *
 * Critical invariant: the expected score may CONFIRM a note that has
 * independent blind acoustic evidence, but it can NEVER manufacture one.
 * Confirmation reads ONLY the blind candidate list; expected midis with no
 * blind candidate inside tolerance stay missing, and blind candidates that
 * match nothing expected are reported as unexpected (never silently
 * dropped, never awarded).
 *
 * Canonical wrong-chord case:
 *   expected C4 E4 G4, actually played D4 F4 A4 → confirmed [], complete
 *   false. Corranzo must NOT award C major.
 *
 * Pure + testable: no audio APIs.
 */

export const HYBRID_DEFAULTS = {
  /** Blind candidate must sit this close to the expected pitch. */
  centsTolerance: 50,
  /** Blind candidate must carry at least this confidence. */
  minConfidence: 0.3,
}

function centsDistance(midiFloat, expectedMidi) {
  if (!Number.isFinite(midiFloat) || !Number.isFinite(expectedMidi)) {
    return Infinity
  }
  return Math.abs(midiFloat - expectedMidi) * 100
}

/**
 * @param {Array<{midi:number,midiFloat?:number,confidence?:number,detected?:boolean}>} blindCandidates
 *   independent detections (only `detected !== false` entries count)
 * @param {number[]} expectedMidis the score's expected chord tones
 * @returns {{ confirmedMidis, missingMidis, unexpectedMidis, complete,
 *   partial, evidence }} — evidence maps each confirmed midi to the blind
 *   candidate that proved it (the anti-manufacture audit trail).
 */
export function confirmBlindCandidates(blindCandidates = [], expectedMidis = [], options = {}) {
  const config = { ...HYBRID_DEFAULTS, ...options }
  const heard = (blindCandidates ?? []).filter(
    (candidate) =>
      candidate?.detected !== false &&
      Number.isFinite(candidate?.midi) &&
      (candidate.confidence ?? 1) >= config.minConfidence,
  )
  const expected = [...new Set((expectedMidis ?? []).map(Number).filter(Number.isFinite))]
    .sort((left, right) => left - right)

  const confirmedMidis = []
  const missingMidis = []
  const evidence = {}
  const usedHeard = new Set()

  for (const midi of expected) {
    let best = null
    let bestCents = Infinity
    for (const candidate of heard) {
      if (usedHeard.has(candidate)) {
        continue
      }
      const cents = centsDistance(candidate.midiFloat ?? candidate.midi, midi)
      if (cents <= config.centsTolerance && cents < bestCents) {
        best = candidate
        bestCents = cents
      }
    }
    if (best) {
      usedHeard.add(best)
      confirmedMidis.push(midi)
      evidence[midi] = {
        midiFloat: best.midiFloat ?? best.midi,
        confidence: best.confidence ?? null,
        centsOff: Math.round(bestCents * 10) / 10,
      }
    } else {
      missingMidis.push(midi)
    }
  }

  const unexpectedMidis = heard
    .filter((candidate) => !usedHeard.has(candidate))
    .map((candidate) => Math.round(candidate.midi))
    .sort((left, right) => left - right)

  const complete = expected.length > 0 && missingMidis.length === 0
  return {
    confirmedMidis,
    missingMidis,
    unexpectedMidis,
    complete,
    partial: confirmedMidis.length > 0 && missingMidis.length > 0,
    evidence,
  }
}
