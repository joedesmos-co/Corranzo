import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as F from './helpers/buildXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  evaluatePlayAlongNoteInput,
  createPlayAlongFeedbackState,
  updatePlayAlongMisses,
  resolvePlayAlongTargetIndex,
} from '../src/features/practice/playAlongLaneFeedback.js'
import {
  VISUAL_LANE_OUTCOME,
  resolveLaneNoteClass,
} from '../src/features/practice/visualLaneFeedback.js'
import {
  resolveWfyTravelDurationMs,
  resolveWfyVisualTravelFrameTime,
  startWfyVisualTravel,
  createWfyVisualTravelState,
  isWfyEarlyInputWindow,
} from '../src/features/practice/wfyVisualTravel.js'
import { buildTabLaneNotes, buildTabChordShapeOverlays } from '../src/features/practice/tabLaneLayout.js'
import { buildTabGeometry } from '../src/features/practice/tabLaneLayout.js'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('Play Along lane feedback', () => {
  it('marks correct and wrong notes without pausing playback', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)
    const state = createPlayAlongFeedbackState()
    const first = groups[0]

    const correct = evaluatePlayAlongNoteInput(state, groups, first.timeSeconds, 60, {})
    expect(correct).toBe(VISUAL_LANE_OUTCOME.CORRECT)
    expect(state.outcomes.get(first.id)).toBe(VISUAL_LANE_OUTCOME.CORRECT)

    const wrong = evaluatePlayAlongNoteInput(state, groups, first.timeSeconds, 61, {})
    expect(wrong).toBeNull()

    const state2 = createPlayAlongFeedbackState()
    evaluatePlayAlongNoteInput(state2, groups, first.timeSeconds, 61, {})
    expect(state2.outcomes.get(first.id)).toBe(VISUAL_LANE_OUTCOME.WRONG)
  })

  it('marks missed notes after the grace window passes', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)
    const state = createPlayAlongFeedbackState()
    const first = groups[0]

    updatePlayAlongMisses(state, groups, first.timeSeconds + 0.5)
    expect(state.outcomes.get(first.id)).toBe(VISUAL_LANE_OUTCOME.MISSED)
  })

  it('accepts slightly early Play Along input before the onset', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)
    const state = createPlayAlongFeedbackState()
    const first = groups[0]
    const earlyTime = first.timeSeconds - 0.1

    expect(resolvePlayAlongTargetIndex(groups, earlyTime)).toBe(0)
    const outcome = evaluatePlayAlongNoteInput(state, groups, earlyTime, 60, {})
    expect(outcome).toBe(VISUAL_LANE_OUTCOME.CORRECT)
  })

  it('wires Play Along feedback through the practice session without pausing', () => {
    const session = readSrc('features', 'practice', 'usePracticeSession.js')
    const view = readSrc('components', 'practice', 'VisualPracticeView.jsx')

    expect(session).toContain('usePlayAlongLaneFeedback')
    expect(session).toContain('playAlongInputActive')
    expect(session).toContain('laneOutcomesByGroupId')
    expect(session).toMatch(/playback\.isPlaying/)
    expect(view).toContain('applyLaneOutcomes')
    expect(view).toContain('legend-item--correct')
    expect(view).toContain('legend-item--wrong')
  })
})

describe('Wait For You visual travel', () => {
  it('travels between checkpoints at musical tempo instead of a fixed teleport', () => {
    expect(resolveWfyTravelDurationMs(1, 1.5)).toBe(500)
    expect(resolveWfyTravelDurationMs(1, 1)).toBeGreaterThanOrEqual(80)
  })

  it('eases through intermediate positions during WFY travel', () => {
    const state = createWfyVisualTravelState()
    startWfyVisualTravel(state, { fromTime: 0, toTime: 1, checkpointId: 'a', now: 1000 })
    const midway = resolveWfyVisualTravelFrameTime(state, 1500)
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(1)
    const end = resolveWfyVisualTravelFrameTime(state, 2000)
    expect(end).toBe(1)
  })

  it('accepts slightly early WFY input before the bar reaches the target', () => {
    expect(isWfyEarlyInputWindow(1.9, 2)).toBe(true)
    expect(isWfyEarlyInputWindow(1.7, 2)).toBe(false)
  })

  it('uses tempo-based WFY travel in the visual practice view', () => {
    const view = readSrc('components', 'practice', 'VisualPracticeView.jsx')
    expect(view).toContain('useWfyVisualFrameTime')
    expect(view).toContain('startWfyVisualTravel')
    expect(view).toContain('resolveWfyVisualTravelFrameTime')
  })
})

describe('guitar sustain rendering', () => {
  it('renders duration width for tab notes and chord shapes', () => {
    const xml = F.scoreWrap(
      `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}` +
        `<note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type>` +
        `<notations><technical><string>1</string><fret>0</fret></technical></notations></note>` +
        `</measure></part>`,
    )
    const timingMap = parseMusicXml(xml, 'guitar-half.musicxml')
    const groups = buildVisualLaneGroups(timingMap, null, { instrumentId: INSTRUMENT_IDS.GUITAR })
    const geometry = buildTabGeometry({ count: 6, tuning: [64, 59, 55, 50, 45, 40] })
    const notes = buildTabLaneNotes(groups, geometry)
    expect(notes.length).toBeGreaterThan(0)
    expect(notes[0].sustainWidth).toBeGreaterThan(20)

    const tabLane = readSrc('components', 'practice', 'TabVisualLane.jsx')
    expect(tabLane).toContain('tab-lane__sustain')
  })

  it('does not draw rectangular chord group boxes in the tab lane', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1"><measure number="1">${F.attributes()}${F.soundTempo(120)}` +
          F.note('E', 4, 2, '<notations><technical><string>1</string><fret>0</fret></technical></notations>') +
          F.note('G', 4, 2, '<chord/><notations><technical><string>2</string><fret>0</fret></technical></notations>') +
          `</measure></part>`,
      ),
    )
    const groups = buildVisualLaneGroups(timingMap, null, { instrumentId: INSTRUMENT_IDS.GUITAR })
    const geometry = buildTabGeometry({ count: 6, tuning: [64, 59, 55, 50, 45, 40] })
    const notes = buildTabLaneNotes(
      groups.map((group) => ({ ...group, status: 'current' })),
      geometry,
    )
    const overlays = buildTabChordShapeOverlays(notes)
    expect(overlays).toEqual([])
    expect(notes.every((note) => note.sustainWidth < 100)).toBe(true)
  })
})

describe('lane outcome styling', () => {
  it('prefers match outcomes over temporal status for CSS classes', () => {
    expect(resolveLaneNoteClass('past', VISUAL_LANE_OUTCOME.CORRECT)).toBe('correct')
    expect(resolveLaneNoteClass('current', VISUAL_LANE_OUTCOME.WRONG)).toBe('wrong')
    expect(resolveLaneNoteClass('upcoming', VISUAL_LANE_OUTCOME.NEUTRAL)).toBe('upcoming')
  })
})
