import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  getPlayAlongVisualEvents,
  resolvePlayAlongVisualCheckpoint,
} from '../src/features/practice/playAlongVisualTarget.js'
import {
  mapPracticeTargetPointToOverlay,
  resolvePracticeTargetHighlightRects,
} from '../src/features/practice/practiceNoteTargetOverlay.js'
import {
  NOTE_TARGET_SOURCE,
  resolveNoteTargetPosition,
} from '../src/features/practice/noteTargetPosition.js'
import { pausePlaybackAtAuthoritativeTime } from '../src/features/practice/practicePlaybackPause.js'
import { PRACTICE_SCOPE } from '../src/features/practice/practiceScope.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import { CHECKPOINT_KIND } from '../src/features/practice/waitForYouCheckpoints.js'
import * as F from './helpers/buildXml.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

function visualTimingMap() {
  return {
    durationSeconds: 1,
    stavesPerSystem: 2,
    parts: [{ id: 'P1', staves: 2 }],
    measures: [
      {
        number: 1,
        startTimeSeconds: 0,
        endTimeSeconds: 1,
        durationSeconds: 1,
      },
    ],
    beats: [],
    notes: [
      {
        id: 'right-c4',
        sourceNoteheadId: 'source-right-c4',
        partId: 'P1',
        staff: 1,
        measureNumber: 1,
        timeSeconds: 0,
        durationSeconds: 0.2,
        midi: 60,
      },
      {
        id: 'left-c3',
        sourceNoteheadId: 'source-left-c3',
        partId: 'P1',
        staff: 2,
        measureNumber: 1,
        timeSeconds: 0,
        durationSeconds: 0.2,
        midi: 48,
      },
      {
        id: 'sequential-d4',
        sourceNoteheadId: 'source-sequential-d4',
        partId: 'P1',
        staff: 1,
        measureNumber: 1,
        timeSeconds: 0.08,
        durationSeconds: 0.1,
        midi: 62,
      },
      {
        id: 'tie-e4',
        sourceNoteheadId: 'source-tie-e4',
        partId: 'P1',
        staff: 1,
        measureNumber: 1,
        timeSeconds: 0.4,
        durationSeconds: 0.15,
        midi: 64,
        tieStop: true,
        suppressPlaybackAttack: true,
      },
      {
        id: 'rest',
        partId: 'P1',
        staff: 1,
        measureNumber: 1,
        timeSeconds: 0.7,
        durationSeconds: 0.2,
        isRest: true,
        midi: null,
      },
    ],
  }
}

function sourceGeometry(representation, x, y) {
  return {
    representation,
    sourceCenter: {
      x,
      y,
      coordinateSpace: 'pdf-source-normalized',
    },
    sourceBBox: {
      x0: x - 0.01,
      y0: y - 0.008,
      x1: x + 0.01,
      y1: y + 0.008,
      coordinateSpace: 'pdf-source-normalized',
    },
    confidence: 0.95,
    geometrySource: 'test-source-geometry',
  }
}

function fallbackScoreAnchors() {
  return [
    {
      id: 'm1',
      page: 1,
      x: 0.1,
      y: 0.36,
      measureNumber: 1,
      source: 'manual',
      meta: { playableStartX: 0.1, playableEndX: 0.5, systemEndX: 0.9 },
    },
    {
      id: 'm2',
      page: 1,
      x: 0.5,
      y: 0.36,
      measureNumber: 2,
      source: 'manual',
      meta: { playableStartX: 0.5, playableEndX: 0.9, systemEndX: 0.9 },
    },
  ]
}

describe('Play Along semantic visual checkpoints', () => {
  it('groups true simultaneities without merging nearby sequential onsets', () => {
    const events = getPlayAlongVisualEvents(
      visualTimingMap(),
      PRACTICE_SCOPE.BOTH_HANDS,
    )

    expect(events[0].expectedMidis).toEqual([48, 60])
    expect(events[0].isChord).toBe(true)
    expect(events[1].timeSeconds).toBeCloseTo(0.08, 6)
    expect(events[1].expectedMidis).toEqual([62])
    expect(resolvePlayAlongVisualCheckpoint(
      visualTimingMap(),
      0.08,
      PRACTICE_SCOPE.BOTH_HANDS,
    )?.expectedMidis).toEqual([62])
  })

  it('honors hand scope and retains printed tie/rest occurrences', () => {
    const map = visualTimingMap()
    const right = getPlayAlongVisualEvents(map, PRACTICE_SCOPE.RIGHT_HAND)
    const left = getPlayAlongVisualEvents(map, PRACTICE_SCOPE.LEFT_HAND)

    expect(right[0].expectedMidis).toEqual([60])
    expect(left[0].expectedMidis).toEqual([48])
    expect(resolvePlayAlongVisualCheckpoint(
      map,
      0.4,
      PRACTICE_SCOPE.RIGHT_HAND,
    )).toMatchObject({
      expectedMidis: [64],
      isTiedContinuation: true,
    })
    expect(resolvePlayAlongVisualCheckpoint(
      map,
      0.7,
      PRACTICE_SCOPE.RIGHT_HAND,
    )).toMatchObject({
      isRest: true,
      notes: [],
    })
  })

  it('does not let a concurrent rest extend the playable note highlight', () => {
    const map = {
      measures: [
        { number: 1, startTimeSeconds: 0, endTimeSeconds: 3, durationSeconds: 3 },
      ],
      beats: [],
      notes: [
        {
          id: 'short-note',
          partId: 'P1',
          staff: 1,
          measureNumber: 1,
          timeSeconds: 0,
          durationSeconds: 0.25,
          midi: 60,
        },
        {
          id: 'long-concurrent-rest',
          partId: 'P1',
          staff: 1,
          measureNumber: 1,
          timeSeconds: 0,
          durationSeconds: 2,
          isRest: true,
          midi: null,
        },
        {
          id: 'next-note',
          partId: 'P1',
          staff: 1,
          measureNumber: 1,
          timeSeconds: 2,
          durationSeconds: 0.25,
          midi: 62,
        },
      ],
    }

    const events = getPlayAlongVisualEvents(map, PRACTICE_SCOPE.BOTH_HANDS)
    expect(events[0]).toMatchObject({ expectedMidis: [60], endTimeSeconds: 0.25 })
    expect(resolvePlayAlongVisualCheckpoint(map, 0.2, PRACTICE_SCOPE.BOTH_HANDS))
      .toMatchObject({ expectedMidis: [60] })
    expect(resolvePlayAlongVisualCheckpoint(map, 0.3, PRACTICE_SCOPE.BOTH_HANDS))
      .toBeNull()
    expect(resolvePlayAlongVisualCheckpoint(map, 1.5, PRACTICE_SCOPE.BOTH_HANDS))
      .toBeNull()
  })

  it('keeps zero-duration notes until the next onset but bounds the final note', () => {
    const withNextOnset = {
      measures: [
        { number: 1, startTimeSeconds: 0, endTimeSeconds: 3, durationSeconds: 3 },
      ],
      beats: [],
      notes: [
        {
          id: 'zero-note',
          partId: 'P1',
          staff: 1,
          measureNumber: 1,
          timeSeconds: 0,
          durationSeconds: 0,
          midi: 60,
        },
        {
          id: 'next-note',
          partId: 'P1',
          staff: 1,
          measureNumber: 1,
          timeSeconds: 2,
          durationSeconds: 0.25,
          midi: 62,
        },
      ],
    }
    const finalZeroDuration = {
      ...withNextOnset,
      notes: [withNextOnset.notes[0]],
    }

    expect(getPlayAlongVisualEvents(
      withNextOnset,
      PRACTICE_SCOPE.BOTH_HANDS,
    )[0].endTimeSeconds).toBe(2)
    expect(resolvePlayAlongVisualCheckpoint(
      withNextOnset,
      1.5,
      PRACTICE_SCOPE.BOTH_HANDS,
    )).toMatchObject({ expectedMidis: [60] })
    expect(resolvePlayAlongVisualCheckpoint(
      withNextOnset,
      2,
      PRACTICE_SCOPE.BOTH_HANDS,
    )).toMatchObject({ expectedMidis: [62] })
    expect(resolvePlayAlongVisualCheckpoint(
      finalZeroDuration,
      0.1,
      PRACTICE_SCOPE.BOTH_HANDS,
    )).toMatchObject({ expectedMidis: [60] })
    expect(resolvePlayAlongVisualCheckpoint(
      finalZeroDuration,
      0.121,
      PRACTICE_SCOPE.BOTH_HANDS,
    )).toBeNull()
  })

  it('keeps standalone rests cursor-only', () => {
    const map = visualTimingMap()
    const rest = resolvePlayAlongVisualCheckpoint(
      map,
      0.7,
      PRACTICE_SCOPE.RIGHT_HAND,
    )

    expect(resolveNoteTargetPosition({
      checkpoint: rest,
      timingMap: map,
      anchors: fallbackScoreAnchors(),
      mode: 'play-along',
    })).toMatchObject({ visible: false, reason: 'not-note-checkpoint' })
  })

  it('resolves repeated written onsets by performed pass and time', () => {
    const map = parseMusicXml(F.oneRepeat())
    const firstPass = resolvePlayAlongVisualCheckpoint(
      map,
      0,
      PRACTICE_SCOPE.BOTH_HANDS,
    )
    const secondPass = resolvePlayAlongVisualCheckpoint(
      map,
      4,
      PRACTICE_SCOPE.BOTH_HANDS,
    )

    expect(firstPass).toMatchObject({ measureNumber: 1, repeatPass: 1 })
    expect(secondPass).toMatchObject({ measureNumber: 1, repeatPass: 2 })
    expect(secondPass.id).not.toBe(firstPass.id)
  })

  it('clears during gaps and after the final event, and resolves seek/loop jumps from absolute time', () => {
    const map = visualTimingMap()

    expect(resolvePlayAlongVisualCheckpoint(
      map,
      0.3,
      PRACTICE_SCOPE.BOTH_HANDS,
    )).toBeNull()
    expect(resolvePlayAlongVisualCheckpoint(
      map,
      0.95,
      PRACTICE_SCOPE.BOTH_HANDS,
    )).toBeNull()

    const forwardSeek = resolvePlayAlongVisualCheckpoint(
      map,
      0.4,
      PRACTICE_SCOPE.BOTH_HANDS,
    )
    const loopWrap = resolvePlayAlongVisualCheckpoint(
      map,
      0,
      PRACTICE_SCOPE.BOTH_HANDS,
    )

    expect(forwardSeek).toMatchObject({ expectedMidis: [64] })
    expect(loopWrap).toMatchObject({ expectedMidis: [48, 60] })
  })

  it('uses distinct visual-lane cache entries for distinct loop regions', () => {
    const map = {
      ...parseMusicXml(F.straight4()),
      contentHash: 'visual-lane-loop-cache-regression',
    }
    const first = buildVisualLaneGroups(map, {
      isValid: true,
      startTimeSeconds: 0,
      endTimeSeconds: 1,
    })
    const second = buildVisualLaneGroups(map, {
      isValid: true,
      startTimeSeconds: 2,
      endTimeSeconds: 3,
    })

    expect(first.map((group) => group.timeSeconds)).toEqual([0, 0.5])
    expect(second.map((group) => group.timeSeconds)).toEqual([2, 2.5])
  })
})

describe('practice target PDF coordinate contract', () => {
  it('falls back the whole event when one note lacks the preferred representation', () => {
    const notes = [
      {
        id: 'paired-note',
        sourceNoteheadId: 'sfnh-paired',
        measureNumber: 1,
        timeSeconds: 0,
        durationSeconds: 0.25,
        midi: 60,
        staff: 1,
        defaultX: 30,
      },
      {
        id: 'notation-only-note',
        sourceNoteheadId: 'sfnh-notation-only',
        measureNumber: 1,
        timeSeconds: 0,
        durationSeconds: 0.25,
        midi: 64,
        staff: 1,
        defaultX: 32,
      },
    ]
    const sourceVisualMap = {
      anchors: [
        {
          sourceNoteheadId: 'sfnh-paired',
          page: 1,
          measureNumber: 1,
          midi: 60,
          ...sourceGeometry('notation', 0.2, 0.3),
          alternates: [sourceGeometry('tab', 0.2, 0.7)],
        },
        {
          sourceNoteheadId: 'sfnh-notation-only',
          page: 1,
          measureNumber: 1,
          midi: 64,
          ...sourceGeometry('notation', 0.2, 0.27),
          alternates: [],
        },
      ],
    }
    const timingMap = {
      measures: [
        { number: 1, startTimeSeconds: 0, endTimeSeconds: 2, durationSeconds: 2 },
        { number: 2, startTimeSeconds: 2, endTimeSeconds: 4, durationSeconds: 2 },
      ],
      beats: [],
      notes,
    }
    const target = resolveNoteTargetPosition({
      checkpoint: {
        id: 'partial-tab-chord',
        kind: CHECKPOINT_KIND.DOUBLE_STOP,
        measureNumber: 1,
        timeSeconds: 0,
        expectedMidis: [60, 64],
        notes,
        isChord: true,
      },
      timingMap,
      anchors: fallbackScoreAnchors(),
      sourceVisualMap,
      preferredRepresentation: 'tab',
      mode: 'play-along',
    })

    expect(target.visible).toBe(true)
    expect(target.source).not.toBe(NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD)
    expect(target.coordinateSpace).toBe('pdf-analysis-normalized')
    expect(target.sourceAnchors).toEqual([])
    expect(target.highlight?.renderMode).not.toBe('individual-source-boxes')
  })

  it('keeps source-PDF note boxes unchanged before the shared CSS rotation', () => {
    const noteBoxes = [
      { x0: 0.1, y0: 0.2, x1: 0.15, y1: 0.25 },
      { x0: 0.11, y0: 0.3, x1: 0.16, y1: 0.35 },
    ]
    const target = {
      coordinateSpace: 'pdf-source-normalized',
      highlight: {
        coordinateSpace: 'pdf-source-normalized',
        renderMode: 'individual-source-boxes',
        noteBoxes,
      },
    }

    expect(resolvePracticeTargetHighlightRects(target, 90)).toEqual(noteBoxes)
    expect(mapPracticeTargetPointToOverlay(
      0.2,
      0.4,
      'pdf-source-normalized',
      270,
    )).toEqual({ x: 0.2, y: 0.4 })
  })

  it('maps explicit analysis geometry and rejects ambiguous geometry', () => {
    const analysisTarget = {
      coordinateSpace: 'pdf-analysis-normalized',
      highlight: {
        x0: 0.1,
        y0: 0.2,
        x1: 0.35,
        y1: 0.6,
        coordinateSpace: 'pdf-analysis-normalized',
      },
    }

    expect(resolvePracticeTargetHighlightRects(analysisTarget, 90)[0]).toMatchObject({
      x0: 0.2,
      y0: 0.65,
      x1: 0.6,
      y1: 0.9,
    })
    expect(resolvePracticeTargetHighlightRects({
      highlight: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 },
    }, 90)).toEqual([])
    expect(mapPracticeTargetPointToOverlay(0.2, 0.4, null, 90)).toBeNull()
    expect(mapPracticeTargetPointToOverlay(0.2, 0.4, 'unknown', 90)).toBeNull()
  })
})

describe('Play Along visual runtime wiring', () => {
  it('freezes the manual practice clock from the authoritative engine time on pause', () => {
    const order = []
    let frozenScoreTime = 1
    let manualTime = null
    const playback = {
      pause() {
        order.push('pause')
        frozenScoreTime = 7.125
      },
      getScoreTime() {
        order.push('read')
        return frozenScoreTime
      },
    }

    expect(pausePlaybackAtAuthoritativeTime(
      playback,
      (time) => {
        order.push('manual')
        manualTime = time
      },
    )).toBe(7.125)
    expect(manualTime).toBe(7.125)
    expect(order).toEqual(['pause', 'read', 'manual'])

    const session = readSrc('features', 'practice', 'usePracticeSession.js')
    const playbackHook = readSrc('features', 'playback', 'useScorePlayback.js')
    expect(session).toContain('pause: pausePlayback')
    expect(playbackHook).toContain('setCurrentTime(pausedScoreTime)')
  })

  it('samples the authoritative clock and only publishes target transitions', () => {
    const hook = readSrc('features', 'practice', 'usePlayAlongVisualCheckpoint.js')
    const session = readSrc('features', 'practice', 'usePracticeSession.js')
    const overlay = readSrc('components', 'pdf', 'ScoreFollowOverlay.jsx')

    expect(hook).toContain('getScoreTime?.()')
    expect(hook).toContain('requestAnimationFrame(sample)')
    expect(hook).toContain('previousId === nextId')
    expect(session).toContain('usePlayAlongVisualCheckpoint({')
    expect(session).toContain('getScoreTime: playback.getScoreTime')
    expect(overlay).toContain('pt?.mode !== nt?.mode')
    expect(overlay).toContain('score-follow-overlay__note-highlight--play-along')
  })

  it('wires source-map eligibility, representation choice, and semantic page follow', () => {
    const context = readSrc('context', 'PracticeSessionContext.jsx')
    const controls = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    const pageFollow = readSrc('components', 'practice', 'PracticePageFollowController.jsx')
    const pageFollowHook = readSrc('features', 'practice', 'usePracticePageFollow.js')

    expect(context).toContain('session.sourceVisualMap?.anchorCount > 0')
    expect(context.match(/preferredRepresentation:/g)).toHaveLength(2)
    expect(context).toContain('scoreFollow.guitarScoreTarget?.activeTarget')
    expect(controls).toContain('session.sourceVisualMap?.anchorCount > 0')
    expect(pageFollow).toContain('noteFollowTarget?.active')
    expect(pageFollow).toContain('(scoreFollow.enabled && scoreFollow.canFollow)')
    expect(pageFollowHook).toContain('else if (liveNoteTarget?.active)')
  })
})
