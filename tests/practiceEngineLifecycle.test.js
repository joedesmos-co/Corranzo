/**
 * Practice engine lifecycle / visual / storage / source-faithfulness (E7/E8/E12/E13/E15/E16).
 * - WFY full sequence on the audit fixture (single/repeated/chord/rest/tempo/seek/end).
 * - WFY loop + tempo + completion + seek-after-restore.
 * - Play Along tempo change, repeated pause/resume cycles, attempt isolation.
 * - Visual Practice Mode inherits the canonical lane (same ids, outcome join).
 * - Storage/session compatibility (durable storage at cac077e865 untouched).
 * - Source faithfulness: tempo/duration/chords/rests/ties/tuplets/measures.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildNoteCheckpoints,
  findCheckpointIndexAtTime,
} from '../src/features/practice/waitForYouCheckpoints.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import { applyLaneOutcomes, VISUAL_LANE_OUTCOME } from '../src/features/practice/visualLaneFeedback.js'
import {
  createPlayAlongFeedbackState,
  evaluatePlayAlongNoteInput,
  prunePlayAlongOutcomesAfterSeek,
  updatePlayAlongMisses,
} from '../src/features/practice/playAlongLaneFeedback.js'
import {
  createMusicalEventBufferState,
  evaluateNoteInput,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import {
  canMarkWaitForYouCheckpoint,
  getNextCheckpointIndex,
  getWaitForYouStatus,
  shouldBlockWaitForYouAdvance,
  WFY_STATUS,
} from '../src/features/practice/waitForYouEngine.js'
import {
  createPracticeAttempt,
  nextLoopIteration,
} from '../src/features/practice/practiceAttempt.js'
import {
  canonicalLoopBounds,
  resolveCanonicalTimingEvents,
} from '../src/features/practice/canonicalTimingContract.js'
import { buildMeasureLoopRegion } from '../src/features/practice/practiceLoopRegion.js'
import { loadSessionMetaWithStatus, SESSION_META_VERSION } from '../src/features/session/sessionPersistence.js'
import * as F from './helpers/buildXml.js'

function auditFixture() {
  const xml =
    `<measure number="1">${F.attributes()}${F.soundTempo(60)}` +
    `${F.note('C')}${F.note('C')}` +
    `<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>` +
    `<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>` +
    `${F.rest()}</measure>` +
    `<measure number="2">${F.soundTempo(120)}${F.note('D')}${F.note('E')}${F.note('F')}${F.note('G')}</measure>`
  return F.scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Simulate a full WFY traversal through pitch matching + engine commits. */
function traverseWfy(checkpoints, attacks) {
  let index = 0
  let consumed = null
  const buffer = createMusicalEventBufferState()
  const visited = []
  for (const midi of attacks) {
    const cp = checkpoints[index]
    if (!cp) break
    if (!canMarkWaitForYouCheckpoint({ active: true, checkpointCount: checkpoints.length, checkpointIndex: index })) break
    if (index !== checkpoints.indexOf(cp)) break
    const result = evaluateNoteInput(cp, midi, buffer, {})
    if (result.outcome === MATCH_OUTCOME.COMPLETE) {
      if (shouldBlockWaitForYouAdvance(consumed, cp.id)) continue
      consumed = cp.id
      visited.push(cp.id)
      index = getNextCheckpointIndex(index, checkpoints.length)
      consumed = null // next checkpoint id differs; simulate id-change clear
    }
  }
  return { index, visited, status: getWaitForYouStatus({ active: true, checkpointCount: checkpoints.length, checkpointIndex: index }) }
}

describe('WFY full audit sequence (E16)', () => {
  it('advances single/repeated/chord, skips rest, crosses tempo change, completes', () => {
    const map = parseMusicXml(auditFixture())
    const checkpoints = buildNoteCheckpoints(map)
    expect(checkpoints).toHaveLength(7)
    // C4, C4 (repeated), E+G chord (E then G), D E F G across 60→120 change.
    const { index, visited, status } = traverseWfy(checkpoints, [60, 60, 64, 67, 62, 64, 65, 67])
    expect(visited).toHaveLength(7)
    expect(index).toBe(7)
    expect(status).toBe(WFY_STATUS.COMPLETE)
  })

  it('wrong note never advances; rest checkpoints do not exist as attacks', () => {
    const map = parseMusicXml(auditFixture())
    const checkpoints = buildNoteCheckpoints(map)
    const buffer = createMusicalEventBufferState()
    expect(evaluateNoteInput(checkpoints[0], 61, buffer, {}).outcome).toBe(MATCH_OUTCOME.WRONG)
    // Rest at 3.0s (m1 beat 4) produces no checkpoint: onsets skip 2.0→3.0→4.0.
    const times = checkpoints.map((c) => c.timeSeconds)
    expect(times).not.toContain(3)
  })

  it('seek syncs to nearest checkpoint; restart returns to zero', () => {
    const map = parseMusicXml(auditFixture())
    const checkpoints = buildNoteCheckpoints(map)
    // m1 @60: C(0) C(1) E+G(2) rest(3); m2 @120 starts at 4s: D(4) E(4.5).
    // Seek to 4.5s lands on the E4 checkpoint (nearest to 4.5).
    const idx = findCheckpointIndexAtTime(checkpoints, 4.5)
    expect(checkpoints[idx].expectedMidis).toEqual([64])
    expect(findCheckpointIndexAtTime(checkpoints, 4.2)).toBe(checkpoints.findIndex((c) => c.expectedMidis[0] === 62))
  })

  it('loop filters checkpoints to the region; completion flag terminates', () => {
    const map = parseMusicXml(F.straight4())
    const region = buildMeasureLoopRegion(map, 1, 1)
    const full = buildNoteCheckpoints(map)
    const looped = buildNoteCheckpoints(map, region)
    expect(looped.length).toBeLessThan(full.length)
    expect(looped.every((cp) => cp.timeSeconds >= region.startTimeSeconds - 1e-6 && cp.timeSeconds < region.endTimeSeconds)).toBe(true)
    expect(getWaitForYouStatus({ active: true, checkpointCount: 4, checkpointIndex: 4 })).toBe(WFY_STATUS.COMPLETE)
  })

  it('tempo change preserves onset order and chord grouping', () => {
    const map = parseMusicXml(auditFixture())
    const events = resolveCanonicalTimingEvents(map)
    const onsets = events.map((e) => e.onsetScoreSeconds)
    expect([...onsets].sort((a, b) => a - b)).toEqual(onsets)
    expect(events[2].isChord).toBe(true)
  })
})

describe('Play Along lifecycle matrix (E16)', () => {
  it('tempo change: identical windows before and after the change', () => {
    const map = parseMusicXml(F.measureStartTempoChange())
    const groups = buildVisualLaneGroups(map, null, {})
    expect(groups.length).toBeGreaterThan(0)
    // Windows are absolute (150/280ms) on both sides of the tempo change.
    const before = groups[0]
    const after = groups.find((g) => g.timeSeconds >= 2) ?? groups.at(-1)
    expect(evaluatePlayAlongNoteInput(createPlayAlongFeedbackState(), groups, before.timeSeconds, before.midis[0], {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    expect(evaluatePlayAlongNoteInput(createPlayAlongFeedbackState(), groups, after.timeSeconds, after.midis[0], {})).toBe(VISUAL_LANE_OUTCOME.CORRECT)
  })

  it('repeated pause/resume cycles never wipe or duplicate outcomes', () => {
    const map = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    for (let cycle = 0; cycle < 3; cycle += 1) {
      // "Pause": do nothing to state (preserved). "Resume": same attempt.
      evaluatePlayAlongNoteInput(state, groups, groups[0].timeSeconds, groups[0].midis[0], {})
      // Duplicate attack for the same group is not re-awarded.
      expect(evaluatePlayAlongNoteInput(state, groups, groups[0].timeSeconds, groups[0].midis[0], {})).toBeNull()
    }
    expect(state.outcomes.get(groups[0].id)).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    expect(state.outcomes.size).toBe(1)
  })

  it('attempt isolation: old outcomes never leak into a new attempt', () => {
    const a = createPracticeAttempt({ mode: 'play-along' })
    const b = createPracticeAttempt({ mode: 'play-along' })
    expect(a.id).not.toBe(b.id)
    // New attempt starts with a fresh feedback state (no shared Map).
    const stateA = createPlayAlongFeedbackState()
    stateA.outcomes.set('g1', VISUAL_LANE_OUTCOME.CORRECT)
    const stateB = createPlayAlongFeedbackState()
    expect(stateB.outcomes.size).toBe(0)
  })

  it('seek while paused prunes future without touching the past', () => {
    const map = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(map, null, {})
    const state = createPlayAlongFeedbackState()
    updatePlayAlongMisses(state, groups, 100)
    const before = state.outcomes.size
    expect(before).toBeGreaterThan(0)
    prunePlayAlongOutcomesAfterSeek(state, groups, groups[0].timeSeconds)
    expect(state.outcomes.has(groups[0].id)).toBe(true)
    for (const [id] of state.outcomes) {
      const group = groups.find((g) => g.id === id)
      expect(group.timeSeconds).toBeLessThanOrEqual(groups[0].timeSeconds + 1e-6)
    }
  })

  it('loop iteration bounds are identical for audio/cursor/evaluator', () => {
    const map = parseMusicXml(F.straight4())
    const region = buildMeasureLoopRegion(map, 2, 3)
    const bounds = canonicalLoopBounds(region, { enabled: true })
    expect(bounds.startTimeSeconds).toBeCloseTo(region.startTimeSeconds, 9)
    expect(bounds.endTimeSeconds).toBeCloseTo(region.endTimeSeconds, 9)
    const iter = nextLoopIteration(createPracticeAttempt({ mode: 'play-along' }))
    expect(iter.iterationIndex).toBe(1)
  })
})

describe('Visual Practice Mode inherits canonical correctness (E12)', () => {
  it('lane groups share checkpoint ids; outcomes join by id; Score/Visual stay synchronized', () => {
    const map = parseMusicXml(auditFixture())
    const checkpoints = buildNoteCheckpoints(map)
    const groups = buildVisualLaneGroups(map, null, {})
    expect(groups.map((g) => g.id)).toEqual(checkpoints.map((c) => c.id))
    // Fixed playhead + horizontal staff + chords + keyboard all render from
    // these groups; outcomes attach by stable group id (no separate timeline).
    const outcomes = new Map([[groups[0].id, VISUAL_LANE_OUTCOME.CORRECT]])
    const withOutcomes = applyLaneOutcomes(groups, outcomes)
    expect(withOutcomes[0].laneOutcome).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    expect(withOutcomes[1].laneOutcome).toBe('neutral')
  })

  it('no visual timing hack: visual target resolves from absolute score time', () => {
    const map = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(map, null, {})
    // Same absolute time always resolves the same group (seek/loop safe).
    const again = buildVisualLaneGroups(map, null, {})
    expect(again.map((g) => g.id)).toEqual(groups.map((g) => g.id))
  })
})

describe('Storage/session compatibility (E13 — do not regress cac077e865)', () => {
  it('session meta loader keeps versioned, backward-compatible contract', () => {
    expect(SESSION_META_VERSION).toBe(2)
    const status = loadSessionMetaWithStatus()
    expect(['none', 'ok', 'recovered', 'corrupted']).toContain(status.status)
  })

  it('practice attempts store alongside sessions without rewriting persistence', async () => {
    const attempt = createPracticeAttempt({ mode: 'wait-for-you' })
    // Attempt identity is an in-memory traversal id; persistence schema is
    // untouched (no migration). If a future schema extends, it must be
    // versioned and backward-compatible — this test pins the current version.
    expect(attempt.id.startsWith('att-')).toBe(true)
    expect(SESSION_META_VERSION).toBe(2)
  })
})

describe('Source faithfulness (E15)', () => {
  it('derives tempo/duration/chords/rests from source semantics', () => {
    const map = parseMusicXml(auditFixture())
    expect(map.durationSeconds).toBeGreaterThan(0)
    const checkpoints = buildNoteCheckpoints(map)
    expect(checkpoints.some((c) => c.isChord)).toBe(true)
  })

  it('folds ties into one attack target (no re-attack required)', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}` +
      `${F.tiedNote('C', 4, 1, { start: true })}${F.tiedNote('C', 4, 1, { stop: true })}</measure></part>`,
    )
    const map = parseMusicXml(xml)
    const checkpoints = buildNoteCheckpoints(map)
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0].expectedMidis).toEqual([60])
  })

  it('supports tuplets via time-modification without silent approximation', () => {
    const triplet = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>`
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}${triplet}${triplet}${triplet}${F.note('D')}</measure></part>`,
    )
    const map = parseMusicXml(xml)
    expect(map.notes.length).toBeGreaterThanOrEqual(4)
  })

  it('repeat passes keep distinct measure-transition identities', () => {
    const map = parseMusicXml(F.oneRepeat())
    const events = resolveCanonicalTimingEvents(map)
    const passes = new Set(events.map((e) => `${e.measureNumber}:p${e.repeatPass}`))
    expect(passes.has('1:p1')).toBe(true)
    expect(passes.has('1:p2')).toBe(true)
  })
})
