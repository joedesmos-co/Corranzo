import { describe, expect, it } from 'vitest'
import { buildSourceRelationGraph } from '../src/features/omr/sourceRelationGraph.js'
import { solveSourceTemporalLanes } from '../src/features/omr/sourceTemporalLaneSolver.js'

const imageData = { width: 1000, height: 1000, data: new Uint8ClampedArray() }
const baseMeasureBox = {
  page: 1,
  systemIndex: 0,
  measureNumber: 1,
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
  direction = 'up',
  stemX = null,
  stemTipY = null,
  beams = 0,
  beamStrength = 0,
  dotted = false,
  glyphClass = 'black',
} = {}) {
  const open = glyphClass === 'whole' || glyphClass === 'half' || glyphClass === 'open'
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
    noteheadGlyph: glyphClass,
    hollowGlyph: open,
    source: 'general-solver-test-source',
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
  }
}

function buildGraph(notes, options = {}) {
  return buildSourceRelationGraph({
    notes,
    rests: options.rests ?? [],
    glyphs: options.glyphs ?? [],
    imageData,
    measureBox: { ...baseMeasureBox, ...(options.measureBox ?? {}) },
    keySignature: { fifths: 0, source: 'test-key' },
    timeSignature: options.timeSignature ?? { beats: 4, beatType: 4, source: 'test-meter' },
  })
}

function solve(notes, options = {}) {
  return solveSourceTemporalLanes(buildGraph(notes, options))
}

function quarters({ count = 4, x0 = 200, gap = 35, direction = 'up', role = 'upper', midi = 60 } = {}) {
  return Array.from({ length: count }, (_, index) => note({
    x: x0 + index * gap,
    y: role === 'lower' ? 500 - index * 2 : 220 - index * 2,
    midi: midi + index,
    direction,
    role,
  }))
}

describe('high-confidence pre-event shadow attack and temporal-lane solver', () => {
  it('1. solves a monophonic sequence from source order and ownership', () => {
    const result = solve(quarters())
    expect(result.lanes).toEqual([
      expect.objectContaining({ status: 'high-confidence', attackIds: expect.any(Array) }),
    ])
    expect(result.lanes[0].attackIds).toHaveLength(4)
    expect(result.proposedEvents).toHaveLength(4)
  })

  it('2. groups an ordinary chord through a common physical stem', () => {
    const sharedStem = { direction: 'up', stemX: 207, stemTipY: 160 }
    const result = solve([
      note({ x: 200, y: 220, midi: 60, ...sharedStem }),
      note({ x: 200, y: 190, midi: 67, ...sharedStem }),
    ])
    expect(result.attacks).toEqual([
      expect.objectContaining({ status: 'high-confidence', memberIds: expect.any(Array) }),
    ])
    expect(result.attacks[0].memberIds).toHaveLength(2)
  })

  it('3. groups a collision-displaced chord only with common-stem evidence', () => {
    const sharedStem = { direction: 'up', stemX: 207, stemTipY: 160 }
    const result = solve([
      note({ x: 200, y: 220, midi: 60, ...sharedStem }),
      note({ x: 203.9, y: 190, midi: 67, ...sharedStem }),
    ])
    expect(result.attacks.some((attack) => attack.memberIds.length === 2 && attack.status === 'relationship-supported')).toBe(true)
  })

  it('4. separates repeated opposing-stem attacks at the same X into two lanes', () => {
    const result = solve([
      note({ x: 200, y: 220, midi: 60, direction: 'up' }),
      note({ x: 200, y: 180, midi: 69, direction: 'down' }),
      note({ x: 240, y: 215, midi: 62, direction: 'up' }),
      note({ x: 240, y: 185, midi: 67, direction: 'down' }),
    ])
    expect(result.diagnostics.contextResolvedAttacks).toBe(4)
    expect(result.lanes.filter((lane) => lane.status === 'high-confidence' && lane.attackIds.length === 2)).toHaveLength(2)
  })

  it('5. relates an independently sustained note to a moving lane', () => {
    const result = solve([
      note({ x: 180, y: 240, midi: 55, direction: null, glyphClass: 'whole' }),
      ...quarters({ x0: 210, gap: 35, direction: 'up', midi: 67 }),
    ])
    expect(result.sustainRelationships).toEqual([
      expect.objectContaining({ status: 'high-confidence', movingAttackIds: expect.any(Array) }),
    ])
  })

  it('6. follows an alternating accompaniment without using pitch identity as a voice', () => {
    const notes = [48, 55, 48, 55].map((midi, index) => note({
      x: 200 + index * 35,
      y: 500 - (midi - 48) * 2,
      midi,
      role: 'lower',
      direction: 'down',
    }))
    const result = solve(notes)
    expect(result.lanes.some((lane) => lane.status === 'high-confidence' && lane.attackIds.length === 4)).toBe(true)
  })

  it('7. preserves an explicit source rest as a provenance-bearing slot', () => {
    const result = solve(quarters(), {
      rests: [{
        cx: 185,
        cy: 220,
        clef: 'treble',
        durationType: 'quarter',
        positionInMeasure: 0.1,
        source: 'vector-rest-glyph',
      }],
    })
    expect(result.rests).toEqual([
      expect.objectContaining({
        class: 'EXPLICIT_SOURCE_REST',
        status: 'ambiguous',
        quarterUnits: 1,
        supportingEvidence: expect.any(Array),
      }),
    ])
  })

  it('8. infers a structural rest only from a resolved lane plus explicit gap evidence', () => {
    const graph = buildGraph(quarters({ count: 3, gap: 70 }))
    const memberIds = graph.nodes.filter((node) => node.kind === 'notehead').map((node) => node.id)
    graph.laneEvidence.push({
      id: 'test-structural-gap',
      kind: 'structural-gap-candidate',
      memberIds,
      score: 0.9,
      source: 'surrounding source timing gap',
      evidence: { quarterUnits: 1, positionInMeasure: 0.5 },
    })
    const result = solveSourceTemporalLanes(graph)
    expect(result.rests).toContainEqual(
      expect.objectContaining({ class: 'STRUCTURAL_INFERRED_REST', status: 'high-confidence', quarterUnits: 1 }),
    )
  })

  it('9. applies a raw printed triplet ratio to one lane', () => {
    const result = solve([
      note({ x: 200, y: 220, midi: 60, beams: 1, beamStrength: 20 }),
      note({ x: 230, y: 215, midi: 62, beams: 1, beamStrength: 20 }),
      note({ x: 260, y: 210, midi: 64, beams: 1, beamStrength: 20 }),
    ], { glyphs: [{ text: '3', x: 230, y: 180 }] })
    expect(result.attacks).toHaveLength(3)
    expect(result.attacks.every((attack) => attack.duration.tupletRatio?.actual === 3)).toBe(true)
    expect(result.proposedEvents).toHaveLength(0)
  })

  it('10. permits a cross-staff lane only through a high-confidence relation path', () => {
    const result = solve([
      note({ x: 200, y: 245, midi: 60, role: 'upper', direction: 'up' }),
      note({ x: 201, y: 490, midi: 59, role: 'lower', direction: 'up' }),
      note({ x: 236, y: 495, midi: 57, role: 'lower', direction: 'up' }),
    ])
    expect(result.crossStaffContinuities).not.toHaveLength(0)
    expect(result.crossStaffContinuities.every((entry) => entry.status === 'ambiguous')).toBe(true)
    expect(result.ambiguities.some((entry) => entry.kind === 'cross-staff-role-unresolved')).toBe(true)
  })

  it('11. allows shared-head attack+sustain roles only with two direct evidence classes', () => {
    const graph = buildGraph([
      note({ x: 200, y: 220, beams: 2, beamStrength: 20, dotted: true }),
    ])
    const head = graph.nodes.find((node) => node.kind === 'notehead')
    graph.nodes.push({
      id: 'test-second-stem',
      kind: 'stem',
      source: 'independent-source-stem',
      staffRole: 'upper',
      direction: 'down',
      anchor: { x: 196, y0: 220, y1: 260, tipY: 260 },
      sourceRefs: ['independent-second-role'],
    })
    graph.relations.push({
      id: 'test-second-stem-owner',
      type: 'stem-owner-candidate',
      from: 'test-second-stem',
      to: head.id,
      score: 0.9,
      source: 'independent-source-stem',
    })
    const result = solveSourceTemporalLanes(graph)
    expect(result.sharedHeadRoles).toEqual([
      expect.objectContaining({ status: 'high-confidence', semanticRoles: ['attack', 'sustain'] }),
    ])
  })

  it('12. preserves conflicting same-X evidence and abstains', () => {
    const result = solve([
      note({ x: 200, y: 220, midi: 60, direction: 'up' }),
      note({ x: 200, y: 180, midi: 69, direction: 'down' }),
    ])
    expect(result.attacks.every((attack) => attack.status === 'ambiguous')).toBe(true)
    expect(result.abstentions.some((entry) => entry.kind === 'attack-group')).toBe(true)
  })

  it('13. refuses a duration claim when a beam probe lacks ownership support', () => {
    const result = solve([
      note({ x: 200, y: 220, beams: 1, beamStrength: 0 }),
      note({ x: 240, y: 215, midi: 62, beams: 1, beamStrength: 0 }),
    ])
    expect(result.attacks.every((attack) => attack.duration.status !== 'high-confidence')).toBe(true)
    expect(result.proposedEvents).toHaveLength(0)
  })

  it('14. does not merge a misleading same-X collision without chord separation', () => {
    const result = solve([
      note({ x: 200, y: 220, midi: 60, direction: 'up', stemX: 204 }),
      note({ x: 200, y: 220, midi: 60, direction: 'up', stemX: 208 }),
    ])
    expect(result.attacks).toHaveLength(2)
    expect(result.attacks.some((attack) => attack.memberIds.length > 1)).toBe(false)
  })

  it('15. preserves a near-X chord-displacement alternative without a shared stem', () => {
    const result = solve([
      note({ x: 200, y: 220, midi: 60, direction: 'up', stemX: 204 }),
      note({ x: 204, y: 210, midi: 62, direction: 'up', stemX: 208 }),
    ])
    expect(result.attacks).toHaveLength(2)
    expect(result.abstentions.some((entry) => entry.kind === 'attack-group')).toBe(true)
  })

  it('16. leaves an underfilled measure as pickup/rest alternatives rather than inventing a rest', () => {
    const result = solve(quarters({ count: 2 }))
    expect(result.lanes).toHaveLength(0)
    expect(result.abstentions.some((entry) => entry.kind === 'attack-group')).toBe(true)
    expect(result.rests.some((entry) => entry.class === 'STRUCTURAL_INFERRED_REST')).toBe(false)
  })

  it('17. permits a tied continuation exception only when the source graph supplies it', () => {
    const graph = buildGraph(quarters({ count: 5, gap: 30 }))
    const noteIds = graph.nodes.filter((node) => node.kind === 'notehead').map((node) => node.id)
    graph.relations.push({
      id: 'test-tie-continuation',
      type: 'tie-continuation-candidate',
      from: noteIds[3],
      to: noteIds[4],
      score: 0.9,
      source: 'raw source curve ownership',
    })
    const result = solveSourceTemporalLanes(graph)
    expect(result.lanes[0].status).toBe('high-confidence')
    expect(result.lanes[0].capacity.status).toBe('overflow-supported-by-independent-evidence')
  })

  it('18. keeps two offset simultaneous lanes independent', () => {
    const result = solve([
      note({ x: 200, y: 220, midi: 60, direction: 'up' }),
      note({ x: 240, y: 215, midi: 62, direction: 'up' }),
      note({ x: 280, y: 210, midi: 64, direction: 'up' }),
      note({ x: 210, y: 180, midi: 69, direction: 'down' }),
      note({ x: 250, y: 185, midi: 67, direction: 'down' }),
      note({ x: 290, y: 190, midi: 65, direction: 'down' }),
    ])
    expect(result.lanes.filter((lane) => lane.status === 'high-confidence' && lane.attackIds.length === 3)).toHaveLength(2)
  })

  it('19. preserves close-scoring lane successors as alternatives', () => {
    const result = solve([
      note({ x: 200, y: 220, midi: 60, direction: 'up', beams: 1, beamStrength: 20 }),
      note({ x: 240, y: 215, midi: 62, direction: 'up', beams: 1, beamStrength: 20 }),
      note({ x: 244, y: 205, midi: 64, direction: 'up', stemX: 250, beams: 1, beamStrength: 20 }),
    ])
    expect(result.abstentions.some((entry) => entry.kind === 'attack-group')).toBe(true)
    expect(result.proposedEvents).toHaveLength(0)
  })

  it('20. rejects a lane hypothesis that exceeds measure capacity without an exception', () => {
    const result = solve(quarters({ count: 5, gap: 30 }))
    expect(result.lanes.some((lane) => lane.status === 'rejected')).toBe(true)
    expect(result.proposedEvents).toHaveLength(0)
  })
})
