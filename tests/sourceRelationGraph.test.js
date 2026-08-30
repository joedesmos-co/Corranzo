import { describe, expect, it } from 'vitest'
import {
  buildSourceRelationGraph,
  formatSourceRelationGraphDiagnostics,
} from '../src/features/omr/sourceRelationGraph.js'

const imageData = { width: 1000, height: 1000, data: new Uint8ClampedArray() }
const measureBox = {
  page: 1,
  systemIndex: 0,
  measureNumber: 4,
  x0: 0.1,
  x1: 0.9,
  playableX0: 0.12,
  y0: 0.1,
  y1: 0.8,
  staffLines: {
    treble: [0.2, 0.21, 0.22, 0.23, 0.24],
    bass: [0.5, 0.51, 0.52, 0.53, 0.54],
  },
  staffClefs: { events: [] },
}

function note({
  x,
  y,
  midi = 60,
  role = 'upper',
  direction = null,
  stemX = null,
  stemTipY = null,
  beams = 0,
  beamStrength = 0,
  dotted = false,
  open = false,
  accidental = null,
  glyph = open ? 'half' : 'black',
  sourceProvenance = null,
  noteheadAnchor = null,
} = {}) {
  return {
    cx: x,
    cy: y,
    xNorm: x / 1000,
    yNorm: y / 1000,
    naturalMidi: midi,
    midi,
    clef: role === 'lower' ? 'bass' : 'treble',
    pitchMapping: { staffRole: role },
    pitchConfidence: 0.94,
    noteheadGlyph: glyph,
    hollowGlyph: open,
    source: 'test-source-glyph',
    sourceProvenance,
    noteheadAnchor,
    ...(direction
      ? {
          stem: {
            direction,
            x: stemX ?? x + (direction === 'up' ? 4 : -4),
            tipY: stemTipY ?? y + (direction === 'up' ? -40 : 40),
            length: 40,
            recovered: false,
          },
        }
      : {}),
    beams,
    beamStrength,
    dotted,
    accidental,
  }
}

function graph(notes, options = {}) {
  return buildSourceRelationGraph({
    notes,
    rests: options.rests ?? [],
    glyphs: options.glyphs ?? [],
    rawVectorPaths: options.rawVectorPaths ?? [],
    imageData,
    measureBox,
    keySignature: { fifths: 0, source: 'test-key' },
    timeSignature: { beats: 4, beatType: 4, source: 'test-meter' },
  })
}

function rawLinePath(pathId, from, to, { lineWidth = 1 } = {}) {
  return {
    pathId,
    operatorPathId: pathId.split('-sub')[0],
    operatorIndex: Number(pathId.match(/op(\d+)/)?.[1] ?? 0),
    subpathIndex: 0,
    drawOrder: Number(pathId.match(/op(\d+)/)?.[1] ?? 0),
    source: 'pdf-vector-operator-path',
    sourceTransform: [1, 0, 0, 1, 0, 0],
    sourceLineWidth: lineWidth,
    effectiveLineWidth: lineWidth,
    commands: ['move', 'line'],
    closed: false,
    segments: [{ kind: 'line', from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } }],
    bounds: {
      x0: Math.min(from[0], to[0]),
      x1: Math.max(from[0], to[0]),
      y0: Math.min(from[1], to[1]),
      y1: Math.max(from[1], to[1]),
      width: Math.abs(to[0] - from[0]),
      height: Math.abs(to[1] - from[1]),
    },
  }
}

function rawPolygonPath(pathId, points, { lineWidth = 1 } = {}) {
  const segments = points.map((from, index) => {
    const to = points[(index + 1) % points.length]
    return { kind: 'line', from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } }
  })
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return {
    ...rawLinePath(pathId, points[0], points[1], { lineWidth }),
    commands: ['move', ...points.map(() => 'line')],
    segments,
    bounds: {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
  }
}

function relations(result, type) {
  return result.relations.filter((relation) => relation.type === type)
}

describe('pre-event source relation graph', () => {
  it('records a simple monophonic ordered sequence without solving events', () => {
    const result = graph([
      note({ x: 200, y: 220, direction: 'up' }),
      note({ x: 230, y: 215, midi: 62, direction: 'up' }),
    ])
    expect(relations(result, 'sequential-attack-candidate')).toHaveLength(1)
    expect(result).not.toHaveProperty('events')
    expect(result.independence.readsFinalEvents).toBe(false)
  })

  it('preserves a simple vertical chord as a same-attack candidate', () => {
    const result = graph([
      note({ x: 200, y: 220, midi: 60 }),
      note({ x: 200, y: 200, midi: 64 }),
    ])
    expect(relations(result, 'same-attack-candidate')).toHaveLength(1)
    expect(result.attackCandidates.some((candidate) => candidate.kind === 'same-attack')).toBe(true)
  })

  it('recognizes a collision-displaced second through shared stem geometry', () => {
    const sharedStem = { stemX: 207, stemTipY: 160, direction: 'up' }
    const result = graph([
      note({ x: 200, y: 220, midi: 60, ...sharedStem }),
      note({ x: 205, y: 210, midi: 62, ...sharedStem }),
    ])
    expect(relations(result, 'same-chord-candidate')).toHaveLength(1)
  })

  it('keeps opposing-stem voices ambiguous at a shared x position', () => {
    const result = graph([
      note({ x: 200, y: 220, midi: 60, direction: 'up' }),
      note({ x: 200, y: 190, midi: 67, direction: 'down' }),
    ])
    expect(result.ambiguities.some((entry) => entry.kind === 'same-attack-versus-independent-lanes')).toBe(true)
    expect(result.laneEvidence.some((entry) => entry.kind === 'opposing-stem-directions')).toBe(true)
  })

  it('links a beamed sequence without assigning onset or duration', () => {
    const result = graph([
      note({ x: 200, y: 220, direction: 'up', beams: 1, beamStrength: 15 }),
      note({ x: 230, y: 215, midi: 62, direction: 'up', beams: 1, beamStrength: 14 }),
      note({ x: 260, y: 210, midi: 64, direction: 'up', beams: 1, beamStrength: 16 }),
    ])
    expect(result.nodes.filter((node) => node.kind === 'beam')).toHaveLength(1)
    expect(relations(result, 'beam-membership-candidate')).toHaveLength(3)
    expect(JSON.stringify(result)).not.toContain('startDivision')
  })

  it('uses direct raw head-stem and stem-beam path connectivity as physical ownership', () => {
    const result = graph(
      [
        note({ x: 200, y: 220, midi: 60 }),
        note({ x: 230, y: 215, midi: 62 }),
      ],
      {
        rawVectorPaths: [
          rawLinePath('pdf-path-p1-op10-sub0', [205, 160], [205, 220]),
          rawLinePath('pdf-path-p1-op11-sub0', [235, 160], [235, 215]),
          rawPolygonPath(
            'pdf-path-p1-op12-sub0',
            [[205, 160], [235, 164], [235, 169], [205, 165]],
            { lineWidth: 1 },
          ),
        ],
      },
    )

    expect(result.nodes.filter((node) => node.kind === 'raw-stem-path')).toHaveLength(2)
    expect(result.nodes.filter((node) => node.kind === 'raw-beam-segment')).toHaveLength(1)
    expect(relations(result, 'stem-owner-candidate').filter(
      (relation) => relation.evidence.ownershipKind === 'direct-raw-vector-path-contact',
    )).toHaveLength(2)
    expect(relations(result, 'beam-membership-candidate').filter(
      (relation) => relation.evidence.physicalPathContinuity,
    )).toHaveLength(2)
    expect(result.nodes.filter((node) => node.kind === 'notehead')).toEqual([
      expect.objectContaining({ primitiveEvidence: expect.objectContaining({ rawBeamConnectivity: true }) }),
      expect.objectContaining({ primitiveEvidence: expect.objectContaining({ rawBeamConnectivity: true }) }),
    ])
    expect(result.diagnostics.rawVector).toMatchObject({
      available: true,
      rawStemPathCount: 2,
      rawBeamPathCount: 1,
    })
  })

  it('does not treat raw operator grouping or near-miss paths as ownership', () => {
    const result = graph(
      [note({ x: 200, y: 220 })],
      {
        rawVectorPaths: [
          rawLinePath('pdf-path-p1-op20-sub0', [214, 160], [214, 220]),
          rawLinePath('pdf-path-p1-op20-sub1', [214, 160], [240, 160], { lineWidth: 5 }),
        ],
      },
    )
    expect(result.nodes.some((node) => node.kind === 'raw-stem-path')).toBe(false)
    expect(result.diagnostics.rawVector).toMatchObject({
      sourceOperatorGroupingUsedAsOwnership: false,
      sourceDrawOrderUsedAsOwnership: false,
    })
  })

  it('records sustain evidence over a moving line as lane evidence only', () => {
    const result = graph([
      note({ x: 200, y: 220, open: true, direction: 'down' }),
      note({ x: 215, y: 190, midi: 67, direction: 'up' }),
      note({ x: 240, y: 185, midi: 69, direction: 'up' }),
    ])
    expect(result.laneEvidence.some((entry) => entry.kind === 'sustain-value')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('sourceVoice')
  })

  it('keeps a structural rest as a physical lane anchor', () => {
    const result = graph(
      [note({ x: 240, y: 215, direction: 'up' })],
      { rests: [{ cx: 200, cy: 220, clef: 'treble', durationType: 'quarter', positionInMeasure: 0.2, source: 'vector-rest' }] },
    )
    expect(result.nodes.some((node) => node.kind === 'rest')).toBe(true)
    expect(result.laneEvidence.some((entry) => entry.kind === 'structural-rest-anchor')).toBe(true)
  })

  it('keeps a raw triplet mark and local membership candidates', () => {
    const result = graph(
      [
        note({ x: 200, y: 220, direction: 'up', beams: 1 }),
        note({ x: 225, y: 215, midi: 62, direction: 'up', beams: 1 }),
        note({ x: 250, y: 210, midi: 64, direction: 'up', beams: 1 }),
      ],
      { glyphs: [{ text: '3', x: 225, y: 180 }] },
    )
    expect(result.nodes.some((node) => node.kind === 'tuplet-mark')).toBe(true)
    expect(relations(result, 'tuplet-membership-candidate')).toHaveLength(3)
    expect(result.laneEvidence.some((entry) => entry.kind === 'subdivision-ratio-candidate')).toBe(true)
  })

  it('flags a shared physical head with attack and sustain evidence', () => {
    const result = graph([
      note({ x: 200, y: 220, direction: 'up', beams: 2, beamStrength: 18, dotted: true }),
    ])
    expect(relations(result, 'shared-head-role-candidate')).toHaveLength(1)
    expect(result.ambiguities.some((entry) => entry.kind === 'shared-head-semantic-overprint')).toBe(true)
  })

  it('emits cross-staff continuity as a candidate rather than a voice', () => {
    const result = graph([
      note({ x: 200, y: 240, midi: 60, role: 'upper', direction: 'down' }),
      note({ x: 203, y: 500, midi: 55, role: 'lower', direction: 'up' }),
    ])
    expect(relations(result, 'cross-staff-continuation-candidate')).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('voiceId')
  })

  it('represents accidental ownership with explainable primitive evidence', () => {
    const result = graph([
      note({ x: 200, y: 220, accidental: { type: 'sharp', alter: 1, confidence: 0.96, source: 'vector-accidental' } }),
    ])
    expect(result.nodes.some((node) => node.kind === 'accidental')).toBe(true)
    expect(relations(result, 'accidental-owner-candidate')[0].components[0].source).toBe('vector-accidental')
  })

  it('represents augmentation-dot ownership without deciding a duration', () => {
    const result = graph(
      [note({ x: 200, y: 220, dotted: true })],
      { glyphs: [{ text: '\ue1e7', x: 208, y: 220 }] },
    )
    expect(result.nodes.some((node) => node.kind === 'augmentation-dot')).toBe(true)
    expect(result.nodes.some((node) => node.kind === 'dot-mark')).toBe(true)
    expect(relations(result, 'dot-owner-candidate').length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(result)).not.toContain('durationDivisions')
  })

  it('keeps near-x but distinct heads as sequential candidates', () => {
    const result = graph([
      note({ x: 200, y: 220, direction: 'up' }),
      note({ x: 204, y: 215, midi: 62, direction: 'up' }),
    ])
    expect(relations(result, 'sequential-attack-candidate')).toHaveLength(1)
    expect(relations(result, 'same-attack-candidate')).toHaveLength(0)
  })

  it('preserves competing hypotheses for same-x independent voices', () => {
    const result = graph([
      note({ x: 200, y: 220, direction: 'up' }),
      note({ x: 200, y: 180, midi: 69, direction: 'down' }),
    ])
    const hypotheses = result.attackCandidates.filter((candidate) =>
      candidate.memberIds.length === 2,
    )
    expect(hypotheses.some((candidate) => candidate.kind === 'same-attack')).toBe(true)
    expect(hypotheses.some((candidate) => candidate.kind === 'same-x-independent-lanes')).toBe(true)
  })

  it('abstains explicitly when primitive evidence is incomplete', () => {
    const result = graph([note({ x: 200, y: 220 })])
    expect(result.zeroEvidence).toEqual([
      expect.objectContaining({ score: 0, outcome: 'no-supported-relation' }),
    ])
    expect(result.ambiguities).toEqual([
      expect.objectContaining({ kind: 'incomplete-evidence', resolution: 'abstain', evidenceScore: 0 }),
    ])
    expect(formatSourceRelationGraphDiagnostics(result)).toContain('NODES')
  })

  it('uses the resolved physical head anchor while retaining the raw PDF origin', () => {
    const result = graph([
      note({
        x: 200,
        y: 300,
        noteheadAnchor: {
          yNorm: 0.22,
          confidence: 0.91,
          source: 'staff-ink-component',
        },
      }),
    ])
    const head = result.nodes.find((node) => node.kind === 'notehead')
    expect(head.anchor).toMatchObject({ y: 220, rawSourceY: 300, source: 'staff-ink-component' })
  })

  it('preserves source text-run provenance without treating draw order as ownership', () => {
    const result = graph([
      note({
        x: 200,
        y: 220,
        sourceProvenance: {
          runId: 'p1:text-item:12',
          itemIndex: 12,
          sourceIndex: 1,
          sourceLength: 3,
          sourceText: '\ue0a4\ue0a4\ue0a4',
          drawOrder: 12,
        },
      }),
    ])
    const head = result.nodes.find((node) => node.kind === 'notehead')
    expect(head.provenance).toMatchObject({ runId: 'p1:text-item:12', sourceIndex: 1, drawOrder: 12 })
    expect(result.relations).toHaveLength(0)
  })

  it('never assigns a raster stem probe to a literal whole-note head', () => {
    const whole = note({ x: 200, y: 220, open: true, glyph: 'whole', direction: 'up' })
    const result = graph([whole])
    const head = result.nodes.find((node) => node.kind === 'notehead')
    expect(head.primitiveEvidence.stemDirection).toBeNull()
    expect(head.primitiveEvidence.stemProbeRejectedReason)
      .toBe('literal-whole-head-cannot-own-stem')
    expect(relations(result, 'stem-owner-candidate')).toHaveLength(0)
  })

  it('retains rejected raw stem and beam provenance without creating ownership', () => {
    const result = graph([
      note({
        x: 200,
        y: 300,
        direction: 'up',
        beams: 2,
        beamStrength: 18,
        noteheadAnchor: {
          yNorm: 0.22,
          confidence: 0.91,
          source: 'staff-ink-component',
        },
      }),
    ])
    const head = result.nodes.find((node) => node.kind === 'notehead')
    expect(head.primitiveEvidence).toMatchObject({
      stemDirection: null,
      rawStemDirection: 'up',
      rawBeamCount: 2,
      beamCount: 0,
      beamProbeRejected: true,
      stemProbeRejectedReason: 'raw-origin-too-far-from-resolved-head',
    })
    expect(relations(result, 'stem-owner-candidate')).toHaveLength(0)
    expect(relations(result, 'beam-membership-candidate')).toHaveLength(0)
  })

  it('recovers an interior chord-head owner only inside a multi-probe stem segment', () => {
    const result = graph([
      note({ x: 200, y: 220, midi: 60, direction: 'up', stemX: 204, stemTipY: 160 }),
      note({ x: 200, y: 210, midi: 62 }),
      note({ x: 200, y: 200, midi: 64, direction: 'up', stemX: 204, stemTipY: 160 }),
    ])
    const owners = relations(result, 'stem-owner-candidate')
    expect(owners).toHaveLength(3)
    expect(owners.some((owner) => owner.evidence.ownershipKind === 'interior-segment-owner')).toBe(true)
  })

  it('captures a single-character tuplet ratio outside the detected staff body', () => {
    const result = graph(
      [
        note({ x: 200, y: 210, direction: 'up', beams: 1 }),
        note({ x: 225, y: 215, midi: 62, direction: 'up', beams: 1 }),
        note({ x: 250, y: 220, midi: 64, direction: 'up', beams: 1 }),
      ],
      {
        glyphs: [{
          text: '3',
          sourceLength: 1,
          x: 225,
          y: 252,
          sourceRunId: 'p1:text-item:90',
          sourceItemIndex: 90,
          sourceIndex: 0,
        }],
      },
    )
    expect(result.nodes).toContainEqual(expect.objectContaining({
      kind: 'tuplet-mark',
      ratioHint: 3,
      provenance: expect.objectContaining({ runId: 'p1:text-item:90' }),
    }))
  })

  it('does not promote grid context alone to shared-head physical ownership', () => {
    const result = graph([
      note({ x: 200, y: 220, open: true }),
      note({ x: 230, y: 210, midi: 62, direction: 'up', beams: 1, beamStrength: 14 }),
      note({ x: 260, y: 200, midi: 64, direction: 'up', beams: 1, beamStrength: 14 }),
    ])
    expect(relations(result, 'shared-head-role-candidate')).toHaveLength(0)
    expect(result.ambiguities.some((entry) =>
      entry.reasons?.includes('second-independent-ownership-path-absent') ||
      entry.reasons?.includes('subdivision-grid-is-context-not-independent-physical-ownership'),
    )).toBe(true)
  })

  it('represents displaced literal whole heads as a general collision candidate', () => {
    const result = graph([
      note({ x: 200, y: 220, midi: 60, open: true, glyph: 'whole' }),
      note({ x: 218, y: 210, midi: 62, open: true, glyph: 'whole' }),
      note({ x: 250, y: 215, midi: 65, direction: 'up' }),
    ])
    expect(relations(result, 'collision-displaced-open-head-candidate')).toHaveLength(1)
    expect(result.ambiguities).toContainEqual(expect.objectContaining({
      kind: 'collision-displaced-whole-head',
      resolution: 'abstain',
    }))
  })

  it('records when a cross-staff candidate lacks a continuous physical path', () => {
    const result = graph([
      note({ x: 200, y: 240, midi: 60, role: 'upper', direction: 'down' }),
      note({ x: 203, y: 500, midi: 55, role: 'lower', direction: 'up' }),
    ])
    expect(relations(result, 'cross-staff-continuation-candidate')[0].evidence)
      .toMatchObject({ physicalPathContinuityAvailable: false })
  })
})
