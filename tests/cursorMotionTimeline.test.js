import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildCursorMotionTimeline,
  resolveCursorMotion,
  buildCursorMotionDiagnostics,
} from '../src/features/score-follow/cursorMotionTimeline.js'
import { FIXTURE_PATHS } from '../src/dev/fixturePaths.js'
import * as F from './helpers/buildXml.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const A = (n, x, pe, y = 0.3, se = 0.95) => ({
  id: `m${n}`, page: 1, x, y, measureNumber: n, source: 'manual',
  meta: { playableStartX: x, playableEndX: pe, systemEndX: se },
})
const N = (s, o, d, t, dx) =>
  `<note default-x="${dx}"><pitch><step>${s}</step><octave>${o}</octave></pitch>` +
  `<duration>${d}</duration><voice>1</voice><type>${t}</type></note>`
const ATTR = (b) =>
  `<attributes><divisions>4</divisions><time><beats>${b}</beats><beat-type>4</beat-type></time>` +
  `<clef><sign>G</sign><line>2</line></clef></attributes>`

// The engine's own note knots (v3 positions) — onset lock means the resolved
// cursor passes through these exactly at their onset times.
function onsets(tm, anchors, measures) {
  const tl = buildCursorMotionTimeline({ timingMap: tm, trustedAnchors: anchors })
  const wanted = new Set(measures)
  const all = []
  for (const phrase of tl.phrases) {
    for (const k of phrase.knots) {
      if ((k.kind === 'note' || k.kind === 'chord') && wanted.has(k.measureNumber)) {
        all.push({ m: k.measureNumber, time: k.t, x: k.x })
      }
    }
  }
  return all.sort((p, q) => p.time - q.time)
}

describe('cursorMotionTimeline — core invariants', () => {
  // 3/4 @60, clean geometry, two systems (m1-2 then m3-4 on a new line).
  const tm = parseMusicXml(
    F.scoreWrap(`<part id="P1">` +
      `<measure number="1">${ATTR(3)}${F.soundTempo(60)}${N('C', 5, 4, 'quarter', 60)}${N('E', 5, 4, 'quarter', 120)}${N('G', 5, 4, 'quarter', 180)}</measure>` +
      `<measure number="2">${N('C', 5, 4, 'quarter', 60)}${N('E', 5, 4, 'quarter', 120)}${N('G', 5, 4, 'quarter', 180)}</measure>` +
      `<measure number="3">${N('C', 5, 4, 'quarter', 60)}${N('E', 5, 4, 'quarter', 120)}${N('G', 5, 4, 'quarter', 180)}</measure>` +
      `<measure number="4">${N('C', 5, 4, 'quarter', 60)}${N('E', 5, 4, 'quarter', 120)}${N('G', 5, 4, 'quarter', 180)}</measure>` +
      `</part>`),
  )
  // m1,m2 on system A (y=0.3); m3,m4 on system B (y=0.55). A small gap between a
  // measure's playableEndX and the next measure's start mirrors real engravings
  // (barline spacing), so adjacent noteheads don't share an x.
  const anchors = [
    A(1, 0.2, 0.42, 0.3, 0.95), A(2, 0.45, 0.67, 0.3, 0.95),
    A(3, 0.2, 0.42, 0.55, 0.95), A(4, 0.45, 0.67, 0.55, 0.95),
  ]
  const tl = buildCursorMotionTimeline({ timingMap: tm, trustedAnchors: anchors })

  it('builds one phrase per system', () => {
    expect(tl.phrases.length).toBe(2)
    expect(tl.phrases[0].y).toBeCloseTo(0.3, 3)
    expect(tl.phrases[1].y).toBeCloseTo(0.55, 3)
  })

  it('onset lock: cursor x equals the notehead x exactly at each onset time', () => {
    for (const on of onsets(tm, anchors, [1, 2, 3, 4])) {
      const c = resolveCursorMotion(tl, on.time)
      expect(c).not.toBeNull()
      expect(c.x).toBeCloseTo(on.x, 3)
    }
    expect(buildCursorMotionDiagnostics(tl).maxOnsetErrorX).toBeLessThan(1e-3)
  })

  it('is never past a notehead 25ms before it sounds (same system)', () => {
    for (const on of onsets(tm, anchors, [1, 2, 3, 4])) {
      const at = resolveCursorMotion(tl, on.time)
      const before = resolveCursorMotion(tl, on.time - 0.025)
      if (!before || before.systemIndex !== at.systemIndex) continue
      expect(before.x).toBeLessThanOrEqual(on.x + 1e-4)
    }
  })

  it('moves monotonically within a system (no backward step)', () => {
    let prev = -Infinity
    let sys = null
    for (let t = 0; t < 6; t += 1 / 120) {
      const c = resolveCursorMotion(tl, t)
      if (!c) continue
      if (c.systemIndex !== sys) { sys = c.systemIndex; prev = -Infinity }
      expect(c.x).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = c.x
    }
  })

  it('same-system measure boundary is continuous (no pause, no jump)', () => {
    // m1→m2 barline at t=3.0 (3/4 @60). Velocity should stay nonzero across it.
    const a = resolveCursorMotion(tl, 2.85).x
    const b = resolveCursorMotion(tl, 2.98).x
    const c = resolveCursorMotion(tl, 3.10).x
    expect(b).toBeGreaterThan(a) // moving into the barline
    expect(c).toBeGreaterThan(b) // moving out of it
    expect(Math.abs(c - b)).toBeLessThan(0.1) // no teleport
  })

  it('finishes a system at systemEndX without overshoot, then resets', () => {
    // system A ends at t=6.0 (end of m2). Just before: near systemEndX, capped.
    for (let t = 5.0; t < 6.0; t += 0.02) {
      const c = resolveCursorMotion(tl, t)
      expect(c.x).toBeLessThanOrEqual(0.95 + 1e-6)
    }
    const endA = resolveCursorMotion(tl, 5.98)
    const startB = resolveCursorMotion(tl, 6.02)
    expect(endA.systemIndex).toBe(0)
    expect(startB.systemIndex).toBe(1)
    expect(startB.y).toBeCloseTo(0.55, 3) // reset to the new line
    expect(startB.x).toBeLessThan(endA.x) // new system starts back at the left
  })

  it('is stateless: resolving the same time (seek/loop) is deterministic', () => {
    expect(resolveCursorMotion(tl, 4.2).x).toBe(resolveCursorMotion(tl, 4.2).x)
    // out-of-order (seek backward then forward) yields the same as direct.
    const direct = resolveCursorMotion(tl, 1.5).x
    resolveCursorMotion(tl, 9.0)
    resolveCursorMotion(tl, 0.1)
    expect(resolveCursorMotion(tl, 1.5).x).toBe(direct)
  })
})

describe('cursorMotionTimeline — held notes keep moving', () => {
  // 4/4 @60: m1 two half notes, m2 a whole note, m3 two half notes (one system).
  const tm = parseMusicXml(
    F.scoreWrap(`<part id="P1">` +
      `<measure number="1">${ATTR(4)}${F.soundTempo(60)}${N('C', 5, 8, 'half', 60)}${N('E', 5, 8, 'half', 180)}</measure>` +
      `<measure number="2">${N('G', 5, 16, 'whole', 60)}</measure>` +
      `<measure number="3">${N('F', 5, 8, 'half', 60)}${N('D', 5, 8, 'half', 180)}</measure>` +
      `</part>`),
  )
  const anchors = [A(1, 0.2, 0.45), A(2, 0.45, 0.7), A(3, 0.7, 0.92)]
  const tl = buildCursorMotionTimeline({ timingMap: tm, trustedAnchors: anchors })

  it('the whole note glides continuously toward the next note (no freeze)', () => {
    // m2 (whole note) spans t=4..8.
    const a = resolveCursorMotion(tl, 4.5).x
    const b = resolveCursorMotion(tl, 7.5).x
    expect(b).toBeGreaterThan(a + 0.05)
    // no zero-velocity window longer than 150ms inside the held note
    let run = 0
    let maxRun = 0
    let prev = null
    for (let t = 4.1; t < 7.9; t += 1 / 60) {
      const x = resolveCursorMotion(tl, t).x
      if (prev != null && Math.abs(x - prev) < 1e-7) { run += 1 / 60; maxRun = Math.max(maxRun, run) } else run = 0
      prev = x
    }
    expect(maxRun).toBeLessThan(0.15)
  })

  it('arrives at the post-hold note exactly on time, not early', () => {
    const on = onsets(tm, anchors, [3])[0] // first note of m3 (after the whole note)
    expect(resolveCursorMotion(tl, on.time).x).toBeCloseTo(on.x, 3)
    expect(resolveCursorMotion(tl, on.time - 0.025).x).toBeLessThanOrEqual(on.x + 1e-4)
  })
})

describe('cursorMotionTimeline — bad/non-monotonic default-x falls back to time spacing', () => {
  // beat 2 engraved LEFT of beat 1 (non-monotonic) in every measure.
  const tm = parseMusicXml(
    F.scoreWrap(`<part id="P1">` +
      [1, 2, 3].map((m) =>
        `<measure number="${m}">${m === 1 ? ATTR(3) + F.soundTempo(54) : ''}` +
        `${N('C', 5, 4, 'quarter', 120)}${N('G', 3, 4, 'quarter', 60)}${N('E', 5, 4, 'quarter', 200)}</measure>`,
      ).join('') + `</part>`),
  )
  const anchors = [A(1, 0.2, 0.4), A(2, 0.4, 0.58), A(3, 0.58, 0.76)]
  const tl = buildCursorMotionTimeline({ timingMap: tm, trustedAnchors: anchors })

  it('produces strictly increasing knots (no collapsed flat span) and never freezes/jumps back', () => {
    const knots = tl.phrases[0].knots.filter((k) => k.kind !== 'system-end' && k.kind !== 'phrase-end')
    for (let i = 1; i < knots.length; i += 1) {
      expect(knots[i].x).toBeGreaterThanOrEqual(knots[i - 1].x - 1e-9)
    }
    let prev = -Infinity
    let run = 0
    let maxRun = 0
    let prevX = null
    for (let t = 0.05; t < 9.5; t += 1 / 60) {
      const c = resolveCursorMotion(tl, t)
      if (!c) continue
      expect(c.x).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = c.x
      if (prevX != null && Math.abs(c.x - prevX) < 1e-7) { run += 1 / 60; maxRun = Math.max(maxRun, run) } else run = 0
      prevX = c.x
    }
    expect(maxRun).toBeLessThan(0.2)
  })
})

describe('cursorMotionTimeline — Hungarian Dance & dense regressions', () => {
  let hd = null
  let hdAnchors = null
  beforeAll(async () => {
    const zip = await JSZip.loadAsync(readFileSync(join(root, 'public', FIXTURE_PATHS.musicXml.replace(/^\//, ''))))
    const container = await zip.file('META-INF/container.xml').async('string')
    hd = parseMusicXml(await zip.file(container.match(/full-path="([^"]+)"/)[1]).async('string'), 'hungarian-dance-no5.mxl')
    hdAnchors = JSON.parse(readFileSync(join(root, 'public', FIXTURE_PATHS.demoAnchors.replace(/^\//, '')), 'utf8')).anchors
  })

  it('Hungarian Dance: exact onset lock and no system-end overshoot', () => {
    const tl = buildCursorMotionTimeline({ timingMap: hd, trustedAnchors: hdAnchors })
    expect(buildCursorMotionDiagnostics(tl).maxOnsetErrorX).toBeLessThan(1e-3)
    for (const on of onsets(hd, hdAnchors, [1, 2, 3, 4, 5, 6, 7, 8])) {
      expect(resolveCursorMotion(tl, on.time).x).toBeCloseTo(on.x, 3)
    }
    // never past systemEndX for any system's last measure
    const a6 = hdAnchors.find((a) => a.measureNumber === 6)
    for (let t = 5.0; t < 5.45; t += 0.02) {
      const c = resolveCursorMotion(tl, t)
      if (c.measureNumber === 6) expect(c.x).toBeLessThanOrEqual(a6.meta.systemEndX + 1e-6)
    }
  })

  it('Hungarian Dance: monotonic within each system (no backward / teleport)', () => {
    const tl = buildCursorMotionTimeline({ timingMap: hd, trustedAnchors: hdAnchors })
    let prev = -Infinity
    let sys = null
    for (let t = 0; t < 6; t += 1 / 90) {
      const c = resolveCursorMotion(tl, t)
      if (!c) continue
      if (c.systemIndex !== sys) { sys = c.systemIndex; prev = -Infinity }
      expect(c.x).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = c.x
    }
  })

  it('dense fast passage: exact onset lock, monotonic', () => {
    const tmd = parseMusicXml(
      F.scoreWrap(`<part id="P1">` +
        [1, 2].map((m) =>
          `<measure number="${m}">${m === 1 ? ATTR(4) + F.soundTempo(140) : ''}` +
          Array.from({ length: 16 }, (_, i) => N('CDEFGABC'[i % 8], 4 + ((i / 8) | 0), 1, '16th', 40 + i * 12)).join('') +
          `</measure>`,
        ).join('') + `</part>`),
    )
    const denseAnchors = [A(1, 0.2, 0.52), A(2, 0.58, 0.9)]
    const tl = buildCursorMotionTimeline({ timingMap: tmd, trustedAnchors: denseAnchors })
    for (const on of onsets(tmd, denseAnchors, [1, 2])) {
      expect(resolveCursorMotion(tl, on.time).x).toBeCloseTo(on.x, 3)
    }
  })

  it('Hungarian Dance: an ordinary barline causes no velocity dip/brake', () => {
    const tl = buildCursorMotionTimeline({ timingMap: hd, trustedAnchors: hdAnchors })
    const vel = (t) =>
      (resolveCursorMotion(tl, t + 0.02).x - resolveCursorMotion(tl, t - 0.02).x) / 0.04
    const vels = []
    for (let t = 0.6; t <= 1.2; t += 0.05) vels.push(vel(t)) // across the m1->m2 barline
    const vmin = Math.min(...vels)
    const vmax = Math.max(...vels)
    expect(vmin).toBeGreaterThan(0) // always moving — never stalls at the barline
    // v2 dipped ~7x crossing the barline; v3 must stay near-constant.
    expect(vmax / vmin).toBeLessThan(2)
  })
})

describe('cursorMotionTimeline — repeats follow playback order', () => {
  // oneRepeat plays measures 1,2,1,2,3,4 — a backward repeat barline at end of m2.
  const tm = parseMusicXml(F.oneRepeat())
  const anchors = [A(1, 0.1, 0.3), A(2, 0.3, 0.5), A(3, 0.5, 0.7), A(4, 0.7, 0.9)]
  const tl = buildCursorMotionTimeline({ timingMap: tm, trustedAnchors: anchors })

  it('breaks into a first-pass phrase ending at the repeat barline, then a continuation', () => {
    expect(tl.phrases.length).toBeGreaterThanOrEqual(2)
    expect(tl.phrases[0].breakType).toBe('jump')
  })

  it('jumps the cursor back to the repeated section immediately (no continue-past, no freeze)', () => {
    const before = resolveCursorMotion(tl, 3.9) // end of m2, first pass
    const after = resolveCursorMotion(tl, 4.05) // jumped back to m1
    expect(before.measureNumber).toBe(2)
    expect(after.measureNumber).toBe(1)
    expect(after.x).toBeLessThan(before.x - 0.2) // jumped backward
    expect(after.x).toBeCloseTo(0.1, 1) // to m1's start region
  })

  it('never travels past the repeat into music not yet played (first pass)', () => {
    for (let t = 0.1; t < 3.95; t += 0.05) {
      expect(resolveCursorMotion(tl, t).x).toBeLessThanOrEqual(0.5 + 1e-6)
    }
  })
})
