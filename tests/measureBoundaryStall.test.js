import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import {
  isNearSystemEnd,
  resolveVisualMaxX,
} from '../src/features/score-follow/cursorVisualMotion.js'
import { FIXTURE_PATHS } from '../src/dev/fixturePaths.js'
import * as F from './helpers/buildXml.js'

const trust = { showCursor: true, needsSetup: false }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function anchor(measureNumber, x, playableEndX, systemEndX, y) {
  return {
    id: `m${measureNumber}`,
    page: 1,
    x,
    y,
    measureNumber,
    source: 'manual',
    meta: { playableStartX: x, playableEndX, systemEndX },
  }
}

function sampleCursor(timingMap, trustedAnchors, t0, t1, step = 0.02) {
  const out = []
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    out.push(
      resolveScoreFollowCursor({ timingMap, practiceTime: t, trustedAnchors, trust }).cursor,
    )
  }
  return out
}

/** Longest zero-velocity (frozen) window across a forward sample sweep. */
function longestStall(samples, step) {
  let stall = 0
  let run = 0
  for (let i = 1; i < samples.length; i += 1) {
    if (Math.abs(samples[i].x - samples[i - 1].x) < 1e-6) {
      run += step
      stall = Math.max(stall, run)
    } else {
      run = 0
    }
  }
  return stall
}

// A same-system measure boundary must flow continuously. The bug lived on the
// PERFORMED timeline (repeats), where the next-window lookup matches `time >=
// start` with no tolerance — so a 1ms-early lookup dropped the bridge and froze
// the cursor at the current measure's playableEndX. `oneRepeat` (performed order
// 1,2,1,2,3,4) exercises exactly that path; the m1->m2 barline sits at t=2.0.
describe('same-system measure boundary flows continuously (performed timeline)', () => {
  const timingMap = parseMusicXml(F.oneRepeat())
  const sameLine = [
    anchor(1, 0.1, 0.22, 0.95, 0.3),
    anchor(2, 0.28, 0.4, 0.95, 0.3),
    anchor(3, 0.46, 0.58, 0.95, 0.3),
    anchor(4, 0.64, 0.76, 0.95, 0.3),
  ]

  it('bridges past the current measure playableEndX without a measure-end stall', () => {
    const step = 0.02
    const samples = sampleCursor(timingMap, sameLine, 1.5, 1.99, step)
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].measureNumber).toBe(1)
      expect(samples[i].x).toBeGreaterThanOrEqual(samples[i - 1].x - 1e-9)
    }
    // Pre-fix this froze ~0.3s at playableEndX (0.22); the bridge must keep moving.
    expect(longestStall(samples, step)).toBeLessThan(0.05)
    const late = samples[samples.length - 1]
    expect(late.x).toBeGreaterThan(0.22 + 0.01)
    expect(late.x).toBeLessThanOrEqual(0.28 + 1e-6)
  })

  it('keeps nonzero velocity through the barline', () => {
    const a = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.8,
      trustedAnchors: sameLine,
      trust,
    }).cursor
    const b = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.96,
      trustedAnchors: sameLine,
      trust,
    }).cursor
    expect(b.x - a.x).toBeGreaterThan(0.01)
  })

  it('lifts the visual cap to the bridge target but never past the system edge', () => {
    const cursor = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.9,
      trustedAnchors: sameLine,
      trust,
    }).cursor
    expect(cursor.nextSameSystem).toBe(true)
    // The measure's own playable end is unchanged...
    expect(cursor.playableEndX).toBeCloseTo(0.22, 5)
    // ...but the visual cap is the next onset (bridge target), not playableEndX.
    expect(cursor.visualMaxX).toBeGreaterThan(0.22 + 0.01)
    expect(resolveVisualMaxX(cursor)).toBeGreaterThan(0.22 + 0.01)
    expect(resolveVisualMaxX(cursor)).toBeLessThanOrEqual(0.95)
    // A same-system boundary is NOT a system end.
    expect(isNearSystemEnd(cursor)).toBe(false)
  })

  it('onset-locks the first note of the next measure exactly', () => {
    const before = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.99,
      trustedAnchors: sameLine,
      trust,
    }).cursor
    const at = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 2.0,
      trustedAnchors: sameLine,
      trust,
    }).cursor
    expect(at.measureNumber).toBe(2)
    expect(at.x).toBeCloseTo(0.28, 4)
    // Continuous (no teleport) and never passed the next onset early.
    expect(at.x).toBeGreaterThanOrEqual(before.x - 1e-9)
    expect(before.x).toBeLessThanOrEqual(0.28 + 1e-6)
  })
})

describe('cross-system boundary keeps the hard cap', () => {
  const timingMap = parseMusicXml(F.oneRepeat())
  // m1 is the last measure of its system; m2 starts a new system (y jumps).
  const crossSystem = [
    anchor(1, 0.1, 0.88, 0.9, 0.3),
    anchor(2, 0.1, 0.22, 0.9, 0.55),
    anchor(3, 0.28, 0.4, 0.9, 0.55),
    anchor(4, 0.46, 0.58, 0.9, 0.55),
  ]

  it('never exceeds systemEndX before an actual system transition', () => {
    const samples = sampleCursor(timingMap, crossSystem, 1.5, 1.99, 0.02)
    for (const cursor of samples) {
      expect(cursor.measureNumber).toBe(1)
      expect(cursor.nextSameSystem).toBe(false)
      expect(cursor.x).toBeLessThanOrEqual(0.9 + 1e-6)
    }
    // It still travels to the system edge — not frozen far short of it.
    expect(samples[samples.length - 1].x).toBeGreaterThan(0.8)
  })

  it('resets to the next system start without overshoot', () => {
    const end = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.99,
      trustedAnchors: crossSystem,
      trust,
    }).cursor
    const next = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 2.0,
      trustedAnchors: crossSystem,
      trust,
    }).cursor
    expect(end.y).toBeLessThan(next.y)
    expect(end.x).toBeLessThanOrEqual(0.9 + 1e-6)
    expect(next.x).toBeCloseTo(0.1, 2)
  })
})

describe('slow / open passage regression', () => {
  // 60 bpm, half notes — sparse, open texture, two measures on one system.
  const slow = parseMusicXml(
    F.scoreWrap(
      `<part id="P1">
        <measure number="1">
          ${F.attributes()}${F.soundTempo(60)}
          <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
          <note default-x="120"><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
        </measure>
        <measure number="2">
          <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
          <note default-x="120"><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
        </measure>
      </part>`,
    ),
  )
  const slowAnchors = [anchor(1, 0.1, 0.3, 0.95, 0.3), anchor(2, 0.4, 0.6, 0.95, 0.3)]
  // 4 beats/measure at 60bpm => measure = 4s; barline at t=4.0.

  it('glides through a held note instead of freezing', () => {
    const a = resolveScoreFollowCursor({
      timingMap: slow,
      practiceTime: 0.4,
      trustedAnchors: slowAnchors,
      trust,
    }).cursor
    const b = resolveScoreFollowCursor({
      timingMap: slow,
      practiceTime: 1.6,
      trustedAnchors: slowAnchors,
      trust,
    }).cursor
    expect(b.x).toBeGreaterThan(a.x + 0.01)
  })

  it('bridges the slow boundary continuously and onset-locks the next measure', () => {
    const step = 0.04
    const samples = sampleCursor(slow, slowAnchors, 2.6, 3.96, step)
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].x).toBeGreaterThanOrEqual(samples[i - 1].x - 1e-9)
    }
    expect(longestStall(samples, step)).toBeLessThan(0.1)
    const tail = samples[samples.length - 1]
    expect(tail.x).toBeGreaterThan(0.3) // crossed the current measure playableEndX
    expect(tail.x).toBeLessThanOrEqual(0.4 + 1e-6) // never past the next onset early

    const at = resolveScoreFollowCursor({
      timingMap: slow,
      practiceTime: 4.0,
      trustedAnchors: slowAnchors,
      trust,
    }).cursor
    expect(at.measureNumber).toBe(2)
    expect(at.x).toBeCloseTo(0.4, 3)
  })
})

describe('Hungarian Dance demo regression (no measure-end stall)', () => {
  let timingMap = null
  let anchors = null

  beforeAll(async () => {
    const mxlPath = join(root, 'public', FIXTURE_PATHS.musicXml.replace(/^\//, ''))
    const zip = await JSZip.loadAsync(readFileSync(mxlPath))
    const container = await zip.file('META-INF/container.xml').async('string')
    const rootfile = container.match(/full-path="([^"]+)"/)[1]
    timingMap = parseMusicXml(await zip.file(rootfile).async('string'), 'hungarian-dance-no5.mxl')
    const anchorsPath = join(root, 'public', FIXTURE_PATHS.demoAnchors.replace(/^\//, ''))
    anchors = JSON.parse(readFileSync(anchorsPath, 'utf8')).anchors
  })

  it('bridges measure 1 -> 2 continuously and onset-locks measure 2', () => {
    const a1 = anchors.find((a) => a.measureNumber === 1)
    const a2 = anchors.find((a) => a.measureNumber === 2)
    // Barline ~0.909s. Sample the tail of measure 1 (same system as measure 2).
    const step = 0.01
    let prev = -Infinity
    let run = 0
    let maxStall = 0
    for (let t = 0.7; t < 0.905; t += step) {
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: anchors,
        trust,
      })
      expect(cursor.measureNumber).toBe(1)
      expect(cursor.x).toBeGreaterThanOrEqual(prev - 1e-9)
      if (Math.abs(cursor.x - prev) < 1e-6) {
        run += step
        maxStall = Math.max(maxStall, run)
      } else {
        run = 0
      }
      prev = cursor.x
    }
    expect(maxStall).toBeLessThan(0.06)

    const lateTail = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0.9,
      trustedAnchors: anchors,
      trust,
    }).cursor
    expect(lateTail.x).toBeGreaterThan(a1.meta.playableEndX)
    expect(lateTail.x).toBeLessThanOrEqual(a2.x + 1e-6)

    const atM2 = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0.91,
      trustedAnchors: anchors,
      trust,
    }).cursor
    expect(atM2.measureNumber).toBe(2)
    expect(atM2.x).toBeCloseTo(a2.x, 2)
  })

  it('caps the cross-system boundary (measure 6 -> 7) at systemEndX', () => {
    const a6 = anchors.find((a) => a.measureNumber === 6)
    // Measure 6 ends its system; measure 7 drops to the next line.
    for (let t = 5.2; t < 5.45; t += 0.03) {
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: anchors,
        trust,
      })
      if (cursor.measureNumber === 6) {
        expect(cursor.nextSameSystem).toBe(false)
        expect(cursor.x).toBeLessThanOrEqual(a6.meta.systemEndX + 1e-6)
      }
    }
  })
})
