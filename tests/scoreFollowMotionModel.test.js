import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { buildMeasureMusicalEvents } from '../src/features/score-follow/cursorMusicalProgress.js'
import { getMeasurePlaybackWindow } from '../src/features/musicxml/performedTimeline.js'
import {
  applyVisualCursorX,
  isNearSystemEnd,
  isSameSystemCursor,
  resolveVisualMaxX,
  shouldUseVisualCursorMotion,
  VISUAL_LEAD_SECONDS,
} from '../src/features/score-follow/cursorVisualMotion.js'
import { FIXTURE_PATHS } from '../src/dev/fixturePaths.js'
import * as F from './helpers/buildXml.js'

const trust = { showCursor: true, needsSetup: false }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const A = (n, x, pe, y = 0.3, se = 0.95) => ({
  id: `m${n}`, page: 1, x, y, measureNumber: n, source: 'manual',
  meta: { playableStartX: x, playableEndX: pe, systemEndX: se },
})
const N = (s, o, d, t, dx) =>
  `<note default-x="${dx}"><pitch><step>${s}</step><octave>${o}</octave></pitch>` +
  `<duration>${d}</duration><voice>1</voice><type>${t}</type></note>`
const ATTR = (beats) =>
  `<attributes><divisions>4</divisions><time><beats>${beats}</beats><beat-type>4</beat-type></time>` +
  `<clef><sign>G</sign><line>2</line></clef></attributes>`

// Replicate the RAF display driver: stateful follower + small same-system lead.
function simulate(tm, anchors, t0, t1, fps = 60) {
  const dt = 1 / fps
  const out = []
  let state = null
  let sysKey = null
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    const target = resolveScoreFollowCursor({ timingMap: tm, practiceTime: t, trustedAnchors: anchors, trust }).cursor
    if (!target.visible) { out.push({ t, visible: false }); continue }
    const key = `${target.page}:${(target.y ?? 0).toFixed(4)}`
    if (state == null || key !== sysKey) { state = target.x; sysKey = key }
    const ahead = resolveScoreFollowCursor({ timingMap: tm, practiceTime: t + VISUAL_LEAD_SECONDS, trustedAnchors: anchors, trust }).cursor
    const sameAhead = isSameSystemCursor(target, ahead) && !isNearSystemEnd(target)
    const vmax = resolveVisualMaxX(target)
    const disp = shouldUseVisualCursorMotion(target)
      ? applyVisualCursorX({
          displayX: state, musicalX: target.x,
          musicalAheadX: sameAhead && ahead?.visible ? ahead.x : target.x,
          sameSystem: true, visualMaxX: vmax,
        })
      : target.x
    state = disp
    out.push({ t, visible: true, musX: target.x, dispX: disp, y: target.y, page: target.page, measure: target.measureNumber })
  }
  return out
}

function onsets(tm, anchors, measures) {
  const all = []
  for (const m of measures) {
    const w = getMeasurePlaybackWindow(tm, m, m === measures[0] ? 0 : (m - 1) * 100)
    if (!w) continue
    const a = anchors.find((x) => x.measureNumber === m)
    if (!a) continue
    for (const e of buildMeasureMusicalEvents(tm, m, w, a.x, a.meta.playableEndX)) {
      if (e.kind === 'note' || e.kind === 'chord') all.push({ m, time: e.timeSeconds, x: e.x })
    }
  }
  return all.sort((p, q) => p.time - q.time)
}

function sysAt(tm, anchors, time) {
  const c = resolveScoreFollowCursor({ timingMap: tm, practiceTime: time, trustedAnchors: anchors, trust }).cursor
  return c.visible ? `${c.page}:${(c.y ?? 0).toFixed(4)}` : null
}
function sampleDisp(samples, time) {
  let best = null
  let bestDt = Infinity
  for (const s of samples) {
    if (!s.visible) continue
    const d = Math.abs(s.t - time)
    if (d < bestDt) { bestDt = d; best = s }
  }
  return best && bestDt < 0.03 ? best.dispX : null
}
// Worst-case milliseconds the DISPLAY reaches a notehead before it sounds. Measured
// as the contiguous final approach within the onset's OWN system (x is not
// comparable across line breaks). Onsets whose x coincides with the previous
// onset (repeated note / bridge where adjacent noteheads share an x) are skipped:
// the cursor sitting there is legitimately on a sounding note, not "early".
function maxEarlyMs(tm, anchors, samples, measures) {
  const ons = onsets(tm, anchors, measures)
  let worst = 0
  for (let i = 0; i < ons.length; i += 1) {
    const on = ons[i]
    const prev = i > 0 ? ons[i - 1] : null
    if (prev && on.x - prev.x < 0.005) continue
    const onSys = sysAt(tm, anchors, on.time)
    let reach = on.time
    for (let t = on.time; t >= on.time - 0.4; t -= 1 / 120) {
      if (sysAt(tm, anchors, t) !== onSys) break
      const d = sampleDisp(samples, t)
      if (d == null || d < on.x - 1e-4) break
      reach = t
    }
    worst = Math.max(worst, (on.time - reach) * 1000)
  }
  return worst
}
function maxBackwardStep(samples) {
  let prev = null, prevKey = null, worst = 0
  for (const s of samples) {
    if (!s.visible) { prev = null; continue }
    const key = `${s.page}:${(s.y ?? 0).toFixed(4)}`
    if (prev != null && key === prevKey && s.dispX < prev) worst = Math.max(worst, prev - s.dispX)
    prev = s.dispX; prevKey = key
  }
  return worst
}
function longestFreeze(samples, from, to) {
  let run = 0, max = 0, prev = null, prevKey = null
  for (const s of samples) {
    if (!s.visible || s.t < from || s.t > to) { prev = null; run = 0; continue }
    const key = `${s.page}:${(s.y ?? 0).toFixed(4)}`
    if (prev != null && key === prevKey && Math.abs(s.dispX - prev) < 1e-7) { run += 1 / 60; max = Math.max(max, run) } else run = 0
    prev = s.dispX; prevKey = key
  }
  return max
}

describe('motion model — Hungarian Dance regression', () => {
  let hd = null
  let hdAnchors = null
  beforeAll(async () => {
    const zip = await JSZip.loadAsync(readFileSync(join(root, 'public', FIXTURE_PATHS.musicXml.replace(/^\//, ''))))
    const container = await zip.file('META-INF/container.xml').async('string')
    hd = parseMusicXml(await zip.file(container.match(/full-path="([^"]+)"/)[1]).async('string'), 'hungarian-dance-no5.mxl')
    hdAnchors = JSON.parse(readFileSync(join(root, 'public', FIXTURE_PATHS.demoAnchors.replace(/^\//, '')), 'utf8')).anchors
  })

  it('cursor is never more than ~25ms early at note onsets', () => {
    const S = simulate(hd, hdAnchors, 0, 6)
    expect(maxEarlyMs(hd, hdAnchors, S, [1, 2, 3, 4, 5, 6, 7, 8])).toBeLessThanOrEqual(25)
  })

  it('no backward snap within a system', () => {
    expect(maxBackwardStep(simulate(hd, hdAnchors, 0, 6))).toBeLessThanOrEqual(1e-6)
  })

  it('never overshoots systemEndX (last measure of a system)', () => {
    const a6 = hdAnchors.find((a) => a.measureNumber === 6)
    for (const s of simulate(hd, hdAnchors, 5.0, 5.45)) {
      if (s.visible && s.measure === 6) expect(s.dispX).toBeLessThanOrEqual(a6.meta.systemEndX + 1e-6)
    }
  })
})

describe('motion model — Gymnopédie-style bad default-x (first measures)', () => {
  // beat 2 engraved LEFT of beat 1 (non-monotonic) — must not freeze/crawl/jump.
  const xml = F.scoreWrap(`<part id="P1">` +
    [1, 2, 3, 4].map((m) =>
      `<measure number="${m}">${m === 1 ? ATTR(3) + F.soundTempo(54) : ''}` +
      `${N('C', 5, 4, 'quarter', 120)}${N('G', 3, 4, 'quarter', 60)}${N('E', 5, 4, 'quarter', 200)}</measure>`,
    ).join('') + `</part>`)
  const tm = parseMusicXml(xml)
  const anchors = [A(1, 0.2, 0.40), A(2, 0.40, 0.58), A(3, 0.58, 0.76), A(4, 0.76, 0.94)]

  it('falls back to monotonic time spacing (no collapsed flat span)', () => {
    const ons = onsets(tm, anchors, [1])
    for (let i = 1; i < ons.length; i += 1) expect(ons[i].x).toBeGreaterThan(ons[i - 1].x + 1e-3)
  })

  it('does not freeze or crawl, never jumps backward, never early', () => {
    const S = simulate(tm, anchors, 0, 13)
    expect(longestFreeze(S, 0, 12.8)).toBeLessThan(0.2)
    expect(maxBackwardStep(S)).toBeLessThanOrEqual(1e-6)
    expect(maxEarlyMs(tm, anchors, S, [1, 2, 3, 4])).toBeLessThanOrEqual(25)
  })
})

describe('motion model — long held notes keep moving slowly', () => {
  // 4/4 @60: m1 two half notes, m2 a whole note (the held note), m3 two half notes.
  const xml = F.scoreWrap(`<part id="P1">` +
    `<measure number="1">${ATTR(4)}${F.soundTempo(60)}${N('C', 5, 8, 'half', 60)}${N('E', 5, 8, 'half', 180)}</measure>` +
    `<measure number="2">${N('G', 5, 16, 'whole', 60)}</measure>` +
    `<measure number="3">${N('F', 5, 8, 'half', 60)}${N('D', 5, 8, 'half', 180)}</measure>` +
    `</part>`)
  const tm = parseMusicXml(xml)
  const anchors = [A(1, 0.2, 0.45), A(2, 0.45, 0.7), A(3, 0.7, 0.92)]

  it('the whole-note measure glides continuously (no freeze) toward the next note', () => {
    const S = simulate(tm, anchors, 0, 12)
    // measure 2 (whole note) spans t=4..8 — the cursor must keep advancing, not stop.
    const a = S.find((s) => s.visible && Math.abs(s.t - 4.5) < 0.02).dispX
    const b = S.find((s) => s.visible && Math.abs(s.t - 7.5) < 0.02).dispX
    expect(b).toBeGreaterThan(a + 0.05)
    expect(longestFreeze(S, 4, 7.9)).toBeLessThan(0.15)
  })

  it('held-note travel is never early at the following onset', () => {
    const S = simulate(tm, anchors, 0, 12)
    expect(maxEarlyMs(tm, anchors, S, [1, 2, 3])).toBeLessThanOrEqual(25)
  })
})

describe('motion model — applyVisualCursorX bounds', () => {
  it('forward-only within a system (never steps backward)', () => {
    const x = applyVisualCursorX({ displayX: 0.5, musicalX: 0.48, musicalAheadX: 0.48, sameSystem: true, visualMaxX: 0.9 })
    expect(x).toBeGreaterThanOrEqual(0.5 - 1e-9)
  })
  it('resets to new-system x without blending old x', () => {
    expect(applyVisualCursorX({ displayX: 0.9, musicalX: 0.12, musicalAheadX: 0.12, sameSystem: false, visualMaxX: 0.95 })).toBe(0.12)
  })
  it('never renders past visualMaxX (system end)', () => {
    const x = applyVisualCursorX({ displayX: 0.94, musicalX: 0.95, musicalAheadX: 0.98, sameSystem: true, visualMaxX: 0.95 })
    expect(x).toBeLessThanOrEqual(0.95 + 1e-9)
  })
})
