/**
 * Guided Visual Practice mode (MVP) tests.
 *
 * Covers the acceptance list for the feature:
 *  – lane groups come from the existing timing map / WFY note checkpoints
 *  – chords render as one stacked group
 *  – current target advances with time and follows live WFY checkpoints
 *  – window slicing tags past/current/upcoming
 *  – pitch → lane/keyboard mapping
 *  – Score | Visual toggle exists and the Score path is unchanged
 *  – no-score empty state still works
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import {
  VISUAL_LANE_DEFAULTS,
  VISUAL_GROUP_STATUS,
  WFY_VISUAL_MOVE_MS,
  buildBarlineTimes,
  buildKeyboardKeys,
  buildVisualLaneGroups,
  computeKeyboardRange,
  computeLanePitchRange,
  findVisualTargetIndex,
  isBlackKey,
  laneYForMidi,
  resolveWfyDisplayFrameTime,
  resolveVisualFrameTime,
  resolveVisualLaneTransform,
  resolveVisualPlayheadX,
  resolveVisualTarget,
  selectVisualWindow,
} from '../src/features/practice/visualPracticeLane.js'
import {
  PRACTICE_VIEW_MODE,
  PRACTICE_VIEW_MODE_LABELS,
  loadPracticeViewMode,
  normalizePracticeViewMode,
  savePracticeViewMode,
} from '../src/features/practice/practiceViewMode.js'
import * as F from './helpers/buildXml.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

/** 2 measures @120: m1 = C4 D4 E4 F4, m2 opens with a C4+E4+G4 chord. */
function chordScore() {
  const xml =
    `<measure number="1">${F.attributes()}${F.soundTempo(120)}${F.fourQuarters()}</measure>` +
    `<measure number="2">` +
    F.note('C', 4, 1) +
    F.note('E', 4, 1, '<chord/>') +
    F.note('G', 4, 1, '<chord/>') +
    F.note('A', 4, 1) +
    F.note('B', 4, 1) +
    F.note('C', 5, 1) +
    `</measure>`
  return F.scoreWrap(`<part id="P1">${xml}</part>`)
}

describe('visual practice lane', () => {
  it('builds lane groups from the score timing map in time order', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)

    expect(groups.length).toBe(16) // 4 measures × 4 quarters
    expect(groups[0].timeSeconds).toBe(0)
    expect(groups[0].notes[0].label).toBe('C4')
    for (let i = 1; i < groups.length; i += 1) {
      expect(groups[i].timeSeconds).toBeGreaterThan(groups[i - 1].timeSeconds)
    }
    expect(groups.every((group) => group.notes.length > 0)).toBe(true)
    expect(groups.every((group) => Number.isFinite(group.measureNumber))).toBe(true)
  })

  it('reuses Wait For You note checkpoints (identical ids, times, midis)', () => {
    const timingMap = parseMusicXml(F.oneRepeat())
    const groups = buildVisualLaneGroups(timingMap)
    const checkpoints = buildNoteCheckpoints(timingMap)

    expect(groups.length).toBe(checkpoints.length)
    groups.forEach((group, i) => {
      expect(group.id).toBe(checkpoints[i].id)
      expect(group.timeSeconds).toBe(checkpoints[i].timeSeconds)
      expect(group.midis).toEqual(checkpoints[i].expectedMidis)
    })
  })

  it('renders a chord as one group with stacked notes, high pitch first', () => {
    const timingMap = parseMusicXml(chordScore())
    const groups = buildVisualLaneGroups(timingMap)

    const chordGroup = groups.find((group) => group.isChord)
    expect(chordGroup).toBeTruthy()
    expect(chordGroup.measureNumber).toBe(2)
    expect(chordGroup.notes.length).toBe(3)
    expect(chordGroup.notes.map((note) => note.label)).toEqual(['G4', 'E4', 'C4'])
    expect(chordGroup.midis).toEqual(expect.arrayContaining([60, 64, 67]))

    // Stacked = one group at one time, distinct vertical positions.
    const range = computeLanePitchRange(groups)
    const ys = chordGroup.notes.map((note) => laneYForMidi(note.midi, range))
    expect(new Set(ys).size).toBe(3)
    expect(ys[0]).toBeLessThan(ys[2]) // higher pitch sits higher in the lane
  })

  it('advances the current target as time moves', () => {
    const timingMap = parseMusicXml(F.straight4()) // 4/4 @120 → quarter = 0.5s
    const groups = buildVisualLaneGroups(timingMap)

    expect(findVisualTargetIndex(groups, 0)).toBe(0)
    expect(findVisualTargetIndex(groups, 0.5)).toBe(1) // grace window holds the onset
    expect(findVisualTargetIndex(groups, 0.7)).toBe(2)
    expect(findVisualTargetIndex(groups, 999)).toBe(groups.length - 1)
    expect(findVisualTargetIndex([], 0)).toBe(-1)

    const early = resolveVisualTarget(groups, { currentTime: 0 })
    const later = resolveVisualTarget(groups, { currentTime: 2.05 })
    expect(early.index).toBe(0)
    expect(later.index).toBeGreaterThan(early.index)
    expect(later.group.timeSeconds).toBeGreaterThanOrEqual(2)
  })

  it('prefers the live Wait For You checkpoint as target', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)
    const checkpoints = buildNoteCheckpoints(timingMap)

    const target = resolveVisualTarget(groups, {
      currentTime: 0,
      waitForYouCheckpoint: checkpoints[5],
    })
    expect(target.index).toBe(5)
    expect(target.group.id).toBe(checkpoints[5].id)

    // Unknown id (e.g. beat-mode checkpoint) falls back to its time.
    const fallback = resolveVisualTarget(groups, {
      currentTime: 0,
      waitForYouCheckpoint: { id: 'beat-m2-b1', timeSeconds: checkpoints[5].timeSeconds },
    })
    expect(fallback.index).toBe(5)
  })

  it('pins the visual lane clock to the waiting Wait For You checkpoint', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)
    const checkpoints = buildNoteCheckpoints(timingMap)
    const liveCheckpoint = checkpoints[2]

    const visualTime = resolveVisualFrameTime({
      currentTime: checkpoints[4].timeSeconds,
      waitForYouWaiting: true,
      waitForYouCheckpoint: liveCheckpoint,
    })
    const target = resolveVisualTarget(groups, {
      currentTime: checkpoints[4].timeSeconds,
      waitForYouCheckpoint: liveCheckpoint,
    })
    const visible = selectVisualWindow(groups, visualTime, target.index, {
      lookBehindSeconds: 0.25,
      lookAheadSeconds: 0.75,
    })

    expect(visualTime).toBe(liveCheckpoint.timeSeconds)
    expect(target.group.id).toBe(liveCheckpoint.id)
    expect(visible.find((group) => group.id === liveCheckpoint.id)?.status).toBe(
      VISUAL_GROUP_STATUS.CURRENT,
    )
    expect(
      resolveVisualFrameTime({
        currentTime: checkpoints[4].timeSeconds,
        waitForYouWaiting: false,
        waitForYouCheckpoint: liveCheckpoint,
      }),
    ).toBe(checkpoints[4].timeSeconds)
  })

  it('keeps the waiting WFY target directly under the visual playhead', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)
    const checkpoints = buildNoteCheckpoints(timingMap)
    const liveCheckpoint = checkpoints[6]

    const visualTime = resolveVisualFrameTime({
      currentTime: checkpoints[1].timeSeconds,
      waitForYouWaiting: true,
      waitForYouCheckpoint: liveCheckpoint,
    })
    const target = resolveVisualTarget(groups, {
      currentTime: checkpoints[1].timeSeconds,
      waitForYouCheckpoint: liveCheckpoint,
    })
    const transform = resolveVisualLaneTransform({
      frameTime: visualTime,
      viewWidth: 1000,
      durationSeconds: timingMap.durationSeconds,
    })
    const targetScreenX =
      target.group.timeSeconds * VISUAL_LANE_DEFAULTS.pixelsPerSecond + transform.scrollX

    expect(target.group.id).toBe(liveCheckpoint.id)
    expect(visualTime).toBe(liveCheckpoint.timeSeconds)
    expect(targetScreenX).toBeCloseTo(transform.playheadX, 6)
  })

  it('eases WFY visual movement through intermediate positions instead of teleporting', () => {
    const fromTime = 0.5
    const toTime = 3
    const start = resolveWfyDisplayFrameTime({ fromTime, toTime, elapsedMs: 0 })
    const midway = resolveWfyDisplayFrameTime({
      fromTime,
      toTime,
      elapsedMs: WFY_VISUAL_MOVE_MS / 2,
    })
    const end = resolveWfyDisplayFrameTime({
      fromTime,
      toTime,
      elapsedMs: WFY_VISUAL_MOVE_MS,
    })

    expect(start).toBe(fromTime)
    expect(midway).toBeGreaterThan(fromTime)
    expect(midway).toBeLessThan(toTime)
    expect(end).toBe(toTime)

    const midTransform = resolveVisualLaneTransform({
      frameTime: midway,
      viewWidth: 1000,
      durationSeconds: 8,
    })
    const endTransform = resolveVisualLaneTransform({
      frameTime: end,
      viewWidth: 1000,
      durationSeconds: 8,
    })
    const midTargetScreenX =
      toTime * VISUAL_LANE_DEFAULTS.pixelsPerSecond + midTransform.scrollX
    const endTargetScreenX =
      toTime * VISUAL_LANE_DEFAULTS.pixelsPerSecond + endTransform.scrollX

    expect(midTargetScreenX).toBeGreaterThan(midTransform.playheadX)
    expect(endTargetScreenX).toBeCloseTo(endTransform.playheadX, 6)
  })

  it('moves the visual playhead across the lane using piece or loop progress', () => {
    expect(resolveVisualPlayheadX({ frameTime: 0, viewWidth: 1000, durationSeconds: 10 }))
      .toBeCloseTo(220)
    expect(resolveVisualPlayheadX({ frameTime: 5, viewWidth: 1000, durationSeconds: 10 }))
      .toBeCloseTo(520)
    expect(resolveVisualPlayheadX({ frameTime: 10, viewWidth: 1000, durationSeconds: 10 }))
      .toBeCloseTo(820)

    expect(
      resolveVisualPlayheadX({
        frameTime: 15,
        viewWidth: 1000,
        durationSeconds: 60,
        loopRegion: { startTimeSeconds: 10, endTimeSeconds: 20 },
      }),
    ).toBeCloseTo(520)

    expect(resolveVisualPlayheadX({ frameTime: 5, viewWidth: 1000 })).toBeCloseTo(220)

    const transform = resolveVisualLaneTransform({
      frameTime: 5,
      viewWidth: 1000,
      durationSeconds: 10,
    })
    expect(transform.playheadX).toBeCloseTo(520)
    expect(transform.scrollX).toBeCloseTo(520 - 5 * VISUAL_LANE_DEFAULTS.pixelsPerSecond)
  })

  it('windows the lane and tags past/current/upcoming', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)
    const currentTime = 2.0
    const targetIndex = findVisualTargetIndex(groups, currentTime)

    const visible = selectVisualWindow(groups, currentTime, targetIndex, {
      lookBehindSeconds: 1,
      lookAheadSeconds: 2,
    })

    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(groups.length)
    const current = visible.filter((group) => group.status === VISUAL_GROUP_STATUS.CURRENT)
    expect(current.length).toBe(1)
    expect(current[0].id).toBe(groups[targetIndex].id)
    expect(visible.some((group) => group.status === VISUAL_GROUP_STATUS.PAST)).toBe(true)
    expect(visible.some((group) => group.status === VISUAL_GROUP_STATUS.UPCOMING)).toBe(true)
    expect(selectVisualWindow([], 0, -1)).toEqual([])
  })

  it('maps pitch to lane position and keyboard keys', () => {
    const timingMap = parseMusicXml(F.straight4())
    const groups = buildVisualLaneGroups(timingMap)
    const range = computeLanePitchRange(groups)

    expect(range.minMidi).toBeLessThan(60)
    expect(range.maxMidi).toBeGreaterThan(65)
    expect(laneYForMidi(range.maxMidi, range)).toBe(0)
    expect(laneYForMidi(range.minMidi, range)).toBe(1)
    expect(computeLanePitchRange([])).toEqual({ minMidi: 48, maxMidi: 72 })

    expect(isBlackKey(61)).toBe(true) // C#4
    expect(isBlackKey(60)).toBe(false) // C4

    const keys = buildKeyboardKeys(range, [60, 64])
    expect(keys[0].midi % 12).toBe(0) // starts on a C
    expect(keys[keys.length - 1].midi % 12).toBe(11) // ends on a B
    const targets = keys.filter((key) => key.isTarget)
    expect(targets.map((key) => key.midi)).toEqual([60, 64])
    expect(targets.every((key) => key.label)).toBe(true)
    const c4 = keys.find((key) => key.midi === 60)
    expect(c4.label).toBe('C4')
  })

  it('caps the keyboard window to a few octaves around the median pitch', () => {
    // Median around C4-ish with rare extremes far out.
    const groups = []
    for (let i = 0; i < 300; i += 1) {
      groups.push({ timeSeconds: i * 0.2, notes: [{ midi: 55 + (i % 18) }] })
    }
    groups.push({ timeSeconds: 61, notes: [{ midi: 23 }] })
    groups.push({ timeSeconds: 62, notes: [{ midi: 99 }] })

    const range = computeKeyboardRange(groups, { maxOctaves: 4 })
    const octaves = (range.maxMidi - range.minMidi + 1) / 12
    expect(octaves).toBeLessThanOrEqual(4)
    expect(range.minMidi % 12).toBe(0) // C-aligned
    expect((range.maxMidi + 1) % 12).toBe(0) // ends on a B
    // Covers the common register (55..72) even if extremes are cut.
    expect(range.minMidi).toBeLessThanOrEqual(55)
    expect(range.maxMidi).toBeGreaterThanOrEqual(72)

    // Small pieces still get a sensible minimum window.
    const tiny = [{ timeSeconds: 0, notes: [{ midi: 60 }, { midi: 64 }] }]
    const tinyRange = computeKeyboardRange(tiny)
    expect((tinyRange.maxMidi - tinyRange.minMidi + 1) / 12).toBeGreaterThanOrEqual(2)
    expect(computeKeyboardRange([])).toEqual({ minMidi: 48, maxMidi: 83 })
  })

  it('builds repeat-aware barline times from the performed timeline', () => {
    const timingMap = parseMusicXml(F.oneRepeat()) // performed 1,2,1,2,3,4
    const barlines = buildBarlineTimes(timingMap)
    expect(barlines.length).toBe(6) // six performed measure windows
    for (let i = 1; i < barlines.length; i += 1) {
      expect(barlines[i]).toBeGreaterThan(barlines[i - 1])
    }
    expect(barlines[0]).toBe(0)

    const straight = buildBarlineTimes(parseMusicXml(F.straight4()))
    expect(straight.length).toBe(4)
  })

  it('keeps a few extreme outlier pitches from compressing the lane', () => {
    // 200 notes around middle C plus 2 extreme outliers.
    const groups = []
    for (let i = 0; i < 200; i += 1) {
      groups.push({ timeSeconds: i * 0.25, notes: [{ midi: 55 + (i % 14) }] })
    }
    groups.push({ timeSeconds: 50.25, notes: [{ midi: 21 }] })
    groups.push({ timeSeconds: 50.5, notes: [{ midi: 105 }] })

    const range = computeLanePitchRange(groups)
    expect(range.minMidi).toBeGreaterThan(21 + 10) // outlier low excluded
    expect(range.maxMidi).toBeLessThan(105 - 10) // outlier high excluded

    // Outliers clamp to the lane edges rather than escaping it.
    expect(laneYForMidi(21, range)).toBe(1)
    expect(laneYForMidi(105, range)).toBe(0)
  })
})

describe('practice view mode', () => {
  it('exposes Score and Visual modes with labels', () => {
    expect(PRACTICE_VIEW_MODE.SCORE).toBe('score')
    expect(PRACTICE_VIEW_MODE.VISUAL).toBe('visual')
    expect(PRACTICE_VIEW_MODE_LABELS[PRACTICE_VIEW_MODE.SCORE]).toBe('Score')
    expect(PRACTICE_VIEW_MODE_LABELS[PRACTICE_VIEW_MODE.VISUAL]).toBe('Visual')
  })

  it('normalizes unknown values to Score and survives missing storage', () => {
    expect(normalizePracticeViewMode('visual')).toBe('visual')
    expect(normalizePracticeViewMode('garbage')).toBe('score')
    expect(normalizePracticeViewMode(null)).toBe('score')
    // node env has no localStorage — must fall back, not throw.
    expect(loadPracticeViewMode()).toBe('score')
    expect(savePracticeViewMode('visual')).toBe(false)
  })

  it('round-trips through storage when available', () => {
    const store = new Map()
    globalThis.localStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
    }
    try {
      expect(savePracticeViewMode(PRACTICE_VIEW_MODE.VISUAL)).toBe(true)
      expect(loadPracticeViewMode()).toBe(PRACTICE_VIEW_MODE.VISUAL)
      expect(savePracticeViewMode('nonsense')).toBe(true)
      expect(loadPracticeViewMode()).toBe(PRACTICE_VIEW_MODE.SCORE)
    } finally {
      delete globalThis.localStorage
    }
  })
})

describe('practice view integration', () => {
  it('PracticeView toggles between Score and Visual while keeping the score path intact', () => {
    const src = readSrc('components', 'practice', 'PracticeView.jsx')

    // Toggle exists and drives a conditional render.
    expect(src).toContain('PracticeViewSwitchBar')
    expect(src).toContain('practice-view-switch')
    expect(src).toContain('viewMode === PRACTICE_VIEW_MODE.VISUAL')
    expect(src).toContain('<VisualPracticeView timingSourceKind={timingSourceKind} />')
    expect(src).toContain('savePracticeViewMode(mode)')

    // Score path unchanged: PdfViewer + score follow + page follow all remain.
    expect(src).toContain('variant="practice"')
    expect(src).toContain('<ScoreFollowSetupStatus setupStatus={scoreFollow.setupStatus} />')
    expect(src).toContain('PracticePageFollowController')
    expect(src).toContain('className="practice-workspace__score"')

    // No-score empty state untouched.
    expect(src).toContain('practice-workspace__empty')
    expect(src).toContain('Choose a piece first')
  })

  it('VisualPracticeView consumes the shared note schedule and session state', () => {
    const src = readSrc('components', 'practice', 'VisualPracticeView.jsx')

    expect(src).toContain('buildVisualLaneGroups(timingMap, loopRegion, { practiceScope: visual.practiceScope })')
    expect(src).toContain('usePracticeVisualSession')
    expect(src).toContain('visual.timingMap')
    expect(src).toContain('visual.loopRegion')
    expect(src).toContain('visual.practiceScope')
    expect(src).toContain('usePracticeTick')
    expect(src).toContain('visual.wfyCheckpoint')
    expect(src).toContain('WFY_STATUS.WAITING')

    // Staff lane + beginner affordances: target callout, keyboard strip.
    expect(src).toContain('StaffVisualLane')
    expect(src).toContain('detectStaves')
    expect(src).toContain('Play this')
    expect(src).toContain('VisualKeyboardStrip')

    // Frame time comes from the engine's interpolated clock while playing.
    expect(src).toContain('visual.getScoreTime')
    expect(src).toContain('useSmoothWfyFrameTime')
    expect(src).toContain('WFY_VISUAL_MOVE_MS')

    // Gentle guidance for missing timing and OMR-derived notes. The OMR note
    // stays collapsed inside a details fold during normal use.
    expect(src).toContain('Visual mode needs a timing file')
    expect(src).toContain("timingSourceKind === 'omr'")
    expect(src).toContain('read automatically from the PDF')
    expect(src).toContain('<details className="visual-practice__omr-details">')
    expect(src).not.toContain('<details className="visual-practice__omr-details" open')
    expect(src).toContain('About this piece’s notes')
  })

  it('StaffVisualLane moves the playhead and scrolls via one rAF transform', () => {
    const src = readSrc('components', 'practice', 'StaffVisualLane.jsx')

    // rAF loop writes the scroll transform imperatively — no CSS transition,
    // no per-frame React render. The playhead uses the same frame time as the
    // note-layer transform so crossings stay synchronized.
    expect(src).toContain('requestAnimationFrame')
    expect(src).toContain("el.setAttribute(")
    expect(src).toContain('getFrameTime()')
    expect(src).toContain('resolveVisualPlayheadX')
    expect(src).toContain('resolveVisualLaneTransform')
    expect(src).toContain('scrollX')
    expect(src).toContain('translate(${scrollX} 0)')
    expect(src).toContain("playheadEl.setAttribute('x1', String(livePlayheadX))")
    expect(src).toContain("playheadEl.setAttribute('x2', String(livePlayheadX))")
    expect(src).toContain("capEl.setAttribute('cx', String(livePlayheadX))")

    // Playhead is outside the scrolling group and painted on top, but its x
    // coordinate is updated by the same rAF loop as the scroll layer.
    const scrollIndex = src.indexOf('staff-lane__scroll')
    const playheadIndex = src.indexOf('className="staff-lane__playhead"')
    expect(scrollIndex).toBeGreaterThan(-1)
    expect(playheadIndex).toBeGreaterThan(scrollIndex)
    expect(src).toContain('ref={playheadRef}')
    expect(src).toContain('ref={playheadCapRef}')

    // Staff notation elements: lines, clefs, noteheads, ledgers, sharps,
    // barlines, and a time signature.
    expect(src).toContain('staff-lane__line')
    expect(src).toContain('staff-lane__clef')
    expect(src).toContain('staff-lane__head')
    expect(src).toContain('staff-lane__ledger')
    expect(src).toContain('staff-lane__sharp')
    expect(src).toContain('staff-lane__barline')
    expect(src).toContain('staff-lane__timesig')
    expect(src).toContain('staff-lane__playhead-cap')

    // Note stems: shared per chord, direction-aware, no beams.
    expect(src).toContain('buildStaffLaneStems')
    expect(src).toContain('staff-lane__stem')

    // Current target reads larger than the rest.
    expect(src).toContain('CURRENT_HEAD_SCALE')
  })

  it('keyboard strip shows target chips and the legend explains states', () => {
    const view = readSrc('components', 'practice', 'VisualPracticeView.jsx')
    expect(view).toContain('visual-practice__key-chip')
    expect(view).toContain('computeKeyboardRange')
    expect(view).toContain('buildBarlineTimes')
    expect(view).toContain('visual-practice__legend')

    const css = readSrc('styles', 'practice.css')
    expect(css).toContain('.visual-practice__key-chip')
    expect(css).toContain('.visual-practice__legend-item--now')
    // Far-future fade overlay keeps the learning window readable.
    expect(css).toContain('.staff-lane::after')
  })

  it('guitar fretboard strip labels visual frets while open strings stay in headers and TAB', () => {
    const view = readSrc('components', 'practice', 'VisualPracticeView.jsx')
    const tabLane = readSrc('components', 'practice', 'TabVisualLane.jsx')

    expect(view).toContain('buildFretboardDisplayFrets')
    expect(view).toContain('displayFrets.map((fret)')
    expect(view).toContain('describeTabPosition(position, strings)')
    expect(view).not.toContain("fret === 0 ? 'open' : fret")
    expect(view).not.toContain('visual-practice__fret-cell--nut')
    expect(tabLane).toContain('{note.fret}')
  })

  it('keyboard presses animate briefly (depress + glow fade under 200ms)', () => {
    const css = readSrc('styles', 'practice.css')

    expect(css).toMatch(/transform var\(--sf-duration-press\)/)
    expect(css).toMatch(/opacity var\(--sf-duration-press\)/)
    expect(css).toMatch(/__key--target \{\s*\n\s*transform: translateY\(2px\)/)
    expect(css).toContain('visual-practice-chip-in var(--sf-duration-press)')
    expect(css).toContain('will-change: left, transform')
    expect(css).toContain('will-change: transform')

    const durations = [...css.matchAll(/visual-practice__key[^{]*\{[^}]*?(?:var\(--sf-duration-press\)|(\d+)ms)/gs)]
      .map((m) => (m[1] ? Number(m[1]) : 170))
    expect(durations.length).toBeGreaterThan(0)
    expect(Math.max(...durations)).toBeLessThanOrEqual(200)
  })

  it('lane scroll uses SVG transforms without changing timing constants', () => {
    const staffLane = readSrc('components', 'practice', 'StaffVisualLane.jsx')
    const tabLane = readSrc('components', 'practice', 'TabVisualLane.jsx')
    const lane = readSrc('features', 'practice', 'visualPracticeLane.js')

    expect(staffLane).toContain('resolveVisualLaneTransform')
    expect(tabLane).toContain('resolveVisualLaneTransform')
    expect(staffLane).toContain('translate(${scrollX} 0)')
    expect(tabLane).toContain('translate(${scrollX} 0)')
    expect(staffLane).toContain("playheadEl.setAttribute('x1', String(livePlayheadX))")
    expect(tabLane).toContain("playheadEl.setAttribute('x1', String(livePlayheadX))")
    expect(lane).toContain('pixelsPerSecond: 110')
    expect(lane).toContain('nowLineFraction: 0.22')
    expect(lane).toContain('nowLineEndFraction: 0.82')
  })

  it('improves note readability and honors reduced motion in visual practice', () => {
    const css = readSrc('styles', 'practice.css')
    expect(css).toContain('--vp-upcoming')
    expect(css).toContain('.staff-lane__scroll')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toMatch(/\.staff-lane__note[\s\S]*transition:/)
    expect(css).toContain('flex: 1 1 clamp(220px, 44vh, 390px)')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).toContain('paint-order: stroke fill')
    expect(css).toContain('@media (min-width: 901px) and (max-width: 1180px)')
  })

  it('staff lane styles express upcoming/current/played states without the old block lane', () => {
    const css = readSrc('styles', 'practice.css')

    expect(css).toContain('.staff-lane__note--current')
    expect(css).toContain('drop-shadow')
    expect(css).toContain('.staff-lane__note--past')
    expect(css).toContain('.staff-lane__playhead')

    // Old rectangular block lane is fully removed (no zombie styles).
    expect(css).not.toContain('.visual-practice__track')
    expect(css).not.toContain('.visual-practice__nowline')
    expect(css).not.toContain('.visual-practice__group--current')
  })

  it('App threads the timing source kind into PracticeView', () => {
    const appSrc = readSrc('App.jsx')
    expect(appSrc).toContain('timingSourceKind={musicXmlSource?.source ?? null}')
  })
})
