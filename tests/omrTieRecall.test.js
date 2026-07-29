import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import JSZip from 'jszip'
import { applyVectorPageTies, probeInkArcWindow, crossMeasureInkArcSegments } from '../src/features/omr/detectVectorTies.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  evaluateTieRecall,
  extractVoiceOrderedTiePairs,
  summarizeTieSlurDiagnostics,
} from '../src/features/omr/omrTieRecallAnalysis.js'
import { probeCrossMeasureTiePair, TIE_ARC_CLASS } from '../src/features/omr/omrTieInkArcDiagnostics.js'

const measureBox = {
  measureNumber: 1,
  page: 1,
  x0: 0.1,
  playableX0: 0.2,
  x1: 0.8,
  y0: 0.08,
  y1: 0.42,
}

function blankImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
    data[index + 3] = 255
  }
  return { width, height, data }
}

function setInk(imageData, x, y) {
  const px = Math.round(x)
  const py = Math.round(y)
  const offset = (py * imageData.width + px) * 4
  imageData.data[offset] = 0
  imageData.data[offset + 1] = 0
  imageData.data[offset + 2] = 0
  imageData.data[offset + 3] = 255
}

function drawTieArc(imageData, fromX, toX, y) {
  for (let x = fromX + 4; x <= toX + 8; x += 1) {
    const arcY = y - 4 - Math.round(3 * Math.sin(((x - fromX) / Math.max(1, toX - fromX)) * Math.PI))
    setInk(imageData, x, arcY)
  }
}

/** Synthetic barline-interrupted bows that satisfy current sideCurves coverage. */
function drawBarlineInterruptedArcs(imageData, fromNote, toNote, barX) {
  const y = fromNote.cy
  const leftStart = Math.ceil(fromNote.cx + 10)
  const leftEnd = Math.floor(barX - 8)
  for (let x = leftStart; x <= leftEnd; x += 1) {
    const t = (x - leftStart) / Math.max(1, leftEnd - leftStart)
    setInk(imageData, x, y - 5 - Math.round(5 * Math.sin(t * Math.PI)))
  }
  const rightStart = Math.ceil(barX + 8)
  const rightEnd = Math.floor(toNote.cx - 8)
  for (let x = rightStart; x <= rightEnd; x += 1) {
    const t = (x - rightStart) / Math.max(1, rightEnd - rightStart)
    setInk(imageData, x, y - 5 - Math.round(5 * Math.sin(t * Math.PI)))
  }
  for (let yLine = y - 20; yLine <= y + 20; yLine += 8) {
    setInk(imageData, barX, yLine)
  }
}

function timingFromTiePairs(pairs) {
  const notes = []
  let quarterTime = 0
  for (const pair of pairs) {
    notes.push({
      partId: 'P1',
      voice: 1,
      measureNumber: pair.fromMeasure,
      quarterTime,
      midi: pair.midi,
      tieStart: true,
      tieStop: false,
      isRest: false,
      label: 'A4',
    })
    quarterTime += 1
    notes.push({
      partId: 'P1',
      voice: 1,
      measureNumber: pair.toMeasure,
      quarterTime,
      midi: pair.midi,
      tieStart: false,
      tieStop: true,
      isRest: false,
      label: 'A4',
    })
    quarterTime += 1
  }
  return { notes }
}

describe('tie recall analysis', () => {
  it('extracts voice-ordered tie pairs from a timing map', () => {
    const pairs = extractVoiceOrderedTiePairs(
      timingFromTiePairs([{ fromMeasure: 1, toMeasure: 2, midi: 69 }]),
    )
    expect(pairs).toEqual([
      expect.objectContaining({ fromMeasure: 1, toMeasure: 2, midi: 69 }),
    ])
  })

  it('evaluates recall, misses, and extras', () => {
    const truth = timingFromTiePairs([
      { fromMeasure: 1, toMeasure: 2, midi: 69 },
      { fromMeasure: 3, toMeasure: 4, midi: 71 },
    ])
    const generated = timingFromTiePairs([{ fromMeasure: 1, toMeasure: 2, midi: 69 }])
    const result = evaluateTieRecall({ truthTiming: truth, generatedTiming: generated })
    expect(result.truthCount).toBe(2)
    expect(result.recalledCount).toBe(1)
    expect(result.missedCount).toBe(1)
    expect(result.recall).toBe(0.5)
  })

  it('summarizes slurs as diagnostic-only separate from tie gaps', () => {
    const summary = summarizeTieSlurDiagnostics({
      detectedTieCount: 6,
      appliedTieCount: 6,
      uncertainSlurCount: 164,
      tieControlGlyphCount: 0,
    })
    expect(summary.tieGap).toBe(0)
    expect(summary.uncertainSlurCount).toBe(164)
    expect(summary.slursAreDiagnosticOnly).toBe(true)
  })
})

describe('tie vs slur detector guards', () => {
  it('applies an obvious same-pitch tie when a shallow arc spans the gap', () => {
    const imageData = blankImage(1000, 1000)
    drawTieArc(imageData, 300, 360, 350)
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            cx: 300,
            notes: [{ midi: 74, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            cx: 360,
            notes: [{ midi: 74, clef: 'treble', cx: 360, cy: 350 }],
          },
        ],
      },
    ]

    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, measureBox]]),
      glyphs: [],
      imageData,
      inkThreshold: 170,
    })

    expect(result.diagnostics.appliedTieCount).toBe(1)
    expect(measureRecords[0].events[0].tieStart).toBe(true)
    expect(measureRecords[0].events[1].tieStop).toBe(true)
  })

  it('classifies barline-interrupted synthetic arcs for diagnosis', () => {
    const imageData = blankImage(1000, 1000)
    const fromBox = {
      measureNumber: 9,
      x0: 0.1,
      playableX0: 0.12,
      x1: 0.45,
      y0: 0.08,
      y1: 0.42,
    }
    const toBox = {
      measureNumber: 10,
      x0: 0.45,
      playableX0: 0.47,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
    }
    const fromNote = { measureNumber: 9, midi: 66, clef: 'treble', cx: 420, cy: 350 }
    const toNote = { measureNumber: 10, midi: 66, clef: 'treble', cx: 500, cy: 350 }
    drawBarlineInterruptedArcs(imageData, fromNote, toNote, 450)

    const probe = probeCrossMeasureTiePair(imageData, fromNote, toNote, fromBox, toBox, 170)
    expect(probe.classification).toBe(TIE_ARC_CLASS.BARLINE_INTERRUPTED)
    expect(probe.detectorPasses).toBe(false)
    expect(probe.splitPasses).toBe(true)
  })

  it('probes barline-interrupted arcs with split windows while unified window fails', () => {
    const imageData = blankImage(1000, 1000)
    const fromBox = {
      measureNumber: 9,
      page: 1,
      x0: 0.1,
      playableX0: 0.12,
      x1: 0.45,
      y0: 0.08,
      y1: 0.42,
    }
    const toBox = {
      measureNumber: 10,
      page: 1,
      x0: 0.45,
      playableX0: 0.47,
      x1: 0.8,
      y0: 0.08,
      y1: 0.42,
    }
    const fromNote = { measureNumber: 9, midi: 66, clef: 'treble', cx: 0.42 * imageData.width, cy: 350 }
    const toNote = { measureNumber: 10, midi: 66, clef: 'treble', cx: 0.5 * imageData.width, cy: 350 }
    drawBarlineInterruptedArcs(imageData, fromNote, toNote, 0.45 * imageData.width)

    const unifiedStart = Math.ceil(Math.min(fromNote.cx, toNote.cx) + 8)
    const unifiedEnd = Math.floor(Math.max(fromNote.cx, toNote.cx) - 8)
    const unified = probeInkArcWindow(
      imageData,
      fromNote,
      toNote,
      unifiedStart,
      unifiedEnd,
      fromBox,
      170,
    )
    const segments = crossMeasureInkArcSegments(fromNote, toNote, fromBox, toBox, imageData)
    const left = probeInkArcWindow(
      imageData,
      fromNote,
      toNote,
      segments.seg1Start,
      segments.seg1End,
      fromBox,
      170,
    )
    const right = probeInkArcWindow(
      imageData,
      fromNote,
      toNote,
      segments.seg2Start,
      segments.seg2End,
      toBox,
      170,
    )

    expect(unified.passes).toBe(false)
    expect(left.passes).toBe(true)
    expect(right.passes).toBe(true)
    expect(left.side).toBe(right.side)
  })

  it('does not emit a tie for a slur-like arc between different pitches', () => {
    const imageData = blankImage(1000, 1000)
    drawTieArc(imageData, 300, 360, 350)
    const measureRecords = [
      {
        measureNumber: 1,
        events: [
          {
            type: 'note',
            startDivision: 0,
            durationDivisions: 4,
            cx: 300,
            notes: [{ midi: 74, clef: 'treble', cx: 300, cy: 350 }],
          },
          {
            type: 'note',
            startDivision: 4,
            durationDivisions: 4,
            cx: 360,
            notes: [{ midi: 76, clef: 'treble', cx: 360, cy: 350 }],
          },
        ],
      },
    ]

    const result = applyVectorPageTies({
      measureRecords,
      measureBoxByNumber: new Map([[1, measureBox]]),
      glyphs: [],
      imageData,
      inkThreshold: 170,
    })

    expect(result.diagnostics.appliedTieCount).toBe(0)
    expect(result.diagnostics.appliedSlurCount).toBeGreaterThan(0)
    expect(measureRecords[0].events[0].tieStart).toBeUndefined()
    expect(measureRecords[0].events[1].tieStop).toBeUndefined()
    expect(measureRecords[0].events[0].slurStart).toBe(true)
    expect(measureRecords[0].events[1].slurStop).toBe(true)
  })
})

describe('Gymnopédie tie recall benchmark pin', () => {
  const gymTruthPath = join(homedir(), 'Downloads/gymnopedie-no-1-satie.mxl')
  const cleanFixturePath = join(
    process.cwd(),
    'tmp/omr-benchmark-dashboard/fixtures/clean.json',
  )
  const simpleFixturePath = join(
    process.cwd(),
    'tmp/omr-benchmark-dashboard/fixtures/simple.json',
  )

  it('pins Gymnopédie recall at 6/14 when local truth MXL is available', async () => {
    if (!existsSync(gymTruthPath) || !existsSync(cleanFixturePath)) {
      return
    }

    const zip = await JSZip.loadAsync(readFileSync(gymTruthPath))
    const xmlName = Object.keys(zip.files).find(
      (entry) => entry.endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
    const truthTiming = parseMusicXml(await zip.file(xmlName).async('string'), 'gym-truth')
    const clean = JSON.parse(readFileSync(cleanFixturePath, 'utf8'))
    const applied = clean.generatedOmrDiagnostics?.ties?.appliedTiePairs ?? []

    const recall = evaluateTieRecall({
      truthTiming,
      appliedTiePairs: applied,
    })

    expect(recall.truthCount).toBe(14)
    expect(recall.appliedRecalledCount).toBe(6)
    expect(recall.appliedRecall).toBeCloseTo(6 / 14, 3)
    expect(recall.appliedMissed.map((pair) => pair.fromMeasure)).toEqual(
      expect.arrayContaining([9, 10, 11, 19, 20, 25, 30, 64]),
    )
  })

  it('keeps Twinkle false ties at zero in the benchmark fixture', () => {
    if (!existsSync(simpleFixturePath)) {
      return
    }
    const simple = JSON.parse(readFileSync(simpleFixturePath, 'utf8'))
    const ties = simple.generatedOmrDiagnostics?.ties ?? {}
    expect(ties.appliedTieCount).toBe(0)
    expect(ties.detectedTieCount).toBe(0)
    expect(ties.uncertainSlurCount).toBe(0)
  })
})
