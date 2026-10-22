/**
 * The independent synthesized reference.
 *
 * A piano piece whose notes, onsets, durations and hands are known EXACTLY.
 * It exists so the pipeline can be measured against a reference it never
 * sees: the audio is rendered from this list, the analysis hears only the
 * audio, and the arrangement is compared back with this list.
 *
 * It is deliberately not a "nice" fixture: it has a melody with a passing
 * note, a held note, block chords in the left hand, a bass line that moves,
 * and a section that repeats lower - the shapes a real arrangement has to
 * survive. Everything is in A minor / C major so the pitches are easy to read
 * and to check by ear.
 */

/** Right hand: [beat, midi, beats]. */
const MELODY = [
  [0, 72, 1], [1, 74, 1], [2, 76, 2], [4, 77, 1], [5, 76, 1],
  [6, 74, 2], [8, 72, 1], [9, 71, 1], [10, 69, 4],
  [14, 67, 1], [15, 69, 1], [16, 71, 1], [17, 72, 1], [18, 74, 4],
  [22, 76, 1], [23, 77, 1], [24, 79, 1], [25, 77, 1], [26, 76, 1],
  [27, 74, 1], [28, 72, 4],
]

/** Left hand: [beat, [midi...], beats]. */
const HARMONY = [
  [0, [48, 60, 64], 4], [4, [50, 62, 65], 4], [8, [43, 59, 67], 4],
  [12, [48, 60, 64], 2], [14, [47, 59, 62], 2], [16, [43, 59, 67], 2],
  [18, [50, 62, 65], 4], [22, [48, 60, 64], 4], [26, [45, 57, 64], 2],
  [28, [48, 60, 64], 4],
]

export const SYNTH_REFERENCE_BPM = 100

export function synthReferenceNotes() {
  const beat = 60 / SYNTH_REFERENCE_BPM
  const notes = []
  for (const [b, midi, beats] of MELODY) {
    notes.push({
      midi,
      onset: b * beat,
      offset: (b + beats) * beat,
      hand: 'RH',
      role: 'melody',
    })
  }
  for (const [b, midis, beats] of HARMONY) {
    for (const midi of midis) {
      notes.push({
        midi,
        onset: b * beat,
        offset: (b + beats) * beat,
        hand: 'LH',
        role: midi < 52 ? 'bass' : 'harmony',
      })
    }
  }
  notes.sort((a, b) => a.onset - b.onset || a.midi - b.midi)
  return notes
}

export const SYNTH_REFERENCE_SECONDS = 24

/**
 * Render the reference to mono audio at the model's rate. The timbre is a
 * decaying harmonic stack (a piano-ish tone), so the model hears real
 * attacks with real harmonics - the case where octave artifacts appear.
 */
export function renderReference(samples = 22050, { noise = 0.0015 } = {}) {
  const notes = synthReferenceNotes()
  const out = new Float32Array(Math.floor(SYNTH_REFERENCE_SECONDS * samples))
  for (const note of notes) {
    const freq = 440 * 2 ** ((note.midi - 69) / 12)
    const amp = note.hand === 'RH' ? 0.34 : 0.24
    const s0 = Math.floor(note.onset * samples)
    const s1 = Math.min(out.length, Math.floor(note.offset * samples))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / samples
      const env = Math.min(1, t * 120) * Math.exp(-1.6 * t)
      let v = 0
      for (let h = 1; h <= 5; h += 1) v += Math.sin(2 * Math.PI * freq * h * t) / (h * 1.6)
      out[i] += amp * env * v
    }
  }
  for (let i = 0; i < out.length; i += 1) out[i] += (Math.random() - 0.5) * noise
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < out.length; i += 1) out[i] = (out[i] / peak) * 0.85
  return out
}

/** The truth the arrangement is compared against (onsets/offsets in seconds). */
export function synthReferenceTruth() {
  return synthReferenceNotes().map((n) => ({
    midi: n.midi,
    onset: Math.round(n.onset * 1000) / 1000,
    offset: Math.round(n.offset * 1000) / 1000,
    hand: n.hand,
    role: n.role,
  }))
}
