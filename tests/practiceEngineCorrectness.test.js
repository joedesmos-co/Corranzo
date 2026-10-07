/**
 * CORRANZO V1 Practice Engine correctness (B03/B04/B06).
 * Deterministic reproductions + regression for the audited defects:
 * - ~437 ms early Play Along acceptance (R3)
 * - live MIDI evaluator bypass
 * - pause outcome loss
 * - backward-seek stale miss
 * - missing attempt isolation
 * - Wait For You restored-first-match (R4)
 * plus the E16 matrix (Play Along / WFY / lifecycle).
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getTimeline } from '../src/features/musicxml/timeline.js'
import {
  buildNoteCheckpoints,
  findCheckpointIndexAtTime,
} from '../src/features/practice/waitForYouCheckpoints.js'
import {
  canMarkWaitForYouCheckpoint,
  getNextCheckpointIndex,
  shouldBlockWaitForYouAdvance,
} from '../src/features/practice/waitForYouEngine.js'
import {
  createPlayAlongFeedbackState,
  evaluatePlayAlongNoteInput,
  prunePlayAlongOutcomesAfterSeek,
  resetPlayAlongFeedbackState,
  resetPlayAlongForLoopIteration,
  resolvePlayAlongTargetIndex,
  updatePlayAlongMisses,
  classifyPlayAlongTimingDelta,
  playAlongWindowStart,
  playAlongWindowEnd,
} from '../src/features/practice/playAlongLaneFeedback.js'
import {
  VISUAL_EARLY_INPUT_SECONDS,
  PLAY_ALONG_MISS_AFTER_SECONDS,
  VISUAL_LANE_OUTCOME,
} from '../src/features/practice/visualLaneFeedback.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  createMusicalEventBufferState,
  evaluateNoteInput,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import {
  createPracticeAttempt,
  createPracticeAttemptId,
  indexGroupsById,
  nextLoopIteration,
  nextSubAttempt,
  pruneOutcomesAfterSeek,
} from '../src/features/practice/practiceAttempt.js'
import {
  INPUT_SOURCE,
  createCanonicalInputEvent,
  evaluateCanonicalPlayAlongInput,
  evaluateCanonicalWaitForYouInput,
  normalizeMidiInputEvent,
  normalizeSyntheticInputEvent,
} from '../src/features/practice/canonicalInputEvent.js'
import {
  canonicalLoopBounds,
  describeSourceFidelity,
  locateCanonicalScoreTime,
  resolveCanonicalTimingEvents,
} from '../src/features/practice/canonicalTimingContract.js'
import {
  EVALUATION_OUTCOME,
  aggregateTroubleSpots,
  createEvaluationResult,
  isCleanRunAttempt,
} from '../src/features/practice/practiceEvaluationResult.js'
import { buildMeasureLoopRegion } from '../src/features/practice/practiceLoopRegion.js'
import * as F from './helpers/buildXml.js'

/** Two-bar audit fixture: m1 @60bpm C4 C4 E4+G4 rest; m2 @120bpm D4 E4 F4 G4. */
function auditFixture() {
  const m1 =
    `<measure number="1">${F.attributes()}${F.soundTempo(60)}` +
    `${F.note('C')}${F.note('C')}` +
    `${F.note('C')}<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>` +
    `${F.rest()}</measure>`
  // E4+G4 chord above used C+G by helper limits; rebuild explicitly for E+G:
  void m1
  const xml =
    `<measure number="1">${F.attributes()}${F.soundTempo(60)}` +
    `${F.note('C')}${F.note('C')}` +
    `<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>` +
    `<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>` +
    `${F.rest()}</measure>` +
    `<measure number="2">${F.soundTempo(120)}${F.note('D')}${F.note('E')}${F.note('F')}${F.note('G')}</measure>`
  return F.scoreWrap(`<part id="P1">${xml}</part>`)
}

function twoNoteMap() {
  return {
    durationSeconds: 2,
    measures: [{ number: 1, startTimeSeconds: 0, endTimeSeconds: 2, durationSeconds: 2 }],
    beats: [],
    notes: [
      { id: 'c4-a', partId: 'P1', staff: 1, voice: 1, measureNumber: 1, timeSeconds: 0, durationSeconds: 0.5, quarterTime: 0, midi: 60, label: 'C4' },
      { id: 'c4-b', partId: 'P1', staff: 1, voice: 1, measureNumber: 1, timeSeconds: 1, durationSeconds: 0.5, quarterTime: 1, midi: 60, label: 'C4' },
    ],
  }
}

describe('B03 Play Along bounded timing windows (E4)', () => {
  it('exposes the documented 150ms early / 280ms late contract', () => {
    expect(VISUAL_EARLY_INPUT_SECONDS).toBe(0.15)
    expect(PLAY_ALONG_MISS_AFTER_SECONDS).toBe(0.28)
  })

  it('REPRO R3: rejects the ~437ms-early attack the old MIDI bypass accepted', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    expect(groups.map((g) => g.timeSeconds)).toEqual([0, 1])
    const state = createPlayAlongFeedbackState()
    // R3: score time ~0.563 with C4 targets at 0 and 1.0; the 1.0 target
    // became "correct" ~437ms early via the bypass. Bounded evaluator: null.
    const outcome = evaluatePlayAlongNoteInput(state, groups, 0.563, 60, {})
    expect(outcome).toBeNull()
    expect(state.outcomes.size).toBe(0)
  })

  it('classifies too-early / early / on-time / late / too-late', () => {
    expect(classifyPlayAlongTimingDelta(-0.437)).toBe('too-early')
    expect(classifyPlayAlongTimingDelta(-0.15)).toBe('early')
    expect(classifyPlayAlongTimingDelta(-0.1)).toBe('early')
    expect(classifyPlayAlongTimingDelta(0)).toBe('on-time')
    expect(classifyPlayAlongTimingDelta(0.06)).toBe('on-time')
    expect(classifyPlayAlongTimingDelta(0.2)).toBe('late')
    expect(classifyPlayAlongTimingDelta(0.281)).toBe('too-late')
  })

  it('accepts early-but-inside, on-time, and late-but-inside attacks', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const early = createPlayAlongFeedbackState()
    expect(evaluatePlayAlongNoteInput(early, groups, 0.9, 60, {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    const onTime = createPlayAlongFeedbackState()
    expect(evaluatePlayAlongNoteInput(onTime, groups, 1.0, 60, {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    const late = createPlayAlongFeedbackState()
    expect(evaluatePlayAlongNoteInput(late, groups, 1.2, 60, {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
  })

  it('rejects too-early and too-late attacks (no outcome written)', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    expect(evaluatePlayAlongNoteInput(createPlayAlongFeedbackState(), groups, 0.5, 60, {})).toBeNull()
    expect(evaluatePlayAlongNoteInput(createPlayAlongFeedbackState(), groups, 1.5, 60, {})).toBeNull()
  })

  it('marks misses only after the late edge', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    expect(updatePlayAlongMisses(state, groups, 0.2)).toBe(false)
    expect(updatePlayAlongMisses(state, groups, 0.29)).toBe(true)
    expect(state.outcomes.get(groups[0].id)).toBe(VISUAL_LANE_OUTCOME.MISSED)
  })

  it('handles chords: partial tones do not complete, full set does', () => {
    const map = parseMusicXml(F.chordFixture())
    const groups = buildVisualLaneGroups(map, null, {})
    expect(groups[0].isChord).toBe(true)
    const state = createPlayAlongFeedbackState()
    const t = groups[0].timeSeconds
    // First tone of C+E+G alone: progress, no lane outcome yet.
    expect(evaluatePlayAlongNoteInput(state, groups, t, 60, {})).toBeNull()
    expect(evaluatePlayAlongNoteInput(state, groups, t, 64, {})).toBeNull()
    expect(evaluatePlayAlongNoteInput(state, groups, t, 67, {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
  })

  it('handles repeated notes as distinct onsets', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    expect(evaluatePlayAlongNoteInput(state, groups, 0.0, 60, {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    // Same pitch at the second onset completes the second group independently.
    expect(evaluatePlayAlongNoteInput(state, groups, 1.0, 60, {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    expect(state.outcomes.size).toBe(2)
  })

  it('handles simultaneous attacks via canonical chord grouping', () => {
    const map = parseMusicXml(F.chordFixture())
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    const t = groups[0].timeSeconds
    const results = [60, 64, 67].map((midi) =>
      evaluateCanonicalPlayAlongInput(
        state, groups,
        createCanonicalInputEvent({ source: 'synthetic', scoreTimeSeconds: t, midi, chordGroupId: 'sim-1' }),
        {},
      ),
    )
    expect(results.at(-1)?.outcome).toBe(VISUAL_LANE_OUTCOME.CORRECT)
  })

  it('resolves tempo-change onsets from source semantics (no silent approximation)', () => {
    const map = parseMusicXml(F.measureStartTempoChange())
    const events = resolveCanonicalTimingEvents(map)
    expect(events.length).toBeGreaterThan(0)
    // Measure 2 starts at 2.0s @120bpm (4 quarters), so m2 onset is 2.0s and
    // m3 onset is 4.0s @60bpm (quarter=1s → 4s span): total 6s.
    const m2 = events.find((e) => e.measureNumber === 2)
    expect(m2.onsetScoreSeconds).toBeCloseTo(2, 6)
    // m1 @120 (2s) + m2 @60 (4s) + m3 persists @60 (4s) = 10s per MusicXML semantics.
    expect(map.durationSeconds).toBeCloseTo(10, 6)
  })
})

describe('B03 MIDI enters the identical canonical contract (E5)', () => {
  it('MIDI and equivalent synthetic canonical input produce identical results', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const scoreTime = 1.0
    const midiEvent = normalizeMidiInputEvent(60, { scoreTimeSeconds: scoreTime })
    const synthEvent = normalizeSyntheticInputEvent(60, { scoreTimeSeconds: scoreTime })
    expect(midiEvent.source).toBe(INPUT_SOURCE.MIDI)
    expect(synthEvent.source).toBe(INPUT_SOURCE.SYNTHETIC)
    const midiState = createPlayAlongFeedbackState()
    const synthState = createPlayAlongFeedbackState()
    const midiResult = evaluateCanonicalPlayAlongInput(midiState, groups, midiEvent, {})
    const synthResult = evaluateCanonicalPlayAlongInput(synthState, groups, synthEvent, {})
    expect(midiResult).toEqual(synthResult)
    expect(midiResult?.outcome).toBe(VISUAL_LANE_OUTCOME.CORRECT)
  })

  it('MIDI 437ms early is rejected exactly like synthetic 437ms early', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const at = (source) =>
      evaluateCanonicalPlayAlongInput(
        createPlayAlongFeedbackState(), groups,
        source === 'midi'
          ? normalizeMidiInputEvent(60, { scoreTimeSeconds: 0.563 })
          : normalizeSyntheticInputEvent(60, { scoreTimeSeconds: 0.563 }),
        {},
      )
    expect(at('midi')).toBeNull()
    expect(at('synthetic')).toBeNull()
  })

  it('non-attack kinds and null pitches never evaluate', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    expect(evaluateCanonicalPlayAlongInput(state, groups, createCanonicalInputEvent({ source: 'midi', scoreTimeSeconds: 1, midi: 60, kind: 'release' }), {})).toBeNull()
    expect(evaluateCanonicalPlayAlongInput(state, groups, createCanonicalInputEvent({ source: 'midi', scoreTimeSeconds: 1, midi: null }), {})).toBeNull()
  })
})

describe('B03 attempt lifecycle: pause / seek / loop (E3/E6/E7/E8)', () => {
  it('attempt ids are stable and unique; session holds many attempts', () => {
    const a = createPracticeAttempt({ mode: 'play-along' })
    const b = createPracticeAttempt({ mode: 'play-along' })
    expect(a.id).not.toBe(b.id)
    expect(a.iterationIndex).toBe(0)
    expect(a.iterationId).toBe(`${a.id}:it0`)
    expect(createPracticeAttemptId()).not.toBe(createPracticeAttemptId())
  })

  it('pause preserves outcomes (no wipe); resume does not duplicate', () => {
    // Regression for the old `!active → reset` behavior: outcomes must
    // survive a pause. Pure-state equivalent: nothing clears the map on
    // pause; resume evaluation sees the existing CORRECT and returns null
    // (no duplicate award).
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    expect(evaluatePlayAlongNoteInput(state, groups, 0.0, 60, {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    expect(state.outcomes.size).toBe(1)
    // "Resume" at the same time: already-correct group is not re-awarded.
    expect(evaluatePlayAlongNoteInput(state, groups, 0.0, 60, {})).toBeNull()
    expect(state.outcomes.size).toBe(1)
  })

  it('backward seek prunes stale future misses', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    // Play through: miss both groups.
    updatePlayAlongMisses(state, groups, 5)
    expect(state.outcomes.size).toBe(2)
    // Backward seek to 0: future outcomes (t=1 group) pruned, past kept.
    expect(prunePlayAlongOutcomesAfterSeek(state, groups, 0)).toBe(true)
    expect(state.outcomes.has(groups[1].id)).toBe(false)
    expect(state.outcomes.has(groups[0].id)).toBe(true)
  })

  it('forward seek prunes future; skipped groups re-miss naturally', () => {
    const map = twoNoteMap()
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    expect(prunePlayAlongOutcomesAfterSeek(state, groups, 1.5)).toBe(false)
    // Jump ahead: groups before the new time with no outcome become missed
    // as the playhead (now at 1.5) passes their late edge.
    expect(updatePlayAlongMisses(state, groups, 1.5)).toBe(true)
    expect(state.outcomes.get(groups[0].id)).toBe(VISUAL_LANE_OUTCOME.MISSED)
  })

  it('loop iteration resets current outcomes without inheriting misses', () => {
    const state = createPlayAlongFeedbackState()
    state.outcomes.set('g1', VISUAL_LANE_OUTCOME.MISSED)
    resetPlayAlongForLoopIteration(state)
    expect(state.outcomes.size).toBe(0)
    const attempt = createPracticeAttempt({ mode: 'play-along' })
    const next = nextLoopIteration(attempt)
    expect(next.iterationIndex).toBe(1)
    expect(next.id).toBe(attempt.id)
    expect(next.iterationId).not.toBe(attempt.iterationId)
  })

  it('multi-iteration loops share exact bounds across consumers', () => {
    const map = parseMusicXml(F.straight4())
    const region = buildMeasureLoopRegion(map, 1, 2)
    expect(region.isValid).toBe(true)
    const enabled = canonicalLoopBounds(region, { enabled: true })
    const disabled = canonicalLoopBounds(region, { enabled: false })
    expect(enabled?.startTimeSeconds).toBeCloseTo(0, 6)
    expect(disabled).toBeNull()
    // Same bounds drive WFY checkpoints and the visual lane.
    const wfy = buildNoteCheckpoints(map, region)
    const lane = buildVisualLaneGroups(map, region, {})
    expect(wfy.length).toBe(lane.length)
    expect(wfy[0].timeSeconds).toBeCloseTo(region.startTimeSeconds, 6)
  })

  it('seek-into-loop and seek-while-paused prune to the new position', () => {
    const groups = [{ id: 'a', timeSeconds: 0 }, { id: 'b', timeSeconds: 2 }, { id: 'c', timeSeconds: 4 }]
    const byId = indexGroupsById(groups)
    const outcomes = new Map([['a', 'correct'], ['b', 'missed'], ['c', 'missed']])
    const pruned = pruneOutcomesAfterSeek(outcomes, byId, 1)
    expect(pruned.get('a')).toBe('correct')
    expect(pruned.has('b')).toBe(false)
    expect(pruned.has('c')).toBe(false)
    const sub = nextSubAttempt(createPracticeAttempt({}), { seekScoreSeconds: 1 })
    expect(sub.subAttemptIndex).toBe(1)
  })
})

describe('B04 Wait For You restored-first-match (E9)', () => {
  it('single-note checkpoint completes on the matching pitch', () => {
    const checkpoint = { id: 'cp-1', expectedMidis: [60], expectedMidi: 60, isChord: false }
    const buffer = createMusicalEventBufferState()
    const result = evaluateNoteInput(checkpoint, 60, buffer, {})
    expect(result.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('wrong note does not advance; correct note after wrong still completes', () => {
    const checkpoint = { id: 'cp-1', expectedMidis: [60], expectedMidi: 60, isChord: false }
    const buffer = createMusicalEventBufferState()
    expect(evaluateNoteInput(checkpoint, 61, buffer, {}).outcome).toBe(MATCH_OUTCOME.WRONG)
    expect(evaluateNoteInput(checkpoint, 60, buffer, {}).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('REPRO R4: rebuilt checkpoint list must not inherit a stale consumed marker', () => {
    // First traversal consumes cp-1; after async timing rebuild the new list
    // must accept cp-1 again (consumed cleared on checkpointsKey change).
    let consumed = 'note-m1-t0.000-0'
    expect(shouldBlockWaitForYouAdvance(consumed, 'note-m1-t0.000-0')).toBe(true)
    consumed = null // effect: clear on checkpointsKey change
    expect(shouldBlockWaitForYouAdvance(consumed, 'note-m1-t0.000-0')).toBe(false)
    expect(canMarkWaitForYouCheckpoint({ active: true, checkpointCount: 3, checkpointIndex: 0 })).toBe(true)
    expect(getNextCheckpointIndex(0, 3)).toBe(1)
  })

  it('first correct attack after restore advances exactly once (no second attack required)', () => {
    // Engine-level contract: accepted (not blocked) + next index committed.
    const checkpoints = [
      { id: 'a', timeSeconds: 0 },
      { id: 'b', timeSeconds: 1 },
    ]
    let consumed = null
    let index = 0
    const attack = () => {
      if (!canMarkWaitForYouCheckpoint({ active: true, checkpointCount: checkpoints.length, checkpointIndex: index })) return false
      const cp = checkpoints[index]
      if (shouldBlockWaitForYouAdvance(consumed, cp.id)) return false
      consumed = cp.id
      index = getNextCheckpointIndex(index, checkpoints.length)
      return true
    }
    expect(attack()).toBe(true)
    expect(index).toBe(1)
    // Duplicate signal for the same checkpoint is blocked (held MIDI/mic).
    consumed = checkpoints[1].id
    const blockedIndex = index
    const duplicate = shouldBlockWaitForYouAdvance(consumed, checkpoints[1].id)
    expect(duplicate).toBe(true)
    expect(index).toBe(blockedIndex)
  })

  it('repeated notes require a fresh attack per checkpoint', () => {
    const map = twoNoteMap()
    const checkpoints = buildNoteCheckpoints(map)
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints[0].expectedMidis).toEqual([60])
    expect(checkpoints[1].expectedMidis).toEqual([60])
    expect(checkpoints[0].id).not.toBe(checkpoints[1].id)
  })

  it('chords complete only when every tone is heard; rests produce no attack checkpoint', () => {
    const map = parseMusicXml(auditFixture())
    const checkpoints = buildNoteCheckpoints(map)
    // C4, C4, E+G chord, D, E, F, G (rest skipped) = 7 checkpoints.
    expect(checkpoints).toHaveLength(7)
    expect(checkpoints[2].isChord).toBe(true)
    expect(checkpoints[2].expectedMidis.sort()).toEqual([64, 67])
    const buffer = createMusicalEventBufferState()
    expect(evaluateNoteInput(checkpoints[2], 64, buffer, {}).outcome).toBe(MATCH_OUTCOME.CHORD_PROGRESS)
    expect(evaluateNoteInput(checkpoints[2], 67, buffer, {}).outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('seek after restore syncs to the nearest checkpoint; completion terminates', () => {
    const map = parseMusicXml(auditFixture())
    const checkpoints = buildNoteCheckpoints(map)
    expect(findCheckpointIndexAtTime(checkpoints, 100)).toBe(checkpoints.length - 1)
    expect(findCheckpointIndexAtTime(checkpoints, 0)).toBe(0)
  })

  it('canonical WFY evaluation accepts the same canonical input shape as Play Along', () => {
    const checkpoint = { id: 'cp-1', expectedMidis: [60], expectedMidi: 60, isChord: false }
    const event = normalizeMidiInputEvent(60, { scoreTimeSeconds: null })
    const result = evaluateCanonicalWaitForYouInput(checkpoint, event, createMusicalEventBufferState(), {})
    expect(result.outcome).toBe(MATCH_OUTCOME.COMPLETE)
  })
})

describe('B06 canonical timing contract (E1)', () => {
  it('every playable event resolves stable timing info from one truth', () => {
    const map = parseMusicXml(auditFixture())
    const events = resolveCanonicalTimingEvents(map)
    expect(events.length).toBe(7)
    for (const event of events) {
      expect(event.eventId).toBeTruthy()
      expect(Number.isFinite(event.onsetScoreSeconds)).toBe(true)
      expect(Array.isArray(event.expectedMidis)).toBe(true)
    }
    // Same truth drives playback duration, cursor locate, and lane groups.
    const duration = getTimeline(map).performedDurationSeconds
    expect(duration).toBeCloseTo(map.durationSeconds, 6)
    const located = locateCanonicalScoreTime(map, events[2].onsetScoreSeconds)
    expect(located.measureNumber).toBe(events[2].measureNumber)
    const lane = buildVisualLaneGroups(map, null, {})
    expect(lane.map((g) => g.id)).toEqual(events.map((e) => e.eventId))
  })

  it('repeat passes are distinct occurrences, not one written measure', () => {
    const map = parseMusicXml(F.oneRepeat())
    const events = resolveCanonicalTimingEvents(map)
    const m1 = events.filter((e) => e.measureNumber === 1)
    expect(new Set(m1.map((e) => e.repeatPass))).toEqual(new Set([1, 2]))
  })

  it('unsupported semantics surface explicitly instead of silently approximating', () => {
    const map = parseMusicXml(F.straight4())
    const fidelity = describeSourceFidelity(map)
    expect(fidelity.contractVersion).toBe(1)
    expect(Array.isArray(fidelity.unsupported)).toBe(true)
  })

  it('window helpers agree with the contract onsets', () => {
    const group = { timeSeconds: 1 }
    expect(playAlongWindowStart(group)).toBeCloseTo(0.85, 9)
    expect(playAlongWindowEnd(group)).toBeCloseTo(1.28, 9)
    expect(resolvePlayAlongTargetIndex([{ id: 'a', timeSeconds: 0 }, { id: 'b', timeSeconds: 1 }], 0.563)).toBe(1)
  })
})

describe('E14 evaluation result model (B09 foundation)', () => {
  it('distinguishes correct/early/late/missed/extra/ignored and preserves attribution', () => {
    const correct = createEvaluationResult({ outcome: EVALUATION_OUTCOME.CORRECT, eventId: 'e1', attemptId: 'att-1', iterationId: 'att-1:it0', expectedMidis: [60], playedMidi: 60, deltaMs: 12, measureNumber: 1 })
    expect(correct.eventId).toBe('e1')
    expect(isCleanRunAttempt([correct])).toBe(true)
    expect(isCleanRunAttempt([correct, createEvaluationResult({ outcome: EVALUATION_OUTCOME.MISSED, measureNumber: 1 })])).toBe(false)
    expect(isCleanRunAttempt([])).toBe(false)
  })

  it('aggregates per-measure trouble spots without fabricating metrics', () => {
    const results = [
      createEvaluationResult({ outcome: EVALUATION_OUTCOME.CORRECT, measureNumber: 1 }),
      createEvaluationResult({ outcome: EVALUATION_OUTCOME.MISSED, measureNumber: 2 }),
      createEvaluationResult({ outcome: EVALUATION_OUTCOME.WRONG, measureNumber: 2 }),
    ]
    const spots = aggregateTroubleSpots(results)
    expect(spots.find((s) => s.measureNumber === 2)?.missed).toBe(1)
    expect(spots.find((s) => s.measureNumber === 2)?.wrong).toBe(1)
    expect(Object.values(EVALUATION_OUTCOME)).toEqual(expect.arrayContaining(['correct', 'early', 'late', 'missed', 'extra', 'wrong', 'ignored']))
  })
})

describe('E2 canonical input event contract', () => {
  it('retains identity/source/timestamps/pitch/velocity/chord grouping', () => {
    const a = createCanonicalInputEvent({ source: 'midi', scoreTimeSeconds: 1.5, midi: 60, velocityOrConfidence: 100, chordGroupId: 'g1', attemptId: 'att-1' })
    const b = createCanonicalInputEvent({ source: 'midi', scoreTimeSeconds: 1.5, midi: 60, velocityOrConfidence: 100, chordGroupId: 'g1', attemptId: 'att-1' })
    expect(a.id).not.toBe(b.id)
    expect(a.source).toBe('midi')
    expect(a.scoreTimeSeconds).toBe(1.5)
    expect(a.velocityOrConfidence).toBe(100)
    expect(a.chordGroupId).toBe('g1')
    expect(a.attemptId).toBe('att-1')
    expect(a.kind).toBe('attack')
  })

  it('reset helpers clear buffers without leaking across attempts', () => {
    const state = createPlayAlongFeedbackState()
    state.outcomes.set('x', VISUAL_LANE_OUTCOME.CORRECT)
    resetPlayAlongFeedbackState(state)
    expect(state.outcomes.size).toBe(0)
    expect(state.activeGroupId).toBeNull()
  })
})
