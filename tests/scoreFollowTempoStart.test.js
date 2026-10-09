/**
 * A1–A3: start position, musical tempo, mid-song tempo changes.
 *
 * All expected times below are HAND-COMPUTED from the notated durations
 * and tempo markings (divisions/durations x bpm) — never read back from
 * the timing map under test. The cursor and playback both consume the
 * canonical performed timeline, so these tests pin the map itself plus
 * the cursor behavior derived from it.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { getTempoAtTime } from '../src/features/musicxml/timingMath.js'
import {
  buildCursorMotionTimeline,
  resolveCursorMotion,
} from '../src/features/score-follow/cursorMotionTimeline.js'
import { resolveDisplayCursorAtTime } from '../src/features/score-follow/scoreFollowDisplayPosition.js'
import * as F from './helpers/buildXml.js'

const Q = (step, dx) =>
  `<note default-x="${dx}"><pitch><step>${step}</step><octave>4</octave></pitch>` +
  `<duration>4</duration><type>quarter</type></note>`
const ATTR44 = `<attributes><divisions>4</divisions>` +
  `<time><beats>4</beats><beat-type>4</beat-type></time>` +
  `<clef><sign>G</sign><line>2</line></clef></attributes>`
const soundTempo = (bpm) => `<direction><sound tempo="${bpm}"/></direction>`

function anchorsFor(count, { y = 0.3 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    page: 1,
    x: 0.1 + index * 0.12,
    y,
    measureNumber: index + 1,
    source: 'manual',
    meta: {
      role: 'measure',
      playableStartX: 0.1 + index * 0.12,
      playableEndX: 0.1 + index * 0.12 + 0.1,
      systemEndX: 0.95,
    },
  }))
}

/** m1-2 @80, m3-4 @140, m5-6 @60. Quarter = 0.75 / 3/7 / 1.0 s. */
function tempoChangeXml() {
  return F.scoreWrap(
    `<part id="P1">` +
    `<measure number="1">${ATTR44}${soundTempo(80)}${Q('C', 10)}${Q('D', 30)}${Q('E', 50)}${Q('F', 70)}</measure>` +
    `<measure number="2">${Q('G', 10)}${Q('A', 30)}${Q('B', 50)}${Q('C', 70)}</measure>` +
    `<measure number="3">${soundTempo(140)}${Q('D', 10)}${Q('E', 30)}${Q('F', 50)}${Q('G', 70)}</measure>` +
    `<measure number="4">${Q('A', 10)}${Q('B', 30)}${Q('C', 10)}${Q('D', 70)}</measure>` +
    `<measure number="5">${soundTempo(60)}${Q('E', 10)}${Q('F', 30)}${Q('G', 50)}${Q('A', 70)}</measure>` +
    `<measure number="6">${Q('B', 10)}${Q('C', 30)}${Q('D', 50)}${Q('E', 70)}</measure>` +
    `</part>`,
  )
}

describe('A2/A3 tempo map', () => {
  it('reads discrete tempo markings into quarter-time changes', () => {
    const timingMap = parseMusicXml(tempoChangeXml())
    expect(timingMap.tempoChanges).toEqual([
      { quarterTime: 0, bpm: 80 },
      { quarterTime: 8, bpm: 140 },
      { quarterTime: 16, bpm: 60 },
    ])
  })

  it('bakes tempo changes into performed seconds (hand-computed)', () => {
    const timingMap = parseMusicXml(tempoChangeXml())
    // m1-2: 8 quarters @0.75s = 6.0s. m3 starts at 6.0.
    // m3-4: 8 quarters @60/140 = 3.428571s. m5 starts at 9.428571.
    const m3start = timingMap.measures[2].startTimeSeconds
    const m5start = timingMap.measures[4].startTimeSeconds
    expect(m3start).toBeCloseTo(6.0, 6)
    expect(m5start).toBeCloseTo(6 + 8 * (60 / 140), 6)
    const m3notes = timingMap.notes.filter((n) => n.measureNumber === 3 && !n.isRest)
    expect(m3notes[0].timeSeconds).toBeCloseTo(6.0, 6)
    expect(m3notes[1].timeSeconds).toBeCloseTo(6 + 60 / 140, 6)
  })

  it('reports the active tempo per region, including return to slow', () => {
    const timingMap = parseMusicXml(tempoChangeXml())
    expect(getTempoAtTime(timingMap, 1.0)).toBe(80)
    expect(getTempoAtTime(timingMap, 7.0)).toBe(140)
    expect(getTempoAtTime(timingMap, 12.0)).toBe(60)
  })

  it('falls back to a documented 120bpm when the score marks none', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(`<part id="P1"><measure number="1">${ATTR44}${Q('C', 10)}</measure></part>`),
    )
    // Documented fallback: the map seeds quarter-time 0 at 120bpm so
    // unmarked scores still play; nothing invents a marking.
    expect(timingMap.tempoChanges).toEqual([{ quarterTime: 0, bpm: 120 }])
  })

  it('reads metronome marks scaled by beat-unit', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1"><measure number="1">${ATTR44}` +
        `<direction><direction-type><metronome>` +
        `<beat-unit>half</beat-unit><per-minute>50</per-minute>` +
        `</metronome></direction-type></direction>${Q('C', 10)}</measure></part>`,
      ),
    )
    // Half = 50/min -> quarter = 100.
    expect(timingMap.tempoChanges[0].bpm).toBe(100)
  })
})

describe('A3 cursor follows tempo changes', () => {
  it('moves ~1.75x faster through the 140 section than the 80 section', () => {
    const timingMap = parseMusicXml(tempoChangeXml())
    const trusted = anchorsFor(6)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    const velocity = (t0, t1) => {
      const a = resolveCursorMotion(motionTimeline, t0)
      const b = resolveCursorMotion(motionTimeline, t1)
      return (b.x - a.x) / (t1 - t0)
    }
    // Mid-measure glides (away from knots): m2 (80bpm) vs m4 (140bpm).
    const vSlow = velocity(4.0, 4.5)
    const vFast = velocity(7.0, 7.2)
    expect(vSlow).toBeGreaterThan(0)
    expect(vFast).toBeGreaterThan(0)
    expect(vFast / vSlow).toBeCloseTo(140 / 80, 0)
  })

  it('stays in the correct measure on both sides of a tempo boundary', () => {
    const timingMap = parseMusicXml(tempoChangeXml())
    const trusted = anchorsFor(6)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    const trust = { showCursor: true, needsSetup: false }
    const before = resolveDisplayCursorAtTime({
      timingMap, trustedAnchors: trusted, trust, practiceTime: 5.99, motionTimeline,
    })
    const after = resolveDisplayCursorAtTime({
      timingMap, trustedAnchors: trusted, trust, practiceTime: 6.01, motionTimeline,
    })
    expect(before.measureNumber).toBe(2)
    expect(after.measureNumber).toBe(3)
  })

  it('a mid-measure change keeps motion continuous (no jump)', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1"><measure number="1">${ATTR44}${soundTempo(80)}${Q('C', 10)}${Q('D', 30)}` +
        `${soundTempo(160)}${Q('E', 50)}${Q('F', 70)}</measure>` +
        `<measure number="2">${Q('G', 10)}${Q('A', 30)}${Q('B', 50)}${Q('C', 70)}</measure></part>`,
      ),
    )
    expect(timingMap.tempoChanges).toEqual([
      { quarterTime: 0, bpm: 80 },
      { quarterTime: 2, bpm: 160 },
    ])
    const trusted = anchorsFor(2)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    const a = resolveCursorMotion(motionTimeline, 1.49).x
    const b = resolveCursorMotion(motionTimeline, 1.51).x
    // Beat 3 (the change) sounds at 2*0.75 = 1.5s; motion crosses it smoothly.
    expect(Math.abs(b - a)).toBeLessThan(0.05)
    // Second half runs twice as fast through the same engraved span:
    // knot-to-knot velocities (beat 2 @80 vs beat 3 @160).
    const x075 = resolveCursorMotion(motionTimeline, 0.75).x
    const x150 = resolveCursorMotion(motionTimeline, 1.5).x
    const x1875 = resolveCursorMotion(motionTimeline, 1.875).x
    const vSlow = (x150 - x075) / 0.75
    const vFast = (x1875 - x150) / 0.375
    expect(vFast / vSlow).toBeCloseTo(2, 0)
  })
})

describe('A1 start position', () => {
  it('starts at the first notehead, not at time zero padding', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(`<part id="P1"><measure number="1">${ATTR44}${F.soundTempo(120)}${Q('C', 10)}${Q('D', 30)}</measure></part>`),
    )
    const trusted = anchorsFor(1)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    const atZero = resolveCursorMotion(motionTimeline, 0.0)
    expect(atZero.x).toBeCloseTo(0.1, 6)
    expect(atZero.measureNumber).toBe(1)
  })

  it('handles a pickup measure: first onset is at t=0 in measure 1', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">` +
        `<measure number="1" implicit="yes">${ATTR44}${F.soundTempo(120)}` +
        `<note default-x="60"><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type></note></measure>` +
        `<measure number="2">${Q('C', 10)}${Q('D', 30)}${Q('E', 50)}${Q('F', 70)}</measure>` +
        `</part>`,
      ),
    )
    expect(timingMap.measures[0].implicit).toBe(true)
    const trusted = anchorsFor(2)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    const atZero = resolveCursorMotion(motionTimeline, 0.0)
    expect(atZero.measureNumber).toBe(1)
    expect(atZero.x).toBeCloseTo(0.1, 6)
  })

  it('parks at the measure start through an opening rest, then hits the note', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1"><measure number="1">${ATTR44}${F.soundTempo(120)}` +
        `<note default-x="10"><rest/><duration>4</duration><type>quarter</type></note>` +
        `${Q('C', 60)}${Q('D', 90)}${Q('E', 120)}</measure></part>`,
      ),
    )
    const trusted = anchorsFor(1)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    // 120bpm: rest is t=[0,0.5); first note at t=0.5.
    const duringRest = resolveCursorMotion(motionTimeline, 0.25)
    expect(duringRest.measureNumber).toBe(1)
    expect(duringRest.x).toBeCloseTo(0.1, 1)
    const atNote = resolveCursorMotion(motionTimeline, 0.5)
    expect(atNote.x).toBeGreaterThan(duringRest.x)
  })

  it('restart returns to the opening anchor (stateless lookup)', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(`<part id="P1"><measure number="1">${ATTR44}${F.soundTempo(120)}${Q('C', 10)}${Q('D', 30)}</measure><measure number="2">${Q('E', 10)}${Q('F', 30)}</measure></part>`),
    )
    const trusted = anchorsFor(2)
    const motionTimeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: trusted })
    resolveCursorMotion(motionTimeline, 3.5)
    expect(resolveCursorMotion(motionTimeline, 0.0).x).toBeCloseTo(0.1, 6)
  })
})
