import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotationMarkings,
  buildStaffLaneNotes,
  buildStaffLaneRests,
  buildStaffLaneRhythmMarks,
  buildStaffLaneStems,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
import { PRACTICE_SCOPE } from '../src/features/practice/practiceScope.js'
import {
  buildVisualRenderingInstructions,
  compareVisualRenderingInstructions,
} from '../src/features/practice/visualRenderingInstructions.js'
import { resolveVisualLaneTransform } from '../src/features/practice/visualPracticeLane.js'
import * as F from './helpers/buildXml.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSource = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

function semanticTimingMap() {
  return {
    durationSeconds: 2,
    stavesPerSystem: 2,
    parts: [{ id: 'P1', name: 'Piano', staves: 2 }],
    measures: [
      {
        number: 1,
        startTimeSeconds: 0,
        endTimeSeconds: 2,
        startQuarters: 0,
        endQuarters: 4,
        beats: 4,
        beatType: 4,
      },
    ],
    beats: [],
    notes: [
      {
        id: 'right-quarter',
        sourceNoteheadId: 'sfnh-right-quarter',
        sourcePdfCenter: { x: 0.2, y: 0.3 },
        defaultX: 42,
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 0,
        timeSeconds: 0,
        durationQuarters: 1,
        durationSeconds: 0.5,
        midi: 60,
        writtenPitch: { step: 'C', alter: 0, octave: 4 },
        accidental: { type: 'natural' },
        noteType: 'quarter',
        stemDirection: 'up',
        dots: 1,
      },
      {
        id: 'right-half',
        sourceNoteheadId: 'sfnh-right-half',
        partId: 'P1',
        staff: 1,
        voice: 2,
        measureNumber: 1,
        quarterTime: 0,
        timeSeconds: 0,
        durationQuarters: 2,
        durationSeconds: 1,
        midi: 63,
        writtenPitch: { step: 'E', alter: -1, octave: 4 },
        accidental: { type: 'flat' },
        noteType: 'half',
        stemDirection: 'down',
      },
      {
        id: 'left-whole',
        sourceNoteheadId: 'sfnh-left-whole',
        partId: 'P1',
        staff: 2,
        voice: 1,
        measureNumber: 1,
        quarterTime: 0,
        timeSeconds: 0,
        durationQuarters: 4,
        durationSeconds: 2,
        midi: 48,
        writtenPitch: { step: 'C', alter: 0, octave: 3 },
        noteType: 'whole',
      },
      {
        id: 'nearby-eighth',
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 0.16,
        timeSeconds: 0.08,
        durationQuarters: 0.5,
        durationSeconds: 0.25,
        midi: 62,
        writtenPitch: { step: 'D', alter: 0, octave: 4 },
        noteType: 'eighth',
      },
      {
        id: 'tie-start',
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 1,
        timeSeconds: 0.5,
        durationQuarters: 0.5,
        durationSeconds: 0.25,
        midi: 67,
        writtenPitch: { step: 'G', alter: 0, octave: 4 },
        noteType: 'eighth',
        tieStart: true,
        beams: [{ number: 1, value: 'begin' }],
      },
      {
        id: 'tie-stop',
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 1.5,
        timeSeconds: 0.75,
        durationQuarters: 0.5,
        durationSeconds: 0.25,
        midi: 67,
        writtenPitch: { step: 'G', alter: 0, octave: 4 },
        noteType: 'eighth',
        tieStop: true,
        suppressPlaybackAttack: true,
        beams: [{ number: 1, value: 'end' }],
      },
      {
        id: 'right-rest',
        partId: 'P1',
        staff: 1,
        voice: 1,
        measureNumber: 1,
        quarterTime: 2,
        timeSeconds: 1,
        durationQuarters: 1,
        durationSeconds: 0.5,
        isRest: true,
        midi: null,
        noteType: 'quarter',
        dots: 1,
      },
      {
        id: 'left-rest',
        partId: 'P1',
        staff: 2,
        voice: 2,
        measureNumber: 1,
        quarterTime: 3,
        timeSeconds: 1.5,
        durationQuarters: 2,
        durationSeconds: 1,
        isRest: true,
        midi: null,
        noteType: 'half',
      },
    ],
  }
}

function geometry(representation, x, y) {
  return {
    representation,
    sourceCenter: { x, y, coordinateSpace: 'pdf-source-normalized' },
    sourceBBox: {
      x0: x - 0.01,
      y0: y - 0.01,
      x1: x + 0.01,
      y1: y + 0.01,
      coordinateSpace: 'pdf-source-normalized',
    },
    confidence: 0.96,
  }
}

function sourceVisualMap({ wrongMidi = false } = {}) {
  return {
    anchors: [
      {
        sourceNoteheadId: 'sfnh-right-quarter',
        sourceEventId: 'sfve-p1-m1-e0',
        sourceEventIds: ['sfve-p1-m1-e0'],
        page: 1,
        systemIndex: 0,
        staffIndex: 0,
        measureIndex: 0,
        measureNumber: 1,
        midi: wrongMidi ? 61 : 60,
        voice: 1,
        ...geometry('notation', 0.2, 0.3),
        alternates: [geometry('tab', 0.2, 0.7)],
      },
      {
        sourceNoteheadId: 'sfnh-right-half',
        sourceEventId: 'sfve-p1-m1-e0',
        sourceEventIds: ['sfve-p1-m1-e0'],
        page: 1,
        systemIndex: 0,
        staffIndex: 0,
        measureIndex: 0,
        measureNumber: 1,
        midi: 63,
        voice: 2,
        ...geometry('notation', 0.2, 0.27),
        alternates: [],
      },
      {
        sourceNoteheadId: 'sfnh-left-whole',
        sourceEventId: 'sfve-p1-m1-e0',
        sourceEventIds: ['sfve-p1-m1-e0'],
        page: 1,
        systemIndex: 0,
        staffIndex: 1,
        measureIndex: 0,
        measureNumber: 1,
        midi: 48,
        voice: 1,
        ...geometry('notation', 0.2, 0.5),
        alternates: [],
      },
    ],
  }
}

describe('Visual mode architecture correction', () => {
  it('uses one reconstructed renderer for PDF-backed and MusicXML-only pieces', () => {
    const view = readSource('components', 'practice', 'VisualPracticeView.jsx')
    const practice = readSource('components', 'practice', 'PracticeView.jsx')

    expect(view).toContain('buildVisualRenderingInstructions')
    expect(view).toContain('<StaffVisualLane')
    expect(view).toContain('<TabVisualLane')
    expect(view).not.toContain('SourcePdfVisualLane')
    expect(view).not.toContain('react-pdf')
    expect(practice).toContain('<VisualPracticeView timingSourceKind={timingSourceKind} />')
  })

  it('joins sfnh/sfve provenance without leaking PDF layout geometry', () => {
    const instructions = buildVisualRenderingInstructions(
      semanticTimingMap(),
      sourceVisualMap(),
      { preferredRepresentation: 'tab' },
    )
    const first = instructions[0]
    const quarter = first.notes.find((note) => note.id === 'right-quarter')
    const half = first.notes.find((note) => note.id === 'right-half')

    expect(first.expectedMidis).toEqual([48, 60, 63])
    expect(quarter.sourceOwnership).toMatchObject({
      sourceNoteheadId: 'sfnh-right-quarter',
      sourceEventId: 'sfve-p1-m1-e0',
      selectedRepresentation: 'tab',
      provenanceStatus: 'matched',
    })
    expect(half.sourceOwnership.selectedRepresentation).toBe('notation')
    expect(quarter).not.toHaveProperty('sourcePdfCenter')
    expect(quarter).not.toHaveProperty('defaultX')
    expect(JSON.stringify(instructions)).not.toContain('sourceBBox')
    expect(JSON.stringify(instructions)).not.toContain('sourceCenter')
  })

  it('fails the comparison harness on source-ownership disagreement', () => {
    const timingMap = semanticTimingMap()
    const instructions = buildVisualRenderingInstructions(
      timingMap,
      sourceVisualMap({ wrongMidi: true }),
    )
    const comparison = compareVisualRenderingInstructions(timingMap, instructions)

    expect(comparison.passed).toBe(false)
    expect(comparison.mismatches).toContainEqual({ kind: 'source-provenance', index: 0 })
  })

  it('preserves exact onsets, chords, voices, hands, rests, ties, and printed values', () => {
    const timingMap = semanticTimingMap()
    const instructions = buildVisualRenderingInstructions(timingMap, sourceVisualMap())
    const comparison = compareVisualRenderingInstructions(timingMap, instructions)

    expect(comparison).toMatchObject({
      passed: true,
      expectedEventCount: 6,
      actualEventCount: 6,
      mismatchCount: 0,
    })
    expect(instructions[0].expectedMidis).toEqual([48, 60, 63])
    expect(instructions[1]).toMatchObject({ timeSeconds: 0.08, expectedMidis: [62] })
    expect(instructions.filter((event) => event.isRest)).toHaveLength(2)
    expect(instructions.flatMap((event) => event.notes).map((note) => note.voice))
      .toEqual(expect.arrayContaining([1, 2]))

    const right = buildVisualRenderingInstructions(timingMap, null, {
      practiceScope: PRACTICE_SCOPE.RIGHT_HAND,
    })
    const left = buildVisualRenderingInstructions(timingMap, null, {
      practiceScope: PRACTICE_SCOPE.LEFT_HAND,
    })
    expect(right.flatMap((event) => event.notes).some((note) => note.staff === 2)).toBe(false)
    expect(right.flatMap((event) => event.rests).some((rest) => rest.staff === 2)).toBe(false)
    expect(left.flatMap((event) => event.notes).every((note) => note.staff === 2)).toBe(true)
  })

  it('emits engraving instructions for noteheads, stems, beams, dots, rests, and ties', () => {
    const instructions = buildVisualRenderingInstructions(semanticTimingMap())
      .map((group) => ({ ...group, status: 'upcoming' }))
    const geometryModel = buildStaffGeometry(detectStaves(instructions))
    const notes = buildStaffLaneNotes(instructions, geometryModel)
    const stems = buildStaffLaneStems(instructions, geometryModel, { notes })
    const rhythm = buildStaffLaneRhythmMarks(notes, stems)
    const rests = buildStaffLaneRests(instructions, geometryModel)
    const markings = buildStaffLaneNotationMarkings(instructions, geometryModel, { notes })

    const quarter = notes.find((note) => note.noteType === 'quarter')
    const half = notes.find((note) => note.noteType === 'half')
    const whole = notes.find((note) => note.noteType === 'whole')
    expect(quarter).toMatchObject({ hollow: false, stemless: false, accidentalType: 'natural' })
    expect(half).toMatchObject({ hollow: true, stemless: false, accidentalType: 'flat' })
    expect(whole).toMatchObject({ hollow: true, stemless: true })
    expect(stems.some((stem) => stem.groupId === whole.groupId && stem.staffKind === whole.staffKind))
      .toBe(false)
    expect(rhythm.flags.length).toBeGreaterThan(0)
    expect(rhythm.beams).toHaveLength(1)
    expect(rhythm.dots).toHaveLength(1)
    expect(rests.map((rest) => rest.noteType)).toEqual(['quarter', 'half'])
    expect(rests.every((rest) => rest.glyph.length > 0)).toBe(true)
    expect(markings.spanMarkings.some((marking) => marking.kind === 'tie')).toBe(true)
  })

  it('passes representative permanent piano and guitar/TAB fixtures', () => {
    const fixturePaths = [
      'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml',
      'benchmarks/omr-fixtures/guitar-tab-sparse-vector/guitar-tab-sparse-vector.musicxml',
    ]
    const results = fixturePaths.map((relativePath) => {
      const timingMap = parseMusicXml(readFileSync(join(root, relativePath), 'utf8'), relativePath)
      const instructions = buildVisualRenderingInstructions(timingMap)
      return { timingMap, instructions, comparison: compareVisualRenderingInstructions(timingMap, instructions) }
    })

    expect(results.every((result) => result.comparison.passed)).toBe(true)
    expect(results[0].instructions.some((event) => event.isChord)).toBe(true)
    expect(new Set(results[0].instructions.flatMap((event) => event.notes).map((note) => note.voice)))
      .toEqual(new Set([1, 2]))
    expect(results[1].instructions.flatMap((event) => event.notes).some(
      (note) => note.string != null && note.fret != null,
    )).toBe(true)
    expect(results[1].instructions.some((event) => event.repeatPass === 2)).toBe(true)
  })

  it('keeps repeat passes and loop/seek cursor motion absolute and deterministic', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const instructions = buildVisualRenderingInstructions(timingMap)
    expect(compareVisualRenderingInstructions(timingMap, instructions).passed).toBe(true)
    expect(instructions.some((event) => event.repeatPass === 2)).toBe(true)

    const loopRegion = { isValid: true, startTimeSeconds: 4, endTimeSeconds: 6 }
    const loopInstructions = buildVisualRenderingInstructions(timingMap, null, { loopRegion })
    expect(loopInstructions.every(
      (event) => event.timeSeconds >= 4 && event.timeSeconds < 6,
    )).toBe(true)
    expect(compareVisualRenderingInstructions(timingMap, loopInstructions, { loopRegion }).passed)
      .toBe(true)

    const atSeek = resolveVisualLaneTransform({ frameTime: 5, viewWidth: 1000, durationSeconds: 8 })
    const afterLoopWrap = resolveVisualLaneTransform({ frameTime: 1, viewWidth: 1000, durationSeconds: 8 })
    expect(resolveVisualLaneTransform({ frameTime: 5, viewWidth: 1000, durationSeconds: 8 }))
      .toEqual(atSeek)
    expect(afterLoopWrap.scrollX).not.toBe(atSeek.scrollX)
  })

  it('reuses the score-follow bar style and leaves Play Along source boxes disabled', () => {
    const scoreOverlay = readSource('components', 'pdf', 'ScoreFollowOverlay.jsx')
    const staffLane = readSource('components', 'practice', 'StaffVisualLane.jsx')
    const tabLane = readSource('components', 'practice', 'TabVisualLane.jsx')
    const context = readSource('context', 'PracticeSessionContext.jsx')
    const session = readSource('features', 'practice', 'usePracticeSession.js')

    expect(scoreOverlay).toContain('score-follow-bar__line')
    expect(staffLane).toContain('score-follow-bar__line')
    expect(tabLane).toContain('score-follow-bar__line')
    expect(readSource('components', 'practice', 'VisualPracticeView.jsx')).toContain('getScoreTime')
    // Play Along shares the score overlay language: a real timeline target
    // (steady highlight, no pulse) instead of null. The note-guide lane
    // keeps owning rolling feedback; the score shows the event state.
    expect(context).toContain('playAlongNoteTarget: timelineHighlightActive ? timelineScoreTarget : null')
    expect(context).toContain('showOnPage: Boolean(')
    expect(context).toContain('mode: isPlayAlong ? \'play-along\' : \'preview\'')
    expect(session).toContain('seekToPracticeTimeWithWfy(seconds, { sync: false })')
  })
})
