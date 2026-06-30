import { describe, expect, it } from 'vitest'
import {
  aggregateBeamStemDiagnostics,
  buildBeamStemDiagnosticsSvg,
  buildBeamStemGraph,
  summarizeBeamOwnershipGraph,
  summarizeBeamStemGraph,
} from '../src/features/omr/beamStemReconstructionDiagnostics.js'

function makeImageData(width = 200, height = 120) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
    data[index + 3] = 255
  }
  return { width, height, data }
}

function drawInkRect(imageData, x0, y0, x1, y1) {
  for (let y = Math.max(0, y0); y <= Math.min(imageData.height - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(imageData.width - 1, x1); x += 1) {
      const index = (y * imageData.width + x) * 4
      imageData.data[index] = 0
      imageData.data[index + 1] = 0
      imageData.data[index + 2] = 0
      imageData.data[index + 3] = 255
    }
  }
}

const measureBox = {
  measureNumber: 7,
  page: 1,
  systemIndex: 0,
  x0: 0.1,
  x1: 0.9,
  y0: 0.2,
  y1: 0.5,
}

function note(overrides = {}) {
  return {
    page: 1,
    measureNumber: 7,
    clef: 'treble',
    midi: 72,
    cx: 40,
    cy: 60,
    xNorm: 0.2,
    yNorm: 0.5,
    source: 'vector-glyph',
    confidence: 0.9,
    ...overrides,
  }
}

describe('beam/stem reconstruction diagnostics', () => {
  it('associates noteheads to stems, beams, and rhythmic groups', () => {
    const notes = [
      note({
        midi: 72,
        cx: 40,
        stem: { x: 44, tipY: 28, length: 32, direction: 'up' },
        beams: 1,
        beamStrength: 16,
        durationDivisions: 1,
      }),
      note({
        midi: 74,
        cx: 58,
        stem: { x: 62, tipY: 29, length: 31, direction: 'up' },
        beams: 1,
        beamStrength: 14,
        durationDivisions: 1,
      }),
      note({
        midi: 76,
        cx: 100,
        stem: { x: 104, tipY: 34, length: 26, direction: 'up' },
        beams: 0,
        beamStrength: 0,
        durationDivisions: 4,
      }),
    ]
    const events = [
      { type: 'note', startDivision: 0, durationDivisions: 4, notes: notes.slice(0, 2) },
      { type: 'note', startDivision: 4, durationDivisions: 4, notes: [notes[2]] },
    ]

    const graph = buildBeamStemGraph({ notes, events, measureBox })
    const summary = summarizeBeamStemGraph(graph)

    expect(summary.noteCount).toBe(3)
    expect(summary.stemCandidateCount).toBe(3)
    expect(summary.beamCandidateCount).toBe(1)
    expect(summary.stemAttachmentRate).toBe(1)
    expect(summary.beamAttachedNoteCount).toBe(2)
    expect(summary.beamAttachmentRate).toBeCloseTo(2 / 3, 4)
    expect(graph.rhythmicGroups.some((group) => group.inferredUnit === 'sixteenth')).toBe(true)
    expect(summary.disagreements.graphBeamedButCurrentLong).toBe(2)
  })

  it('reports event ownership conflicts without changing events', () => {
    const notes = [
      note({
        midi: 72,
        cx: 40,
        stem: { x: 44, tipY: 28, length: 32, direction: 'up' },
        beams: 1,
        beamStrength: 16,
        durationDivisions: 4,
      }),
      note({
        midi: 74,
        cx: 58,
        stem: { x: 62, tipY: 29, length: 31, direction: 'up' },
        beams: 1,
        beamStrength: 14,
        durationDivisions: 2,
      }),
      note({
        midi: 60,
        cx: 40,
        cy: 84,
        stem: { x: 36, tipY: 112, length: 30, direction: 'down' },
        beams: 0,
        beamStrength: 0,
        durationDivisions: 4,
      }),
    ]
    const events = [
      { type: 'note', startDivision: 0, durationDivisions: 4, notes: [notes[0], notes[2]] },
      { type: 'note', startDivision: 2, durationDivisions: 2, notes: [notes[1]] },
    ]
    const before = JSON.stringify(events)

    const graph = buildBeamStemGraph({ notes, events, measureBox })
    const ownership = summarizeBeamOwnershipGraph(graph)
    const splitCandidate = graph.eventOwnership.find((event) => event.splitCandidate)

    expect(JSON.stringify(events)).toBe(before)
    expect(graph.noteheads[0].beamOwnership.stemDirection).toBe('up')
    expect(graph.noteheads[0].beamOwnership.attachedStemId).toBeTruthy()
    expect(graph.noteheads[0].beamOwnership.attachedBeamIds).toHaveLength(1)
    expect(graph.noteheads[0].beamOwnership.beamLevel).toBeGreaterThanOrEqual(1)
    expect(graph.noteheads[0].beamOwnership.beamGroupId).toBeTruthy()
    expect(graph.noteheads[2].beamOwnership.stemDirection).toBe('down')
    expect(graph.noteheads[2].beamOwnership.attachedBeamIds).toHaveLength(0)
    expect(splitCandidate).toMatchObject({
      eventIndex: 0,
      notesWithBeams: 1,
      notesWithoutBeams: 1,
      mixedOwnership: true,
      splitCandidate: true,
    })
    expect(splitCandidate.reasons).toContain('beamed-and-unbeamed-notes')
    expect(splitCandidate.reasons).toContain('mixed-stem-directions')
    expect(splitCandidate.reasons).toContain('event-longer-than-beam-unit')
    expect(ownership.splitCandidateEventCount).toBe(1)
    expect(ownership.splitCandidateReasons['beamed-and-unbeamed-notes']).toBe(1)
  })

  it('aggregates page-level rates and keeps visual samples', () => {
    const notes = [
      note({
        stem: { x: 44, tipY: 28, length: 32, direction: 'up' },
        beams: 1,
        beamStrength: 12,
        durationDivisions: 2,
      }),
      note({
        cx: 58,
        stem: { x: 62, tipY: 29, length: 31, direction: 'up' },
        beams: 1,
        beamStrength: 12,
        durationDivisions: 2,
      }),
    ]
    const events = [{ type: 'note', startDivision: 0, durationDivisions: 2, notes }]
    const graph = buildBeamStemGraph({ notes, events, measureBox })
    const beamStemDiagnostics = summarizeBeamStemGraph(graph)
    const aggregate = aggregateBeamStemDiagnostics([
      {
        systems: [
          {
            measures: [{ beamStemGraph: graph, beamStemDiagnostics }],
          },
        ],
      },
    ])

    expect(aggregate.noteCount).toBe(2)
    expect(aggregate.stemAttachmentRate).toBe(1)
    expect(aggregate.beamAttachmentRate).toBe(1)
    expect(aggregate.visualSamples).toHaveLength(1)
  })

  it('renders visual SVG diagnostics without mutating graph data', () => {
    const imageData = makeImageData()
    drawInkRect(imageData, 44, 27, 62, 29)
    const notes = [
      note({
        stem: { x: 44, tipY: 28, length: 32, direction: 'up' },
        durationDivisions: 2,
      }),
      note({
        cx: 58,
        stem: { x: 62, tipY: 28, length: 31, direction: 'up' },
        durationDivisions: 2,
      }),
    ]
    const events = [{ type: 'note', startDivision: 0, durationDivisions: 2, notes }]
    const graph = buildBeamStemGraph({ notes, events, measureBox, imageData })
    const before = JSON.stringify(graph)
    const svg = buildBeamStemDiagnosticsSvg([graph])

    expect(svg).toContain('<svg')
    expect(svg).toContain('class="note"')
    expect(svg).toContain('class="stem"')
    expect(svg).toContain('class="beam"')
    expect(JSON.stringify(graph)).toBe(before)
  })

  it('recovers thick beam ink connecting compatible stem anchors', () => {
    const imageData = makeImageData()
    drawInkRect(imageData, 44, 27, 62, 29)
    const notes = [
      note({
        midi: 72,
        cx: 40,
        stem: { x: 44, tipY: 28, length: 32, direction: 'up' },
        durationDivisions: 4,
      }),
      note({
        midi: 74,
        cx: 58,
        stem: { x: 62, tipY: 28, length: 31, direction: 'up' },
        durationDivisions: 4,
      }),
    ]

    const graph = buildBeamStemGraph({ notes, measureBox, imageData })
    const summary = summarizeBeamStemGraph(graph)

    expect(summary.beamCandidateCount).toBe(1)
    expect(summary.beamAttachmentRate).toBe(1)
    expect(graph.beams[0].evidence.inkRate).toBeGreaterThanOrEqual(0.72)
    expect(graph.beams[0].evidence.thickRate).toBeGreaterThanOrEqual(0.45)
  })

  it('rejects thin staff-line-like ink between stems', () => {
    const imageData = makeImageData()
    drawInkRect(imageData, 20, 28, 90, 28)
    const notes = [
      note({
        midi: 72,
        cx: 40,
        stem: { x: 44, tipY: 28, length: 32, direction: 'up' },
        durationDivisions: 4,
      }),
      note({
        midi: 74,
        cx: 58,
        stem: { x: 62, tipY: 28, length: 31, direction: 'up' },
        durationDivisions: 4,
      }),
    ]

    const graph = buildBeamStemGraph({ notes, measureBox, imageData })
    const summary = summarizeBeamStemGraph(graph)

    expect(summary.beamCandidateCount).toBe(0)
    expect(summary.beamAttachmentRate).toBe(0)
  })

})
