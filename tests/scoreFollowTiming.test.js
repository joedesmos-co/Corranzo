import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { buildMeasureMusicalEvents } from '../src/features/score-follow/cursorMusicalProgress.js'
import { getMeasurePlaybackWindow } from '../src/features/musicxml/performedTimeline.js'
import { FIXTURE_PATHS } from '../src/dev/fixturePaths.js'
import * as F from './helpers/buildXml.js'

const trust = { showCursor: true, needsSetup: false }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const A = (n, x, pe, y = 0.3, se = 0.95) => ({
  id: `m${n}`, page: 1, x, y, measureNumber: n, source: 'manual',
  meta: { playableStartX: x, playableEndX: pe, systemEndX: se },
})
// default-x is an ATTRIBUTE in MusicXML.
const N = (step, oct, dur, type, dx) =>
  `<note default-x="${dx}"><pitch><step>${step}</step><octave>${oct}</octave></pitch>` +
  `<duration>${dur}</duration><voice>1</voice><type>${type}</type></note>`
const ATTR3 =
  `<attributes><divisions>4</divisions><time><beats>3</beats><beat-type>4</beat-type></time>` +
  `<clef><sign>G</sign><line>2</line></clef></attributes>`

function cursorX(timingMap, anchors, t) {
  return resolveScoreFollowCursor({ timingMap, practiceTime: t, trustedAnchors: anchors, trust }).cursor
}

// All note/chord onsets (time, x) for a measure, as the live cursor sees them.
function measureOnsets(timingMap, anchors, m, firstLookup) {
  const w = getMeasurePlaybackWindow(timingMap, m, firstLookup)
  const a = anchors.find((x) => x.measureNumber === m)
  return buildMeasureMusicalEvents(timingMap, m, w, a.x, a.meta.playableEndX)
    .filter((e) => e.kind === 'note' || e.kind === 'chord')
    .map((e) => ({ time: e.timeSeconds, x: e.x }))
}

describe('score-follow timing: cursor is never early at note onsets', () => {
  let hd = null
  let hdAnchors = null
  beforeAll(async () => {
    const zip = await JSZip.loadAsync(
      readFileSync(join(root, 'public', FIXTURE_PATHS.musicXml.replace(/^\//, ''))),
    )
    const container = await zip.file('META-INF/container.xml').async('string')
    const rootfile = container.match(/full-path="([^"]+)"/)[1]
    hd = parseMusicXml(await zip.file(rootfile).async('string'), 'hungarian-dance-no5.mxl')
    hdAnchors = JSON.parse(
      readFileSync(join(root, 'public', FIXTURE_PATHS.demoAnchors.replace(/^\//, '')), 'utf8'),
    ).anchors
  })

  it('Hungarian Dance: the cursor has not reached a notehead before it sounds', () => {
    for (const m of [1, 2, 3, 4, 5, 6]) {
      const onsets = measureOnsets(hd, hdAnchors, m, m === 1 ? 0 : (m - 1) * 0.45)
      for (const onset of onsets) {
        // 40ms before the note sounds, the cursor must be strictly left of it.
        const before = cursorX(hd, hdAnchors, onset.time - 0.04)
        expect(before.x).toBeLessThanOrEqual(onset.x + 1e-4)
        // and it lands on the note (within a small tolerance) at the onset.
        const at = cursorX(hd, hdAnchors, onset.time + 0.001)
        expect(at.x).toBeGreaterThanOrEqual(onset.x - 5e-3)
      }
    }
  })

  it('Hungarian Dance: motion stays monotonic (no backward jump / teleport)', () => {
    let prev = -Infinity
    let sysKey = null
    for (let t = 0.05; t < 3.5; t += 0.02) {
      const c = cursorX(hd, hdAnchors, t)
      const key = `${c.page}:${(c.y ?? 0).toFixed(3)}`
      if (key !== sysKey) {
        sysKey = key
        prev = c.x
        continue
      }
      expect(c.x).toBeGreaterThanOrEqual(prev - 1e-6)
      prev = c.x
    }
  })
})

describe('Gymnopédie-style: bad/backward default-x no longer freezes or jumps back', () => {
  // Grand-staff export where beat 2 is engraved LEFT of beat 1 (non-monotonic
  // default-x). Slow 3/4 @50bpm.
  const xml = F.scoreWrap(
    `<part id="P1">` +
      `<measure number="1">${ATTR3}${F.soundTempo(50)}` +
      `${N('C', 5, 4, 'quarter', 120)}${N('G', 3, 4, 'quarter', 60)}${N('E', 5, 4, 'quarter', 200)}</measure>` +
      `<measure number="2">` +
      `${N('C', 5, 4, 'quarter', 60)}${N('G', 3, 4, 'quarter', 120)}${N('E', 5, 4, 'quarter', 200)}</measure>` +
      `</part>`,
  )
  const timingMap = parseMusicXml(xml)
  const anchors = [A(1, 0.2, 0.42), A(2, 0.42, 0.64)]

  it('falls back to monotonic positions (no collapsed flat span)', () => {
    const onsets = measureOnsets(timingMap, anchors, 1, 0)
    for (let i = 1; i < onsets.length; i += 1) {
      expect(onsets[i].x).toBeGreaterThan(onsets[i - 1].x + 1e-3)
    }
  })

  it('cursor advances monotonically with no backward jump across measure 1', () => {
    let prev = -Infinity
    let backward = 0
    for (let t = 0.02; t < 2.95; t += 0.02) {
      const c = cursorX(timingMap, anchors, t)
      if (c.x < prev - 1e-6) backward += 1
      prev = c.x
    }
    expect(backward).toBe(0)
  })

  it('does not freeze: no long zero-velocity window at the measure start', () => {
    let run = 0
    let maxRun = 0
    let prev = null
    for (let t = 0.02; t < 2.9; t += 0.02) {
      const c = cursorX(timingMap, anchors, t)
      if (prev != null && Math.abs(c.x - prev) < 1e-6) {
        run += 0.02
        maxRun = Math.max(maxRun, run)
      } else {
        run = 0
      }
      prev = c.x
    }
    expect(maxRun).toBeLessThan(0.2)
  })

  it('is not early: 40ms before each onset the cursor is left of the notehead', () => {
    for (const onset of measureOnsets(timingMap, anchors, 1, 0)) {
      const before = cursorX(timingMap, anchors, onset.time - 0.04)
      expect(before.x).toBeLessThanOrEqual(onset.x + 1e-4)
    }
  })
})

describe('slow / open passage stays smooth and on time', () => {
  // 3/4 @48bpm, half-note melody — sparse, clean (monotonic) default-x.
  const xml = F.scoreWrap(
    `<part id="P1">` +
      `<measure number="1">${ATTR3}${F.soundTempo(48)}` +
      `${N('C', 5, 4, 'quarter', 60)}${N('E', 5, 8, 'half', 150)}</measure>` +
      `<measure number="2">` +
      `${N('D', 5, 4, 'quarter', 60)}${N('F', 5, 8, 'half', 150)}</measure>` +
      `</part>`,
  )
  const timingMap = parseMusicXml(xml)
  const anchors = [A(1, 0.2, 0.45), A(2, 0.45, 0.7)]

  it('advances (not frozen) and never overshoots the next onset early', () => {
    const onsets = measureOnsets(timingMap, anchors, 1, 0)
    // moves forward over the measure
    const early = cursorX(timingMap, anchors, 0.2)
    const late = cursorX(timingMap, anchors, 3.0)
    expect(late.x).toBeGreaterThan(early.x + 0.02)
    // not early at the second onset
    const second = onsets[onsets.length - 1]
    const before = cursorX(timingMap, anchors, second.time - 0.05)
    expect(before.x).toBeLessThanOrEqual(second.x + 1e-4)
  })
})
