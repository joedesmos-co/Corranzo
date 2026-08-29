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
    noteheadGlyph: open ? 'half' : 'black',
    hollowGlyph: open,
    source: 'test-source-glyph',
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
    imageData,
    measureBox,
    keySignature: { fifths: 0, source: 'test-key' },
    timeSignature: { beats: 4, beatType: 4, source: 'test-meter' },
  })
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
})
