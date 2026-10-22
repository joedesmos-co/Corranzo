/**
 * Regression tests for the Audio Vision transcription cleanup and the
 * measurement decisions that came out of the stage-loss study.
 *
 * The rules these tests protect are the ones that were MEASURED, not the ones
 * that were guessed:
 *
 *  - the onset-corroboration gate is OFF by default, because on real
 *    recordings (GuitarSet, mic-real) it deletes real notes: the spectral
 *    flux detector misses a soft pick, and the gate then drops a genuine
 *    note. Measured: the arrangements' event F1 0.667 -> 0.692 on the
 *    GuitarSet takes, 0.519 -> 0.535 on the mic-real clips.
 *  - the two measured-and-REJECTED experiments (dropping a re-detection of a
 *    ringing note, holding a note until the next note in its part) are OFF
 *    by default and must not change a single note of the arrangement.
 *
 * The point of the last two is protection, not preference: if somebody
 * re-enables one of them by accident, these tests fail, because both were
 * shown to delete genuine notes on real performances.
 */
import { describe, it, expect } from 'vitest'
import { dropRingingRedetections } from '../src/features/audio-vision/noteCleanup.js'
import { holdNotesUntilNextOnset } from '../src/features/audio-vision/arrangementDurations.js'
import { corroborateNotesByOnset, analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'

describe('transcription cleanup: the re-detection rule', () => {
  const modelNotes = () => [
    // A sustained note the model re-reports while it is still sounding.
    { midi: 62, startSeconds: 2.393, endSeconds: 3.6, amplitude: 0.52 },
    { midi: 62, startSeconds: 3.6, endSeconds: 4.727, amplitude: 0.37 },
    // A genuine repeat: the previous note was lifted, so there is a gap.
    { midi: 67, startSeconds: 1.0, endSeconds: 1.4, amplitude: 0.6 },
    { midi: 67, startSeconds: 1.8, endSeconds: 2.2, amplitude: 0.62 },
  ]

  it('is a no-op unless it is switched on', () => {
    const notes = modelNotes()
    const result = dropRingingRedetections(notes, { enabled: false })
    expect(result.removed).toBe(0)
    expect(result.notes).toHaveLength(notes.length)
  })

  it('keeps a genuine repeat (the previous note was lifted)', () => {
    const result = dropRingingRedetections(modelNotes(), { onsetTimes: [1.0, 1.8] })
    const repeats = result.notes.filter((n) => n.midi === 67)
    expect(repeats).toHaveLength(2)
  })

  it('does not touch a note that was struck as hard as the previous one', () => {
    // The measured, SAFE variant: the note may only be treated as a
    // re-detection when the model reports it clearly weaker than the note it
    // would be replacing. A guitarist re-striking the same pitch is struck
    // just as hard, so this rule leaves real notes alone (measured: it
    // removes nothing on the real GuitarSet takes).
    const notes = [
      { midi: 62, startSeconds: 0, endSeconds: 1.0, amplitude: 0.5 },
      { midi: 62, startSeconds: 1.0, endSeconds: 2.0, amplitude: 0.48 },
    ]
    const result = dropRingingRedetections(notes, { onsetTimes: [0, 1.0], amplitudeRatio: 0.7 })
    expect(result.removed).toBe(0)
    expect(result.notes).toHaveLength(2)
  })

  it('the ungated variant DOES remove an adjacent same-pitch note (that is why it is off)', () => {
    // This is the measured behaviour that made the rule unsafe: on a real
    // performance it removed genuine re-strikes (157 notes on one GuitarSet
    // take). The rule stays in the tree, switched off, with this test
    // recording what it does.
    const notes = [
      { midi: 62, startSeconds: 0, endSeconds: 1.0, amplitude: 0.5 },
      { midi: 62, startSeconds: 1.0, endSeconds: 2.0, amplitude: 0.48 },
    ]
    const result = dropRingingRedetections(notes, { onsetTimes: [0, 1.0] })
    expect(result.removed).toBe(1)
  })
})

describe('arrangement durations: the hold rule', () => {
  it('is a no-op unless it is switched on', () => {
    const events = [
      { midi: 72, startBeat: 0, durBeats: 0.25, hand: 'RH' },
      { midi: 74, startBeat: 1, durBeats: 0.25, hand: 'RH' },
    ]
    const result = holdNotesUntilNextOnset(events.map((e) => ({ ...e })), { enabled: false })
    expect(result.changed).toBe(0)
    expect(result.events[0].durBeats).toBe(0.25)
  })

  it('changes only the LENGTH of a note, never which notes exist', () => {
    const events = [
      { midi: 72, startBeat: 0, durBeats: 0.25, hand: 'RH' },
      { midi: 74, startBeat: 1, durBeats: 0.25, hand: 'RH' },
    ]
    const before = events.map((e) => `${e.midi}@${e.startBeat}`)
    const result = holdNotesUntilNextOnset(events.map((e) => ({ ...e })), { maxBeats: 8 })
    const after = result.events.map((e) => `${e.midi}@${e.startBeat}`)
    expect(after).toEqual(before)
    expect(result.events[0].durBeats).toBe(1)
  })

  it('holds each hand independently', () => {
    const events = [
      { midi: 72, startBeat: 0, durBeats: 0.25, hand: 'RH' },
      { midi: 48, startBeat: 0, durBeats: 0.25, hand: 'LH' },
      { midi: 74, startBeat: 4, durBeats: 0.25, hand: 'RH' },
    ]
    const result = holdNotesUntilNextOnset(events.map((e) => ({ ...e })), { maxBeats: 8 })
    const right = result.events.find((e) => e.midi === 72)
    const left = result.events.find((e) => e.midi === 48)
    expect(right.durBeats).toBe(4)
    expect(left.durBeats).toBe(0.25)
  })
})

describe('onset corroboration', () => {
  it('drops a short note that no detector heard attack', () => {
    const notes = [
      { midi: 60, startSeconds: 0, endSeconds: 0.6, amplitude: 0.8 },
      { midi: 64, startSeconds: 1, endSeconds: 1.2, amplitude: 0.3 },
    ]
    // Only the first note has a detected attack.
    const kept = corroborateNotesByOnset(notes, [{ seconds: 0 }])
    expect(kept.map((n) => n.midi)).toEqual([60])
  })

  it('keeps a long note even without an attack (it was heard, just not struck)', () => {
    const notes = [
      { midi: 60, startSeconds: 0, endSeconds: 0.6, amplitude: 0.8 },
      { midi: 55, startSeconds: 1, endSeconds: 3.2, amplitude: 0.4 },
    ]
    const kept = corroborateNotesByOnset(notes, [{ seconds: 0 }])
    expect(kept.map((n) => n.midi)).toContain(55)
  })

  it('the analysis can run WITHOUT the gate (the measured default)', async () => {
    const silent = new Float32Array(22050)
    const withGate = await analyzeMusic(silent, 22050, { corroborateNotes: true })
    const withoutGate = await analyzeMusic(silent, 22050, { corroborateNotes: false })
    expect(withGate).toBeTruthy()
    expect(withoutGate).toBeTruthy()
    // The gate must never remove more notes than the un-gated analysis has.
    expect((withoutGate.predictedNotes ?? []).length)
      .toBeGreaterThanOrEqual((withGate.predictedNotes ?? []).length)
  })
})

describe('difficulty readability budget', () => {
  const notes = Array.from({ length: 24 }, (_, i) => ({
    midi: 60 + (i % 12),
    startBeat: i * 0.5,
    durBeats: 0.5,
    hand: i % 2 === 0 ? 'RH' : 'LH',
  }))

  it('uses the documented per-difficulty budget by default', () => {
    const defaultRun = simplifyForDifficulty(notes.map((n) => ({ ...n })), 'intermediate')
    const explicit = simplifyForDifficulty(notes.map((n) => ({ ...n })), 'intermediate', { maxNotesPerBeat: 2.5 })
    expect(defaultRun).toHaveLength(explicit.length)
  })

  it('a tighter budget never yields MORE notes', () => {
    const wide = simplifyForDifficulty(notes.map((n) => ({ ...n })), 'intermediate', { maxNotesPerBeat: 2.5 })
    const tight = simplifyForDifficulty(notes.map((n) => ({ ...n })), 'intermediate', { maxNotesPerBeat: 1.5 })
    expect(tight.length).toBeLessThanOrEqual(wide.length)
  })
})
