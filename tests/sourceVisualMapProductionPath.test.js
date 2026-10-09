import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import {
  buildOmrSourceVisualMap,
  normalizeOmrSourceVisualMap,
  restoreOmrSourcePdfGeometry,
  sourceCenterAndBox,
  SOURCE_VISUAL_COORDINATE_SPACE,
  SOURCE_VISUAL_REPRESENTATION,
} from '../src/features/omr/omrSourceVisualMap.js'
import {
  NOTE_TARGET_SOURCE,
  resolveNoteTargetPosition,
} from '../src/features/practice/noteTargetPosition.js'
import {
  buildNoteCheckpoints,
  CHECKPOINT_KIND,
} from '../src/features/practice/waitForYouCheckpoints.js'
import {
  getPlayAlongVisualEvents,
  resolvePlayAlongVisualCheckpoint,
} from '../src/features/practice/playAlongVisualTarget.js'
import {
  evaluateSourceVisualSample,
  summarizeSourceVisualMetrics,
} from './helpers/sourceVisualMetrics.js'

const PAGE_WIDTH = 1000
const PAGE_HEIGHT = 1400
const STAFF_GAP = 0.01

function sourceNote({
  midi,
  x,
  y,
  width = 0.014,
  height = 0.009,
  confidence = 0.96,
  clef = 'treble',
  voice = 1,
  ...overrides
}) {
  return {
    midi,
    clef,
    voice,
    xNorm: x,
    yNorm: y,
    sourcePageWidth: PAGE_WIDTH,
    sourcePageHeight: PAGE_HEIGHT,
    sourceBBox: {
      x0: x - width / 2,
      y0: y - height / 2,
      x1: x + width / 2,
      y1: y + height / 2,
    },
    confidence,
    noteheadAnchor: {
      confidence,
      localStaffGapNorm: STAFF_GAP,
    },
    ...overrides,
  }
}

function noteEvent({
  startDivision = 0,
  durationDivisions = 4,
  voice = 1,
  notes,
}) {
  return {
    type: 'note',
    startDivision,
    durationDivisions,
    durationType: durationDivisions === 2 ? 'eighth' : 'quarter',
    voice,
    notes,
  }
}

function measure(measureNumber, events, overrides = {}) {
  return {
    measureNumber,
    page: overrides.page ?? 1,
    systemIndex: overrides.systemIndex ?? 0,
    events,
    ...overrides,
  }
}

function scoreAnchors() {
  return [
    {
      id: 'm1',
      page: 1,
      x: 0.08,
      y: 0.35,
      measureNumber: 1,
      source: 'manual',
      meta: { playableStartX: 0.08, playableEndX: 0.48, systemEndX: 0.92 },
    },
    {
      id: 'm2',
      page: 1,
      x: 0.52,
      y: 0.35,
      measureNumber: 2,
      source: 'manual',
      meta: { playableStartX: 0.52, playableEndX: 0.92, systemEndX: 0.92 },
    },
  ]
}

function checkpoint(notes, overrides = {}) {
  return {
    id: overrides.id ?? 'source-checkpoint',
    kind:
      notes.length > 2
        ? CHECKPOINT_KIND.CHORD
        : notes.length === 2
          ? CHECKPOINT_KIND.DOUBLE_STOP
          : CHECKPOINT_KIND.NOTE,
    measureNumber: notes[0]?.measureNumber ?? 1,
    timeSeconds: notes[0]?.timeSeconds ?? 0,
    expectedMidis: notes.map((note) => note.midi),
    notes,
    isChord: notes.length > 1,
    ...overrides,
  }
}

function buildAndParse(measures) {
  const sourceVisualMap = buildOmrSourceVisualMap(measures)
  const musicXml = buildOmrMusicXml({
    measures,
    includeDisclaimer: false,
    musical: {
      tempo: { bpm: 120, confidence: 0.99 },
      timeSignature: { beats: 4, beatType: 4, confidence: 0.99 },
      keySignature: { fifths: 0, mode: 'major', confidence: 0.99 },
    },
  })
  return {
    sourceVisualMap,
    musicXml,
    timingMap: parseMusicXml(musicXml, 'source-visual-production.musicxml'),
  }
}

function anchorById(sourceVisualMap, id) {
  return sourceVisualMap.anchors.find((anchor) => anchor.sourceNoteheadId === id)
}

describe('source visual map production path', () => {
  it('builds deterministic stable IDs and normalized source-page geometry', () => {
    const measures = [
      measure(
        7,
        [
          noteEvent({
            startDivision: 2,
            notes: [sourceNote({ midi: 60, x: 0.312, y: 0.427 })],
          }),
        ],
        { page: 3, systemIndex: 2 },
      ),
    ]

    const first = buildOmrSourceVisualMap(measures)
    const second = buildOmrSourceVisualMap(measures)

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      schemaVersion: 1,
      coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
      anchorCount: 1,
    })
    expect(first.anchors[0]).toMatchObject({
      page: 3,
      systemIndex: 2,
      measureNumber: 7,
      midi: 60,
      voice: 1,
      representation: SOURCE_VISUAL_REPRESENTATION.NOTATION,
      sourceCenter: {
        x: 0.312,
        y: 0.427,
        coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
      },
      staffGap: STAFF_GAP,
    })
    expect(first.anchors[0].sourceNoteheadId).toMatch(/^sfnh-/)
    expect(first.anchors[0].sourceEventId).toMatch(/^sfve-/)
    expect(first.anchors[0].sourceBBox).toMatchObject({
      coordinateSpace: SOURCE_VISUAL_COORDINATE_SPACE,
    })
    expect(normalizeOmrSourceVisualMap(JSON.parse(JSON.stringify(first)))).toEqual(first)
  })

  it('keeps exact vector-glyph visual confidence independent of semantic pitch', () => {
    const inkOwned = sourceNote({
      midi: 60,
      x: 0.31,
      y: 0.36,
      confidence: 0.18,
      pitchConfidence: 0.12,
      source: 'vector-glyph',
      noteheadAnchor: {
        confidence: 0.94,
        localStaffGapNorm: STAFF_GAP,
      },
    })
    const centerOnly = sourceNote({
      midi: 62,
      x: 0.44,
      y: 0.35,
      confidence: 0.16,
      pitchConfidence: 0.1,
      source: 'vector-glyph',
      sourceBBox: null,
      noteheadAnchor: {
        source: 'glyph-metrics-fallback',
        confidence: 0.45,
        localStaffGapNorm: STAFF_GAP,
        yNorm: 0.35,
        visualBounds: null,
      },
    })
    const sourceVisualMap = buildOmrSourceVisualMap([
      measure(1, [
        noteEvent({ startDivision: 0, notes: [inkOwned] }),
        noteEvent({ startDivision: 4, notes: [centerOnly] }),
      ]),
    ])
    const byMidi = new Map(
      sourceVisualMap.anchors.map((anchor) => [anchor.midi, anchor]),
    )

    expect(byMidi.get(60)).toMatchObject({
      confidence: 0.94,
      geometrySource: 'source-bbox',
    })
    expect(byMidi.get(62)).toMatchObject({
      confidence: 0.78,
      geometrySource: 'source-notehead-center',
    })
  })

  it('keeps source-notehead IDs stable when semantic event order changes', () => {
    const buildMeasures = (reverse = false) => {
      const events = [
        noteEvent({
          startDivision: 0,
          notes: [sourceNote({ midi: 60, x: 0.22, y: 0.36 })],
        }),
        noteEvent({
          startDivision: 4,
          notes: [sourceNote({ midi: 62, x: 0.38, y: 0.35 })],
        }),
      ]
      return [measure(1, reverse ? [...events].reverse() : events)]
    }
    const byCenter = (sourceVisualMap) =>
      Object.fromEntries(
        sourceVisualMap.anchors.map((anchor) => [
          `${anchor.sourceCenter.x}:${anchor.sourceCenter.y}`,
          anchor.sourceNoteheadId,
        ]),
      )

    expect(byCenter(buildOmrSourceVisualMap(buildMeasures(true)))).toEqual(
      byCenter(buildOmrSourceVisualMap(buildMeasures(false))),
    )
  })

  it('deduplicates one printed unison head shared by semantic voice events', () => {
    const upperVoice = sourceNote({ midi: 60, x: 0.3, y: 0.36, voice: 1 })
    const lowerVoice = sourceNote({ midi: 60, x: 0.3, y: 0.36, voice: 2 })
    const measures = [
      measure(1, [
        noteEvent({ voice: 1, notes: [upperVoice] }),
        noteEvent({ voice: 2, notes: [lowerVoice] }),
      ]),
    ]
    const { sourceVisualMap, timingMap } = buildAndParse(measures)

    expect(upperVoice.sourceNoteheadId).toBe(lowerVoice.sourceNoteheadId)
    expect(sourceVisualMap.anchorCount).toBe(1)
    expect(sourceVisualMap.anchors).toHaveLength(1)
    expect(sourceVisualMap.anchors[0].sourceEventIds).toHaveLength(2)

    const parsedUnison = timingMap.notes.filter((note) => note.sourceNoteheadId)
    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint(parsedUnison),
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap,
    })
    expect(target.highlight.noteBoxes).toHaveLength(1)
    expect(target.highlight.sourceNoteheadIds).toHaveLength(1)
  })

  it('round-trips source-notehead lineage through MusicXML serialization and parse', () => {
    const measures = [
      measure(1, [
        noteEvent({
          notes: [
            sourceNote({ midi: 60, x: 0.2, y: 0.34 }),
            sourceNote({ midi: 64, x: 0.2, y: 0.31 }),
          ],
        }),
      ]),
    ]
    const { sourceVisualMap, musicXml, timingMap } = buildAndParse(measures)
    const expectedIds = sourceVisualMap.anchors.map((anchor) => anchor.sourceNoteheadId)

    for (const id of expectedIds) {
      expect(musicXml).toContain(`<note id="${id}">`)
    }
    expect(
      timingMap.notes
        .filter((note) => !note.isRest)
        .map((note) => note.sourceNoteheadId),
    ).toEqual(expectedIds)
  })

  it('highlights only the selected chord event and preserves individual boxes', () => {
    const chordNotes = [
      sourceNote({ midi: 60, x: 0.3, y: 0.36, voice: 1 }),
      sourceNote({ midi: 64, x: 0.3, y: 0.32, voice: 1 }),
    ]
    const neighboringVoice = sourceNote({
      midi: 55,
      x: 0.304,
      y: 0.48,
      voice: 2,
    })
    const { sourceVisualMap, timingMap } = buildAndParse([
      measure(1, [
        noteEvent({ voice: 1, notes: chordNotes }),
        noteEvent({ voice: 2, notes: [neighboringVoice] }),
      ]),
    ])
    const chordEventId = sourceVisualMap.anchors[0].sourceEventId
    const expectedAnchors = sourceVisualMap.anchors.filter(
      (anchor) => anchor.sourceEventId === chordEventId,
    )
    const neighborAnchor = sourceVisualMap.anchors.find(
      (anchor) => anchor.sourceEventId !== chordEventId,
    )
    const parsedChordNotes = expectedAnchors.map((anchor) =>
      timingMap.notes.find((note) => note.sourceNoteheadId === anchor.sourceNoteheadId),
    )

    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint(parsedChordNotes),
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap,
    })

    expect(expectedAnchors.map((anchor) => anchor.voice)).toEqual([1, 1])
    expect(neighborAnchor.voice).toBe(2)
    expect(target.source).toBe(NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD)
    expect(target.highlight).toMatchObject({
      preciseSource: true,
      renderMode: 'individual-source-boxes',
      noteCount: 2,
    })
    expect([...target.highlight.sourceNoteheadIds].sort()).toEqual(
      expectedAnchors.map((anchor) => anchor.sourceNoteheadId).sort(),
    )
    expect(target.highlight.sourceNoteheadIds).not.toContain(
      neighborAnchor.sourceNoteheadId,
    )
    // Individual boxes carry their tone identity (MIDI + notehead id) so
    // chord partials can color completed tones without re-resolving.
    expect(target.highlight.noteBoxes).toEqual(
      expectedAnchors.map((anchor) => ({
        ...anchor.sourceBBox,
        midi: anchor.midi,
        sourceNoteheadId: anchor.sourceNoteheadId,
      })),
    )
  })

  it('skips tied continuations in WFY while Play Along moves to their printed head', () => {
    const measures = [
      measure(1, [
        noteEvent({
          notes: [
            sourceNote({ midi: 60, x: 0.2, y: 0.34, tieStart: true }),
          ],
        }),
      ]),
      measure(2, [
        noteEvent({
          notes: [
            sourceNote({ midi: 60, x: 0.68, y: 0.34, tieStop: true }),
          ],
        }),
      ]),
    ]
    const { sourceVisualMap, timingMap } = buildAndParse(measures)
    const [attackAnchor, continuationAnchor] = sourceVisualMap.anchors

    const wfyCheckpoints = buildNoteCheckpoints(timingMap)
    expect(wfyCheckpoints).toHaveLength(1)
    expect(wfyCheckpoints[0].notes[0].sourceNoteheadId).toBe(
      attackAnchor.sourceNoteheadId,
    )
    const wfyTarget = resolveNoteTargetPosition({
      checkpoint: wfyCheckpoints[0],
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap,
      mode: 'wait-for-you',
    })

    const playEvents = getPlayAlongVisualEvents(timingMap)
    const continuationEvent = playEvents.find((event) => event.isTiedContinuation)
    expect(continuationEvent).toBeTruthy()
    expect(continuationEvent.sourceNoteheadIds).toEqual([
      continuationAnchor.sourceNoteheadId,
    ])
    expect(
      resolvePlayAlongVisualCheckpoint(
        timingMap,
        continuationEvent.timeSeconds + 0.01,
      ).id,
    ).toBe(continuationEvent.id)
    const playTarget = resolveNoteTargetPosition({
      checkpoint: continuationEvent,
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap,
      mode: 'play-along',
    })

    expect(wfyTarget.highlight.sourceNoteheadIds).toEqual([
      attackAnchor.sourceNoteheadId,
    ])
    expect(playTarget.highlight.sourceNoteheadIds).toEqual([
      continuationAnchor.sourceNoteheadId,
    ])
    expect(playTarget.noteAnchorY).toBeCloseTo(continuationAnchor.sourceCenter.y, 6)
    expect(playTarget.x).toBeGreaterThan(wfyTarget.x)
  })

  it('reuses written source IDs and geometry on every performed repeat pass', () => {
    const measures = [
      measure(
        1,
        [noteEvent({ notes: [sourceNote({ midi: 60, x: 0.2, y: 0.34 })] })],
        {
          repeatMarking: {
            forwardRepeat: true,
            confidence: 0.92,
            source: 'vector-path',
          },
        },
      ),
      measure(
        2,
        [noteEvent({ notes: [sourceNote({ midi: 62, x: 0.68, y: 0.34 })] })],
        {
          repeatMarking: {
            backwardRepeat: true,
            confidence: 0.92,
            source: 'vector-path',
          },
        },
      ),
    ]
    const { sourceVisualMap, timingMap } = buildAndParse(measures)
    const repeatedId = sourceVisualMap.anchors[0].sourceNoteheadId
    const passes = getPlayAlongVisualEvents(timingMap).filter(
      (event) => event.sourceNoteheadIds[0] === repeatedId,
    )

    expect(passes).toHaveLength(2)
    expect(passes.map((event) => event.repeatPass)).toEqual([1, 2])
    const targets = passes.map((event) =>
      resolveNoteTargetPosition({
        checkpoint: event,
        timingMap,
        anchors: scoreAnchors(),
        sourceVisualMap,
        mode: 'play-along',
      }),
    )
    expect(targets[0].highlight.sourceNoteheadIds).toEqual([repeatedId])
    expect(targets[1].highlight.sourceNoteheadIds).toEqual([repeatedId])
    expect(targets[1].highlight.noteBoxes).toEqual(targets[0].highlight.noteBoxes)
  })

  it('selects notation or TAB geometry without changing semantic ownership', () => {
    const paired = sourceNote({
      midi: 64,
      x: 0.28,
      y: 0.3,
      string: 1,
      fret: 0,
      notationTabPairConfidence: 0.94,
      tabSourceVisual: {
        xNorm: 0.282,
        yNorm: 0.71,
        sourcePageWidth: PAGE_WIDTH,
        sourcePageHeight: PAGE_HEIGHT,
        sourceBBox: {
          x0: 0.272,
          y0: 0.7,
          x1: 0.292,
          y1: 0.72,
        },
      },
    })
    const { sourceVisualMap, timingMap } = buildAndParse([
      measure(1, [noteEvent({ notes: [paired] })]),
    ])
    const parsedNote = timingMap.notes.find((note) => note.sourceNoteheadId)
    const noteCheckpoint = checkpoint([parsedNote])
    const notationTarget = resolveNoteTargetPosition({
      checkpoint: noteCheckpoint,
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap,
      preferredRepresentation: SOURCE_VISUAL_REPRESENTATION.NOTATION,
    })
    const tabTarget = resolveNoteTargetPosition({
      checkpoint: noteCheckpoint,
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap,
      preferredRepresentation: SOURCE_VISUAL_REPRESENTATION.TAB,
    })

    expect(sourceVisualMap.anchors[0].alternates).toHaveLength(1)
    expect(notationTarget.highlight.representation).toBe(
      SOURCE_VISUAL_REPRESENTATION.NOTATION,
    )
    expect(tabTarget.highlight.representation).toBe(
      SOURCE_VISUAL_REPRESENTATION.TAB,
    )
    expect(tabTarget.highlight.sourceNoteheadIds).toEqual(
      notationTarget.highlight.sourceNoteheadIds,
    )
    expect(tabTarget.noteAnchorY).toBeCloseTo(0.71, 6)
    expect(notationTarget.noteAnchorY).toBeCloseTo(0.3, 6)
  })

  it('uses fret-token geometry as the canonical representation for TAB-only notes', () => {
    const tabOnly = sourceNote({
      midi: 67,
      x: 0.4,
      y: 0.72,
      string: 1,
      fret: 3,
      sourceVisualKind: 'tab-fret',
    })
    const sourceVisualMap = buildOmrSourceVisualMap([
      measure(1, [noteEvent({ notes: [tabOnly] })]),
    ])

    expect(sourceVisualMap.anchors[0]).toMatchObject({
      kind: 'tab-fret',
      representation: SOURCE_VISUAL_REPRESENTATION.TAB,
      sourceCenter: { x: 0.4, y: 0.72 },
    })
  })

  it('uses a vector glyph box when no explicit or ink-derived notehead box exists', () => {
    const geometry = sourceCenterAndBox({
      sourcePageWidth: 1000,
      sourcePageHeight: 1400,
      glyphBBox: { x: 250, y: 420, width: 20, height: 14 },
    })

    expect(geometry).toMatchObject({
      geometrySource: 'glyph-font-bbox',
      sourceBBox: {
        x0: 0.25,
        y0: 0.3,
        x1: 0.27,
        y1: 0.31,
      },
      sourceCenter: { x: 0.26, y: 0.305 },
    })
  })

  it('falls back the whole chord when any member lacks source ownership', () => {
    const notes = [
      sourceNote({ midi: 60, x: 0.3, y: 0.36 }),
      sourceNote({ midi: 64, x: 0.3, y: 0.32 }),
    ]
    const { sourceVisualMap, timingMap } = buildAndParse([
      measure(1, [noteEvent({ notes })]),
    ])
    const incompleteMap = normalizeOmrSourceVisualMap({
      anchors: [sourceVisualMap.anchors[0]],
    })
    const parsedNotes = timingMap.notes.filter((note) => note.sourceNoteheadId)

    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint(parsedNotes),
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap: incompleteMap,
    })

    expect(target.source).not.toBe(NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD)
    expect(target.sourceAnchors).toEqual([])
    expect(target.highlight?.preciseSource).not.toBe(true)
    expect(target.coordinateSpace).toBe('pdf-analysis-normalized')
  })

  it('abstains from precise source geometry when ownership confidence is low', () => {
    const lowConfidenceNote = sourceNote({
      midi: 60,
      x: 0.82,
      y: 0.74,
      confidence: 0.2,
    })
    const { sourceVisualMap, timingMap } = buildAndParse([
      measure(1, [noteEvent({ notes: [lowConfidenceNote] })]),
    ])
    const parsedNote = timingMap.notes.find((note) => note.sourceNoteheadId)

    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint([parsedNote]),
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap,
    })

    expect(sourceVisualMap.anchors[0].confidence).toBe(0.2)
    expect(target.source).not.toBe(NOTE_TARGET_SOURCE.SOURCE_NOTEHEAD)
    expect(target.highlight?.preciseSource).not.toBe(true)
    expect(target.sourceAnchors).toEqual([])
    expect(target.approximate).toBe(true)
  })

  it('inverts preprocessing deskew before persisting source geometry', () => {
    const sourceCenter = { x: 0.75, y: 0.42 }
    const angle = 1.25
    const centerX = (PAGE_WIDTH - 1) / 2
    const deskewDelta =
      ((sourceCenter.x * PAGE_WIDTH - centerX) * Math.tan((angle * Math.PI) / 180)) /
      PAGE_HEIGHT
    const processedCenterY = sourceCenter.y - deskewDelta
    const note = sourceNote({
      midi: 72,
      x: sourceCenter.x,
      y: processedCenterY,
      sourceBBox: {
        x0: sourceCenter.x - 0.007,
        y0: processedCenterY - 0.0045,
        x1: sourceCenter.x + 0.007,
        y1: processedCenterY + 0.0045,
      },
    })
    const measures = [measure(1, [noteEvent({ notes: [note] })])]

    restoreOmrSourcePdfGeometry(
      { measureRhythms: measures },
      { width: PAGE_WIDTH, height: PAGE_HEIGHT, deskewAngle: angle },
    )
    const sourceVisualMap = buildOmrSourceVisualMap(measures)

    expect(note.sourcePdfCenter.x).toBeCloseTo(sourceCenter.x, 6)
    expect(note.sourcePdfCenter.y).toBeCloseTo(sourceCenter.y, 6)
    expect(sourceVisualMap.anchors[0].sourceCenter.x).toBeCloseTo(sourceCenter.x, 6)
    expect(sourceVisualMap.anchors[0].sourceCenter.y).toBeCloseTo(sourceCenter.y, 5)
  })

  it('reports zero normalized error for an exact production-resolved target', () => {
    const { sourceVisualMap, timingMap } = buildAndParse([
      measure(1, [
        noteEvent({ notes: [sourceNote({ midi: 60, x: 0.41, y: 0.33 })] }),
      ]),
    ])
    const parsedNote = timingMap.notes.find((note) => note.sourceNoteheadId)
    const target = resolveNoteTargetPosition({
      checkpoint: checkpoint([parsedNote]),
      timingMap,
      anchors: scoreAnchors(),
      sourceVisualMap,
    })
    const expectedAnchor = anchorById(sourceVisualMap, parsedNote.sourceNoteheadId)
    const sample = evaluateSourceVisualSample({
      expectedCenter: expectedAnchor.sourceCenter,
      actualCenter: { x: target.x, y: target.noteAnchorY },
      staffGap: expectedAnchor.staffGap,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      expectedSourceNoteheadIds: [expectedAnchor.sourceNoteheadId],
      actualSourceNoteheadIds: target.highlight.sourceNoteheadIds,
      precise: target.highlight.preciseSource,
      fallback: !target.highlight.preciseSource,
    })

    expect(summarizeSourceVisualMetrics([sample])).toMatchObject({
      sampleCount: 1,
      preciseCount: 1,
      sourceIdMatchCount: 1,
      wrongPreciseCount: 0,
      centerErrorStaffGaps: {
        measuredCount: 1,
        median: 0,
        p95: 0,
        max: 0,
      },
    })
  })
})
