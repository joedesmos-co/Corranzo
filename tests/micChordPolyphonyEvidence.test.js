/**
 * Chord collection evidence + per-tone hit counters (Step 5 launch sprint).
 */
import { describe, expect, it } from 'vitest'
import { chordCollectionEvidenceMidis } from '../src/features/microphone-input/micChordPolyphonyEvidence.js'
import {
  createMicChordCollectionState,
  evaluateMicChordCollection,
  MIC_CHORD_MATCH_COMPLETE,
  MIC_CHORD_MATCH_PROGRESS,
} from '../src/features/practice/waitForYouMicChordCollection.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'

const settings = normalizeMatchSettings({})
const EXPECTED = [60, 64, 67]

describe('chordCollectionEvidenceMidis', () => {
  it('returns the polyphonic v2 detections that are expected tones', () => {
    const frame = { v2DetectedMidis: [60, 64], midi: null }
    expect(chordCollectionEvidenceMidis(frame, EXPECTED)).toEqual([60, 64])
  })

  it('drops detections that are not expected tones (defence in depth)', () => {
    const frame = { v2DetectedMidis: [60, 61, 64], midi: null }
    expect(chordCollectionEvidenceMidis(frame, EXPECTED)).toEqual([60, 64])
  })

  it('keeps the monophonic pitch when it matches an expectation', () => {
    const frame = { v2DetectedMidis: [], midi: 67 }
    expect(chordCollectionEvidenceMidis(frame, EXPECTED)).toEqual([67])
  })

  it('de-duplicates and tolerates missing frames', () => {
    expect(chordCollectionEvidenceMidis({ v2DetectedMidis: [60, 60], midi: 60 }, EXPECTED)).toEqual([60])
    expect(chordCollectionEvidenceMidis(null, EXPECTED)).toEqual([])
    expect(chordCollectionEvidenceMidis({}, EXPECTED)).toEqual([])
  })
})

describe('chord collection with polyphonic evidence', () => {
  it('collects a chord whose tones arrive together in one frame', () => {
    // Regression: the collection used a single pending index, so several
    // expected tones in the same frame rotated the counter and NO tone
    // ever reached its stable-hit count.
    const state = createMicChordCollectionState()
    const expected = EXPECTED
    let outcome = null
    for (let frame = 0; frame < 4; frame += 1) {
      for (const midi of expected) {
        outcome = evaluateMicChordCollection({
          expected,
          playedMidi: midi,
          state,
          settings,
          micChordMode: 'any-tone',
        })
      }
    }
    expect(outcome?.outcome).toBe(MIC_CHORD_MATCH_COMPLETE)
  })

  it('still refuses a single tone of a three-note chord', () => {
    const state = createMicChordCollectionState()
    let outcome = null
    for (let hit = 0; hit < 6; hit += 1) {
      outcome = evaluateMicChordCollection({
        expected: EXPECTED,
        playedMidi: 60,
        state,
        settings,
        micChordMode: 'any-tone',
      })
    }
    expect(outcome?.outcome).toBe(MIC_CHORD_MATCH_PROGRESS)
    expect(outcome?.matchedCount).toBe(1)
  })

  it('drops per-tone progress when a wrong note interrupts', () => {
    const state = createMicChordCollectionState()
    evaluateMicChordCollection({ expected: EXPECTED, playedMidi: 60, state, settings, micChordMode: 'any-tone' })
    // A genuinely wrong tone (not an expectation) interrupts the attempt.
    evaluateMicChordCollection({ expected: EXPECTED, playedMidi: 55, state, settings, micChordMode: 'any-tone' })
    const after = evaluateMicChordCollection({ expected: EXPECTED, playedMidi: 60, state, settings, micChordMode: 'any-tone' })
    // The interrupted tone must start over (one hit), not complete.
    expect(after?.matchedCount).toBe(0)
  })
})
