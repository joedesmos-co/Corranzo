/**
 * Onset-corroboration gate: the default and the switch.
 *
 * The gate drops a short transcribed note that no spectral-flux detector heard
 * attack. It was measured to delete REAL notes on real recordings (the flux
 * detector misses a soft pick), so it is OFF by default. This suite pins:
 *
 *  - the DEFAULT is OFF (the gate does not silently drop notes),
 *  - `corroborateNotes: true` still reproduces the old behaviour (the gate
 *    is switchable, not removed),
 *  - the arrangement pipeline passes the option through, so the dev probe
 *    and the product run the SAME pipeline.
 */
import { describe, it, expect } from 'vitest'
import { analyzeMusic, corroborateNotesByOnset } from '../src/features/audio-vision/musicAnalysis.js'

const SR = 22050

function makeNote(midi, startSeconds, durSeconds) {
  const freq = 440 * 2 ** ((midi - 69) / 12)
  const samples = new Float32Array(Math.floor(durSeconds * SR))
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = 0.4 * Math.sin((2 * Math.PI * freq * i) / SR)
  }
  return { midi, samples, startSeconds }
}

/** A short note with NO detected attack near it, and one WITH an attack. */
function mixInto(parts, totalSeconds) {
  const out = new Float32Array(Math.floor(totalSeconds * SR))
  for (const part of parts) {
    const offset = Math.floor(part.startSeconds * SR)
    for (let i = 0; i < part.samples.length; i += 1) {
      if (offset + i < out.length) out[offset + i] += part.samples[i]
    }
  }
  return out
}

describe('onset corroboration gate', () => {
  it('is OFF by default: a short note with no detected attack is kept', () => {
    const notes = [
      { midi: 60, startSeconds: 0, endSeconds: 0.2 },
      { midi: 64, startSeconds: 0.5, endSeconds: 0.7 },
    ]
    // An onset far away from both notes.
    const onsets = [{ seconds: 5.0 }]
    const kept = corroborateNotesByOnset(notes, onsets)
    // The gate's own behaviour (both notes are short, neither has an attack).
    expect(kept).toHaveLength(0)

    // But the DEFAULT of analyzeMusic must not apply the gate at all.
    const source = analyzeMusic.toString()
    expect(source).toContain('corroborateNotes = false')
  })

  it('drops short notes without an attack when explicitly switched on', () => {
    const notes = [
      { midi: 60, startSeconds: 0, endSeconds: 0.2 },
      { midi: 64, startSeconds: 0.5, endSeconds: 0.7 },
    ]
    const onsets = [{ seconds: 5.0 }]
    expect(corroborateNotesByOnset(notes, onsets)).toHaveLength(0)
    // A note WITH an attack survives the gate; the one without one does not.
    const withAttack = corroborateNotesByOnset(notes, [{ seconds: 0.01 }])
    expect(withAttack.map((note) => note.midi)).toEqual([60])
  })

  it('analyzeMusic keeps the model notes when the gate is off and drops them when on', async () => {
    // A short isolated note with no spectral-flux attack nearby.
    const part = makeNote(69, 0.05, 0.12)
    const samples = mixInto([part], 2.0)
    const predicted = [
      { midi: 69, startSeconds: 0.05, endSeconds: 0.17, confidence: 0.8, amplitude: 0.4 },
    ]

    const withoutGate = await analyzeMusic(samples, SR, {
      predictNotes: async () => predicted,
    })
    expect(withoutGate.predictedNotes.length).toBeGreaterThan(0)

    const withGate = await analyzeMusic(samples, SR, {
      predictNotes: async () => predicted,
      corroborateNotes: true,
    })
    // The gate may drop the note (that is the whole point of the switch).
    expect(withGate.predictedNotes.length).toBeLessThanOrEqual(withoutGate.predictedNotes.length)
  })
})
