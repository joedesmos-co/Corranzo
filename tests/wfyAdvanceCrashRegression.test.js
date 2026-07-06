/**
 * Regression: WFY checkpoint advance must not crash on guitar notation+TAB
 * events (Wet-Hands-like malformed fields) or on circular-import label helpers.
 */
import { describe, expect, it } from 'vitest'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { enrichGuitarChordCheckpoint } from '../src/features/practice/guitarChordShapeCheckpoint.js'
import { buildVisualLaneGroups, resolveVisualTarget, selectVisualWindow } from '../src/features/practice/visualPracticeLane.js'
import { buildTabLaneNotes, buildTabGeometry, buildTabLaneTechniqueMarkings } from '../src/features/practice/tabLaneLayout.js'
import { buildGuidance } from '../src/features/practice/waitForYouGuidance.js'
import { getExpectedMidis, evaluateMicScoreInformedInput, MATCH_OUTCOME } from '../src/features/practice/waitForYouNoteMatch.js'
import { missingLabels, chordLabel } from '../src/features/practice/waitForYouLabels.js'
import { buildScoreNoteSchedule } from '../src/features/playback/scorePlaybackSchedule.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { WFY_INPUT_OUTCOME } from '../src/features/practice/waitForYouInputFeedback.js'
import { buildStaffLaneNotes, buildStaffLaneNotationMarkings, detectStaves, buildStaffGeometry } from '../src/features/practice/staffLaneLayout.js'
import { buildVisualSpanMarkings } from '../src/features/practice/visualNotationMarkings.js'
import { playReferenceMidis } from '../src/features/practice/referenceNotePlayer.js'

const settings = normalizeMatchSettings({})

/** Synthetic notation+TAB guitar timing map with common OMR edge cases. */
function wetHandsLikeTimingMap() {
  return {
    durationSeconds: 48,
    stavesPerSystem: 2,
    measures: [{ number: 1, beats: 4, beatType: 4, timeSeconds: 0 }],
    notes: [
      {
        id: 'n-open',
        midi: 64,
        timeSeconds: 0,
        quarterTime: 0,
        durationSeconds: 0.5,
        durationQuarters: 0.5,
        measureNumber: 1,
        string: 1,
        fret: 0,
        staff: 1,
      },
      {
        id: 'n-chord-a',
        midi: 67,
        timeSeconds: 0.5,
        quarterTime: 0.5,
        durationSeconds: 0.5,
        durationQuarters: 0.5,
        measureNumber: 1,
        string: 2,
        fret: 8,
        staff: 1,
      },
      {
        id: 'n-chord-b',
        midi: 63,
        timeSeconds: 0.5,
        quarterTime: 0.5,
        durationSeconds: 0.5,
        durationQuarters: 0.5,
        measureNumber: 1,
        string: 3,
        fret: 8,
        staff: 1,
      },
      {
        id: 'n-chord-c',
        midi: 58,
        timeSeconds: 0.5,
        quarterTime: 0.5,
        durationSeconds: 0.5,
        durationQuarters: 0.5,
        measureNumber: 1,
        string: 4,
        fret: 8,
        staff: 1,
      },
      {
        id: 'n-bad-duration',
        midi: 57,
        timeSeconds: 1.0,
        quarterTime: 1,
        durationSeconds: NaN,
        durationQuarters: undefined,
        measureNumber: 1,
        string: 5,
        fret: 5,
        staff: 1,
      },
      {
        id: 'n-tab-mirror',
        midi: 64,
        timeSeconds: 1.5,
        quarterTime: 1.5,
        durationSeconds: 0.25,
        durationQuarters: 0.25,
        measureNumber: 1,
        string: 1,
        fret: 0,
        isTabMirror: true,
      },
      {
        id: 'n-tie-head',
        midi: 52,
        timeSeconds: 2.0,
        quarterTime: 2,
        durationSeconds: 1.0,
        durationQuarters: 1,
        measureNumber: 1,
        string: 6,
        fret: 3,
        tieStart: true,
        partId: 'P1',
        voice: 1,
      },
      {
        id: 'n-tie-cont',
        midi: 52,
        timeSeconds: 3.0,
        quarterTime: 3,
        durationSeconds: 0.5,
        durationQuarters: 0.5,
        measureNumber: 1,
        string: 6,
        fret: 3,
        tieStop: true,
        suppressPlaybackAttack: true,
        partId: 'P1',
        voice: 1,
      },
      {
        id: 'n-invalid-midi',
        midi: Number.NaN,
        timeSeconds: 3.5,
        quarterTime: 3.5,
        durationSeconds: -0.2,
        durationQuarters: -0.2,
        measureNumber: 1,
        string: 2,
        fret: 12,
      },
    ],
    harmonyEvents: [],
  }
}

describe('WFY advance crash regression (guitar notation+TAB)', () => {
  it('label helpers load without circular-import TDZ', () => {
    expect(chordLabel([64, 67])).toContain('+')
    expect(missingLabels([64, 67, 70], new Set([0]))).toEqual(['G4', 'A#4'])
  })

  it('builds checkpoints and advances visual target without throwing', () => {
    const timingMap = wetHandsLikeTimingMap()
    const checkpoints = buildNoteCheckpoints(timingMap)
    expect(checkpoints.length).toBeGreaterThan(0)

    const first = enrichGuitarChordCheckpoint(checkpoints[0], { instrumentId: 'guitar' })
    const second = enrichGuitarChordCheckpoint(checkpoints[1], { instrumentId: 'guitar' })
    expect(getExpectedMidis(first).length).toBeGreaterThan(0)
    expect(getExpectedMidis(second).length).toBeGreaterThan(0)

    const groups = buildVisualLaneGroups(timingMap, null, { instrumentId: 'guitar' })
    expect(groups.length).toBeGreaterThan(0)

    const { index, group } = resolveVisualTarget(groups, {
      currentTime: first.timeSeconds,
      waitForYouCheckpoint: first,
    })
    expect(index).toBeGreaterThanOrEqual(0)
    expect(group?.id).toBe(first.id)

    const window = selectVisualWindow(groups, Math.floor(first.timeSeconds), index)
    expect(window.length).toBeGreaterThan(0)

    const strings = { count: 6, tuning: [64, 59, 55, 50, 45, 40] }
    const geometry = buildTabGeometry(strings)
    const tabNotes = buildTabLaneNotes(window, geometry)
    expect(() => buildTabLaneTechniqueMarkings(window, geometry, { notes: tabNotes })).not.toThrow()

    const guidance = buildGuidance({
      checkpoint: second,
      inputFeedback: { outcome: WFY_INPUT_OUTCOME.IDLE },
      matchingActive: true,
    })
    expect(guidance.primary).toBeTruthy()
  })

  it('playback schedule ignores invalid note events safely', () => {
    const events = buildScoreNoteSchedule(wetHandsLikeTimingMap())
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(Number.isFinite(event.scoreTimeSeconds)).toBe(true)
      expect(Number.isFinite(event.midi)).toBe(true)
      expect(event.baseDurationSeconds).toBeGreaterThan(0)
    }
  })

  it('mic match + advance to next checkpoint does not throw', () => {
    const timingMap = wetHandsLikeTimingMap()
    const checkpoints = buildNoteCheckpoints(timingMap).map((cp) =>
      enrichGuitarChordCheckpoint(cp, { instrumentId: 'guitar' }),
    )
    const first = checkpoints[0]
    const second = checkpoints[1]
    const preview = evaluateMicScoreInformedInput(first, [first.expectedMidis[0]], settings)
    expect(preview.outcome).toBe(MATCH_OUTCOME.COMPLETE)

    const nextTarget = resolveVisualTarget(buildVisualLaneGroups(timingMap, null, { instrumentId: 'guitar' }), {
      currentTime: second.timeSeconds,
      waitForYouCheckpoint: second,
    })
    expect(nextTarget.group?.id).toBe(second.id)
  })

  it('piano visual lane advance path does not throw on malformed notes', () => {
    const timingMap = {
      durationSeconds: 8,
      measures: [{ number: 1, beats: 4, beatType: 4, timeSeconds: 0 }],
      notes: [
        {
          id: 'p1',
          midi: 60,
          timeSeconds: 0,
          durationSeconds: 0.5,
          measureNumber: 1,
          staff: 1,
        },
        {
          id: 'p2',
          midi: Number.NaN,
          timeSeconds: 0.5,
          durationSeconds: NaN,
          measureNumber: 1,
          staff: 1,
          tieStart: true,
          slurs: [{ type: 'start', number: '1' }],
          guitarTechniques: [{ kind: 'hammer-on', type: 'start', number: '1' }],
        },
        {
          id: 'p3',
          midi: 62,
          timeSeconds: 1,
          durationSeconds: -0.2,
          measureNumber: 1,
          staff: 1,
          tieStop: true,
          slurs: [{ type: 'stop', number: '1' }],
        },
      ],
      harmonyEvents: [],
    }
    const groups = buildVisualLaneGroups(timingMap, null, { instrumentId: 'piano' })
    expect(groups.length).toBeGreaterThan(0)
    const staves = detectStaves(groups)
    const geometry = buildStaffGeometry(staves)
    const window = selectVisualWindow(groups, 0, 0)
    expect(() => buildStaffLaneNotes(window, geometry)).not.toThrow()
    const notes = buildStaffLaneNotes(window, geometry)
    expect(() => buildStaffLaneNotationMarkings(window, geometry, { notes })).not.toThrow()
    expect(() => buildVisualSpanMarkings(window)).not.toThrow()
    for (const note of notes) {
      expect(Number.isFinite(note.midi)).toBe(true)
    }
  })

  it('malformed TAB fret notes and markings do not crash tab lane builders', () => {
    const timingMap = wetHandsLikeTimingMap()
    const groups = buildVisualLaneGroups(timingMap, null, { instrumentId: 'guitar' })
    const malformedGroup = {
      ...groups[0],
      notes: [
        ...(groups[0].notes ?? []),
        {
          visualNoteId: 'bad-note',
          midi: Number.NaN,
          durationSeconds: NaN,
          string: 99,
          fret: Number.NaN,
          guitarTechniques: [{ kind: 'not-real', type: 'start' }],
        },
      ],
    }
    const geometry = buildTabGeometry({ count: 6, tuning: [64, 59, 55, 50, 45, 40] })
    expect(() => buildTabLaneNotes([malformedGroup], geometry)).not.toThrow()
    expect(() =>
      buildTabLaneTechniqueMarkings([malformedGroup], geometry, {
        notes: buildTabLaneNotes([malformedGroup], geometry),
      }),
    ).not.toThrow()
  })

  it('reference playback rejects invalid midis without throwing synchronously', async () => {
    await expect(playReferenceMidis([Number.NaN, 999], 0.5, { instrumentId: 'piano' })).resolves.toBeUndefined()
  })
})
