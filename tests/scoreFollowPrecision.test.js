/**
 * Score Follow Precision v2 — cursor locked to note onsets and audio clock.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  resolveScoreFollowCursor,
  START_LOCK_THRESHOLD_SECONDS,
} from '../src/features/score-follow/resolveScoreFollowCursor.js'
import {
  buildMeasureMusicalEvents,
  resolveMusicalXInMeasure,
} from '../src/features/score-follow/cursorMusicalProgress.js'
import { buildMeasureBoundaryDiagnostic } from '../src/features/score-follow/measureBoundaryDiagnostics.js'
import { buildHeldNoteDiagnostic } from '../src/features/score-follow/heldNoteDiagnostics.js'
import { measureCursorOnsetAlignment } from '../src/features/score-follow/scoreFollowPrecisionDiagnostics.js'
import { filterTrustedAnchors } from '../src/features/score-follow/trustedAnchors.js'
import { FIXTURE_PATHS } from '../src/dev/fixturePaths.js'
import * as F from './helpers/buildXml.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(root, 'public')

function fixturePath(urlPath) {
  return join(publicRoot, urlPath.replace(/^\//, ''))
}

function anchorsForMeasures(count, { playableSpan = 0.12 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const measureNumber = index + 1
    const x = 0.1 + index * 0.18
    return {
      id: `m${measureNumber}`,
      page: 1,
      x,
      y: 0.3,
      measureNumber,
      source: 'manual',
      meta: {
        role: 'measure',
        measureStartX: x - 0.02,
        playableStartX: x,
        playableEndX: x + playableSpan,
        systemEndX: 0.95,
      },
    }
  })
}

describe('cursorMusicalProgress', () => {
  it('maps note onsets to distinct x positions inside a measure', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">
          <measure number="1">
            ${F.attributes({ divisions: 4 })}
            ${F.soundTempo(120)}
            <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="80"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="120"><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="160"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
          </measure>
        </part>`,
      ),
    )

    const events = buildMeasureMusicalEvents(timingMap, 1, {
      startTimeSeconds: 0,
      endTimeSeconds: 2,
    }, 0.2, 0.5)

    const noteEvents = events.filter((event) => event.kind === 'note')
    expect(noteEvents.length).toBe(4)
    const xs = noteEvents.map((event) => event.x)
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]).toBeGreaterThan(xs[index - 1])
    }
  })

  it('reaches note x exactly at onset time (continuous interpolation)', () => {
    const timingMap = parseMusicXml(F.straight4())
    const musical = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: 0.5,
      measureNumber: 1,
      xStart: 0.1,
      xEnd: 0.35,
    })
    expect(musical.atOnset).toBe(true)
    expect(musical.mode).toBe('note-interpolate')
    const justBefore = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: 0.49,
      measureNumber: 1,
      xStart: 0.1,
      xEnd: 0.35,
    })
    expect(justBefore.x).toBeLessThan(musical.x)
  })

  it('inserts hold-end knots for half notes and longer', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">
          <measure number="1">
            ${F.attributes({ divisions: 4 })}
            ${F.soundTempo(120)}
            <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>
            <note default-x="120"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="160"><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
          </measure>
        </part>`,
      ),
    )
    const events = buildMeasureMusicalEvents(
      timingMap,
      1,
      { startTimeSeconds: 0, endTimeSeconds: 2 },
      0.1,
      0.35,
    )
    expect(events.some((event) => event.kind === 'hold-end')).toBe(true)
  })

  it('keeps cursor at the notehead during a held-note plateau', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">
          <measure number="1">
            ${F.attributes({ divisions: 4 })}
            ${F.soundTempo(120)}
            <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>
            <note default-x="120"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="160"><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
          </measure>
        </part>`,
      ),
    )
    const atOnset = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: 0,
      measureNumber: 1,
      xStart: 0.1,
      xEnd: 0.35,
    })
    const midHold = resolveMusicalXInMeasure({
      timingMap,
      practiceTime: 0.35,
      measureNumber: 1,
      xStart: 0.1,
      xEnd: 0.35,
    })
    expect(midHold.mode).toBe('held-note')
    expect(midHold.x).toBeCloseTo(atOnset.x, 4)
  })

  it('does not overshoot the next onset x before the next note begins', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">
          <measure number="1">
            ${F.attributes({ divisions: 4 })}
            ${F.soundTempo(120)}
            <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>
            <note default-x="120"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="160"><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
          </measure>
        </part>`,
      ),
    )
    const events = buildMeasureMusicalEvents(
      timingMap,
      1,
      { startTimeSeconds: 0, endTimeSeconds: 2 },
      0.1,
      0.35,
    )
    const nextQuarter = events.find(
      (event, index) => event.kind === 'note' && index > 0,
    )
    let maxOvershoot = 0
    for (let t = 0.05; t < nextQuarter.timeSeconds - 0.01; t += 0.03) {
      const musical = resolveMusicalXInMeasure({
        timingMap,
        practiceTime: t,
        measureNumber: 1,
        xStart: 0.1,
        xEnd: 0.35,
      })
      maxOvershoot = Math.max(maxOvershoot, musical.x - nextQuarter.x)
    }
    expect(maxOvershoot).toBeLessThan(0.001)
  })
})

describe('resolveScoreFollowCursor precision', () => {
  const timingMap = parseMusicXml(F.straight4())
  const anchors = anchorsForMeasures(4)

  it('start-locks briefly then releases before first quarter note at 120bpm', () => {
    const locked = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
    })
    expect(locked.cursor.lockExact).toBe(true)

    const afterLock = resolveScoreFollowCursor({
      timingMap,
      practiceTime: START_LOCK_THRESHOLD_SECONDS + 0.02,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
    })
    expect(afterLock.cursor.lockExact).toBe(false)
    expect(afterLock.cursor.interpolated).toBe(true)
  })

  it('aligns cursor x to note onsets within snap window', () => {
    const report = measureCursorOnsetAlignment({
      timingMap,
      trustedAnchors: anchors,
    })
    expect(report.sampleCount).toBeGreaterThan(0)
    expect(report.averageErrorX).toBeLessThan(0.02)
    expect(report.maxErrorX).toBeLessThan(0.02)
    const snapped = report.samples.filter((sample) => sample.atOnset)
    expect(snapped.length).toBeGreaterThan(0)
  })

  it('advances x monotonically inside a measure (no backward jitter)', () => {
    const samples = []
    for (let t = 0.06; t <= 2; t += 0.05) {
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: anchors,
        trust: { showCursor: true, needsSetup: false },
      })
      if (cursor.visible && cursor.measureNumber === 1) {
        samples.push(cursor.x)
      }
    }
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1] - 0.0001)
    }
  })

  it('does not hold at playableEndX after the last note before the barline', () => {
    const tail = []
    for (let t = 1.52; t < 2; t += 0.04) {
      const { cursor } = resolveScoreFollowCursor({
        timingMap,
        practiceTime: t,
        trustedAnchors: anchors,
        trust: { showCursor: true, needsSetup: false },
      })
      expect(cursor.measureNumber).toBe(1)
      tail.push(cursor.x)
    }
    expect(tail[tail.length - 1] - tail[0]).toBeGreaterThan(0.002)
    for (let index = 1; index < tail.length; index += 1) {
      expect(tail[index]).toBeGreaterThanOrEqual(tail[index - 1] - 0.0001)
    }
    const atDownbeat2 = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 2,
      trustedAnchors: anchors,
      trust: { showCursor: true, needsSetup: false },
    }).cursor
    expect(atDownbeat2.measureNumber).toBe(2)
    expect(atDownbeat2.x).toBeCloseTo(anchors[1].x, 3)
  })

  it('uses velocity-continuous tail when last onset x is near playableEndX', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">
          <measure number="1">
            ${F.attributes({ divisions: 4 })}
            ${F.soundTempo(120)}
            <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="80"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="120"><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="200"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
          </measure>
          <measure number="2">${F.fourQuarters()}</measure>
        </part>`,
      ),
    )
    const tightAnchors = [
      {
        id: 'm1',
        page: 1,
        x: 0.1,
        y: 0.3,
        measureNumber: 1,
        source: 'manual',
        meta: { playableStartX: 0.1, playableEndX: 0.22, systemEndX: 0.95 },
      },
      {
        id: 'm2',
        page: 1,
        x: 0.22,
        y: 0.3,
        measureNumber: 2,
        source: 'manual',
        meta: { playableStartX: 0.22, playableEndX: 0.34, systemEndX: 0.95 },
      },
    ]
    const atLast = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.5,
      trustedAnchors: tightAnchors,
      trust: { showCursor: true, needsSetup: false },
    }).cursor
    const lateTail = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 1.88,
      trustedAnchors: tightAnchors,
      trust: { showCursor: true, needsSetup: false },
    }).cursor
    expect(lateTail.x).toBeGreaterThan(atLast.x + 0.003)
    expect(lateTail.progressMode).toBe('velocity-bridge')

    const diag = buildMeasureBoundaryDiagnostic({
      timingMap,
      trustedAnchors: tightAnchors,
      measureNumber: 1,
    })
    expect(diag.active).toBe(true)
    expect(diag.velocities.stallRatio).toBeLessThan(0.45)
    expect(diag.lastOnset.distanceToPlayableEndX).toBeLessThan(0.02)
  })

  it('defers page flip until late in the gap (no early cross-page jump)', () => {
    const crossPage = [
      {
        id: 'p1m1',
        page: 1,
        x: 0.1,
        y: 0.3,
        measureNumber: 1,
        source: 'manual',
        meta: { playableEndX: 0.22 },
      },
      {
        id: 'p2m3',
        page: 2,
        x: 0.1,
        y: 0.3,
        measureNumber: 3,
        source: 'manual',
        meta: { playableEndX: 0.22 },
      },
    ]
    const midGap = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 3,
      trustedAnchors: crossPage,
      trust: { showCursor: true, needsSetup: false },
    })
    expect(midGap.cursor.page).toBe(1)
    expect(midGap.cursor.interpolated).toBe(true)

    const lateGap = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 3.85,
      trustedAnchors: crossPage,
      trust: { showCursor: true, needsSetup: false },
    })
    expect(lateGap.cursor.page).toBe(2)
  })

  it('uses note-weighted progress for uneven beats (not linear measure sweep)', () => {
    const uneven = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">
          <measure number="1">
            ${F.attributes({ divisions: 4 })}
            ${F.soundTempo(120)}
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>
            <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
          </measure>
        </part>`,
      ),
    )
    const unevenAnchors = anchorsForMeasures(1, { playableSpan: 0.2 })

    const atHalfNoteEnd = resolveScoreFollowCursor({
      timingMap: uneven,
      practiceTime: 1,
      trustedAnchors: unevenAnchors,
      trust: { showCursor: true, needsSetup: false },
    })
    const linearWouldBe = 0.1 + 0.2 * 0.5
    expect(atHalfNoteEnd.cursor.x).toBeLessThan(linearWouldBe + 0.02)
    expect(atHalfNoteEnd.cursor.progressMode).toMatch(/note|chord|beat|held/)
  })

  it('held-note measures stay monotonic with no early overshoot', () => {
    const uneven = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">
          <measure number="1">
            ${F.attributes({ divisions: 4 })}
            ${F.soundTempo(120)}
            <note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>
            <note default-x="120"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
            <note default-x="160"><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
          </measure>
        </part>`,
      ),
    )
    const unevenAnchors = anchorsForMeasures(1, { playableSpan: 0.2 })
    const xs = []
    for (let t = 0.04; t < 2; t += 0.04) {
      const { cursor } = resolveScoreFollowCursor({
        timingMap: uneven,
        practiceTime: t,
        trustedAnchors: unevenAnchors,
        trust: { showCursor: true, needsSetup: false },
      })
      xs.push(cursor.x)
    }
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]).toBeGreaterThanOrEqual(xs[index - 1] - 0.0001)
    }

    const diag = buildHeldNoteDiagnostic({
      timingMap: uneven,
      trustedAnchors: unevenAnchors,
      measureNumber: 1,
    })
    expect(diag.active).toBe(true)
    expect(diag.maxOvershoot).toBeLessThan(0.001)
    expect(diag.maxBacktrack).toBeLessThan(0.001)
  })
})

describe('Hungarian Dance note-onset alignment', () => {
  async function loadMxlTimingMap(mxlPath) {
    const zip = await JSZip.loadAsync(readFileSync(mxlPath))
    const container = zip.file('META-INF/container.xml')
    let rootPath = null
    if (container) {
      const match = (await container.async('string')).match(/full-path="([^"]+)"/)
      rootPath = match?.[1] ?? null
    }
    if (!rootPath || !zip.file(rootPath)) {
      rootPath = Object.keys(zip.files).find(
        (name) => name.endsWith('.xml') && !name.startsWith('META-INF'),
      )
    }
    const xml = await zip.file(rootPath).async('string')
    return parseMusicXml(xml, 'hungarian-dance-no5.mxl')
  }

  it('bundled demo anchors keep low onset error on sampled measures', async () => {
    const anchorsPath = fixturePath(FIXTURE_PATHS.demoAnchors)
    const mxlPath = fixturePath(FIXTURE_PATHS.musicXml)
    if (!existsSync(anchorsPath) || !existsSync(mxlPath)) {
      return
    }

    const payload = JSON.parse(readFileSync(anchorsPath, 'utf8'))
    const trusted = filterTrustedAnchors(payload.anchors)
    const timingMap = await loadMxlTimingMap(mxlPath)

    const report = measureCursorOnsetAlignment({
      timingMap,
      trustedAnchors: trusted,
      sampleEvery: 8,
    })

    expect(report.sampleCount).toBeGreaterThan(10)
    expect(report.averageErrorX).toBeLessThan(0.04)
    expect(report.maxErrorX).toBeLessThan(0.12)

    const heldMeasures = [5, 9, 13, 17, 21, 25, 29, 33]
    for (const measureNumber of heldMeasures) {
      const held = buildHeldNoteDiagnostic({
        timingMap,
        trustedAnchors: trusted,
        measureNumber,
      })
      if (!held.active) {
        continue
      }
      expect(held.maxOvershoot).toBeLessThan(0.02)
      expect(held.maxBacktrack).toBeLessThan(0.02)
    }
  })
})
