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
 * Harmonic-ghost veto (pure + tested): a candidate exactly one octave
 * above a SIMULTANEOUS, LONGER-OR-EQUAL, UNEXPECTED lower note is the
 * lower note's harmonic, not an independent attack (measured: C3@0.13+0.86
 * spawns C4@0.13+0.56; G3 spawns G4@+10 ms). Vetoing it blocks the top
 * remaining false-award pattern (score expects the upper octave while
 * the user plays the lower).
 *
 * Scope (measured, not assumed): applies to SINGLE-PITCH checkpoints
 * only. In dense chord music, fellow piece notes constantly form
 * simultaneous unexpected lower octaves under true anchors (measured:
 * 5 true anchors vetoed across 18 dense clips) — vetoing there stalls
 * real users to chase a rare ghost. Single-note checkpoints have no
 * dense context: a simultaneous unexpected lower octave is either the
 * ghost's fundamental or a genuinely co-attacked wrong note, and in
 * both cases withholding the award is correct (strict assessment).
 * Pedal-ring from earlier notes cannot trigger it (onset gate).
 *
 * Fires ONLY when all hold, so real music is untouched:
 * - single expected pitch,
 * - the lower octave is NOT itself expected (true doublings, where both
 *   octaves are in the score, always confirm),
 * - onsets coincide within 60 ms (pedal ring from earlier notes passes
 *   through untouched),
 * - the lower note rings LONGER-OR-EQUAL (a truly-played upper octave
 *   outlives sympathetic resonance; the model quantizes simultaneous
 *   chord tones to identical spans, so strict inequality would miss
 *   exact-simultaneous ghosts).
 *
 * @returns midi values to exclude from confirmation with reasons.
 *
 * MEASURED NEGATIVES (overnight forensics, do not retry without new
 * evidence — scripts/analyze-pitch-trajectories.mjs,
 * scripts/calibrate-attack-flux.mjs, scripts/probe-octave-pairs.mjs):
 * - Static spectral-energy veto: ghost upper/lower ratios (+12.8/-11.0 dB)
 *   sit inside true co-onset doublings (-27.7..+15.8 dB). No threshold.
 * - Stream span-ratio veto (ghost span vs parent span): ghosts 1.0-2.2,
 *   true/unexpected pairs 0.29-3.0 (stream fragments spans). No threshold.
 * - Union-persistence veto (whole-clip spectral presence): transient
 *   ghosts 4.2-6.2 BUT true short-uppers over ringing lowers reach
 *   5.4-8.5 (eg02 E3/E2 5.82, rock-dyad 81/69 6.51, funk 63/51 6.84).
 * - Attack-flux admission (transient-less + short + unattached = blip):
 *   TRUE strum-interior/chord-top notes are transient-less + short too
 *   (power-dyad 61 flux 0.118 span 0.12; cmaj7 71 flux 0.044 span 0.12).
 *   Killing blips kills masked-but-real attacks. REJECTED.
 * Residual octave ghosts (split-c3 60, adjacent-g3 67, low-high-e2 63)
 * are genuine acoustic ambiguity: per-frame trajectories (transient,
 * rise, decay correlation, sustain) of the steady ghost match true
 * co-onset notes exactly. The single-pitch veto above stays the
 * defense; multi-pitch octave ghosts need per-note attack-transient
 * evidence (future: flux plumbed from capture audio, NOT thresholds).
 */
export function harmonicGhostVetoes(poolNotes = [], expectedMidis = []) {
  const expected = new Set((expectedMidis ?? []).map(Number).filter(Number.isFinite))
  // Single-pitch checkpoints only (see docstring: dense chord music
  // must flow; fellow piece notes would veto true anchors).
  if (expected.size !== 1) {
    return new Map()
  }
  const vetoed = new Map()
  for (const candidate of poolNotes ?? []) {
    const midi = Math.round(candidate?.midi)
    // NOTE: no expected-membership skip on the candidate itself — the
    // veto exists precisely for ghosts the score expects (false-award
    // scenarios). Real doublings are protected by the unexpected-lower
    // requirement below, not by candidate membership.
    if (!Number.isFinite(midi) || vetoed.has(midi)) {
      continue
    }
    const candidateStart = candidate?.start
    const candidateEnd = candidate?.end
    if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd)) {
      continue
    }
    for (const other of poolNotes ?? []) {
      const lower = Math.round(other?.midi)
      if (!Number.isFinite(lower) || lower !== midi - 12 || expected.has(lower)) {
        continue
      }
      if (!Number.isFinite(other?.start) || !Number.isFinite(other?.end)) {
        continue
      }
      const onsetGap = Math.abs(other.start - candidateStart)
      // Longer-or-equal: the model quantizes chord tones to the same span,
      // so strict inequality misses exact simultaneous ghosts. A truly
      // played upper octave outlives sympathetic resonance; equal spans
      // with a simultaneous unexpected fundamental read as harmonic.
      const lowerLonger = (other.end - other.start) >= (candidateEnd - candidateStart)
      if (onsetGap <= 0.06 && lowerLonger) {
        vetoed.set(midi, {
          reason: 'harmonic-ghost',
          fundamental: lower,
          onsetGapMs: Math.round(onsetGap * 1000),
        })
        break
      }
    }
  }
  return vetoed
}

/**
 * Confirm expected tones against independent neural note candidates.
 *
 * @param {Array<{midi:number,start:number,end:number,sustained?:boolean}>} neuralNotes
 * @param {number[]} expectedMidis
 * @param {number|null} anchorOnset attack reference (null = whole take)
 * @returns confirmation verdict + per-tone neural onset evidence
 *
 * Sustained entries ({ sustained: true }) bypass the attack window:
 * they prove persistence, not attack timing — a chord tone the model
 * still hears re-confirms even when its attack fell outside the window
 * (skipped hops, partial windows, loop seams). Fresh attacks still need
 * window alignment. Both carry independent acoustic evidence; neither
 * manufactures.
 *
 * Harmonic ghosts (see harmonicGhostVetoes) are excluded before
 * confirmation and reported as vetoed, never silently dropped.
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
    if (!note.sustained && (note.start < lo || note.start > hi)) {
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
  const vetoes = harmonicGhostVetoes(
    pool.map((entry) => ({ midi: entry.midi, start: entry.neuralStart, end: entry.neuralEnd })),
    expectedMidis,
  )
  const eligible = vetoes.size
    ? pool.filter((entry) => !vetoes.has(Math.round(entry.midi)))
    : pool
  const verdict = confirmBlindCandidates(eligible, expectedMidis, {
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
  return { ...verdict, neuralOnsets: onsets, candidateCount: pool.length, vetoed: [...vetoes.entries()].map(([midi, veto]) => ({ midi, ...veto })) }
}
