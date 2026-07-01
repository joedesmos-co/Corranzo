/**
 * Canonical ScoreGraph IR — Phase 1: observation / plumbing only.
 *
 * This module UNIFIES detections that the OMR pipeline already produces
 * (musical events + the beam/stem reconstruction graph + onset columns +
 * measure/staff geometry) into a single typed graph model. It is a pure
 * observation layer:
 *
 *   - It does NOT run a solver.
 *   - It does NOT emit MusicXML.
 *   - It does NOT mutate its inputs or change runtime output.
 *
 * The musical layer (noteheads / rests / chords / voices / ties / accidentals)
 * is derived from the runtime `events`, so it mirrors runtime exactly. The
 * geometry layer (stems / beams / ownership) is reused from
 * `beamStemReconstructionDiagnostics` and bridged to the musical noteheads by
 * position, with the bridge coverage reported rather than assumed.
 */

import { midiToWrittenPitch } from './pitchFromStaffPosition.js'
import { extractOnsetColumns } from './innerVoicePhaseCorrection.js'

export const SCORE_GRAPH_VERSION = 1

export const SCORE_GRAPH_NODE = {
  NOTEHEAD: 'notehead',
  REST: 'rest',
  STEM: 'stem',
  BEAM: 'beam',
  ACCIDENTAL: 'accidental',
}

export const SCORE_GRAPH_EDGE = {
  HEAD_IN_CHORD: 'head_in_chord',
  NOTE_IN_VOICE: 'note_in_voice',
  TIE_LINKS: 'tie_links',
  STEM_OWNS_HEAD: 'stem_owns_head',
  BEAM_LINKS_STEM: 'beam_links_stem',
  HEAD_GEOMETRY_LINK: 'head_geometry_link',
}

const BRIDGE_X_TOLERANCE = 8
const BRIDGE_Y_TOLERANCE = 14

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null
  }
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function voiceForClef(clef) {
  return clef === 'bass' ? 2 : 1
}

function nearestNotehead(candidates, cx, cy) {
  if (!Number.isFinite(cx)) {
    return null
  }
  let best = null
  let bestDx = Infinity
  for (const node of candidates) {
    if (!Number.isFinite(node.cx)) {
      continue
    }
    const dx = Math.abs(node.cx - cx)
    if (dx > BRIDGE_X_TOLERANCE) {
      continue
    }
    if (Number.isFinite(cy) && Number.isFinite(node.cy) && Math.abs(node.cy - cy) > BRIDGE_Y_TOLERANCE) {
      continue
    }
    if (dx < bestDx) {
      bestDx = dx
      best = node
    }
  }
  return best
}

/**
 * Build one MeasureGraph from a runtime measure record. Pure — reads only.
 */
export function buildMeasureGraph(measure = {}, { defaultTotalDivisions = 16 } = {}) {
  const page = measure.page ?? null
  const measureNumber = measure.measureNumber ?? null
  const systemIndex = measure.systemIndex ?? null
  const events = Array.isArray(measure.events) ? measure.events : []
  const beamStemGraph = measure.beamStemGraph ?? null
  const idPrefix = `p${page}m${measureNumber}`

  const nodes = []
  const edges = []
  const noteheadNodes = []

  let observedBudget = 0
  for (const event of events) {
    observedBudget = Math.max(
      observedBudget,
      (event.startDivision ?? 0) + (event.durationDivisions ?? 0),
    )
  }
  const totalDivisions = observedBudget > 0 ? observedBudget : defaultTotalDivisions

  events.forEach((event, eventIndex) => {
    const onsetDivision = event.startDivision ?? 0
    if (event.type === 'rest') {
      nodes.push({
        id: `${idPrefix}-r${eventIndex}`,
        kind: SCORE_GRAPH_NODE.REST,
        onsetDivision,
        durationDivisions: event.durationDivisions ?? 0,
        source: 'vector-event',
      })
      return
    }

    const chordNoteIds = []
    ;(event.notes ?? []).forEach((note, noteIndex) => {
      const id = `${idPrefix}-e${eventIndex}n${noteIndex}`
      const voice = voiceForClef(note.clef)
      const node = {
        id,
        kind: SCORE_GRAPH_NODE.NOTEHEAD,
        midi: Number.isFinite(note.midi) ? note.midi : null,
        pitch: Number.isFinite(note.midi) ? midiToWrittenPitch(note.midi) : null,
        clef: note.clef ?? null,
        voice,
        onsetDivision,
        durationDivisions: event.durationDivisions ?? null,
        dotted: Boolean(event.dotted),
        cx: round(note.cx),
        cy: round(note.cy),
        confidence: note.pitchConfidence ?? event.confidence ?? null,
        source: 'vector-event',
      }
      nodes.push(node)
      noteheadNodes.push(node)
      chordNoteIds.push(id)

      edges.push({
        kind: SCORE_GRAPH_EDGE.NOTE_IN_VOICE,
        from: id,
        to: `${idPrefix}-voice${voice}`,
        weight: 1,
        source: 'clef',
      })

      if (note.accidental) {
        nodes.push({
          id: `${id}-acc`,
          kind: SCORE_GRAPH_NODE.ACCIDENTAL,
          accidentalType: note.accidental.type ?? null,
          alter: note.accidental.alter ?? null,
          attachedNoteId: id,
          source: 'vector-event',
        })
      }

      if (note.tieStart) {
        edges.push({
          kind: SCORE_GRAPH_EDGE.TIE_LINKS,
          from: id,
          to: null,
          weight: note.tieConfidence ?? 0.6,
          source: 'vector-tie',
        })
      }
    })

    for (let index = 1; index < chordNoteIds.length; index += 1) {
      edges.push({
        kind: SCORE_GRAPH_EDGE.HEAD_IN_CHORD,
        from: chordNoteIds[0],
        to: chordNoteIds[index],
        weight: event.confidence ?? 0.8,
        source: 'chord-grouping',
      })
    }
  })

  const bridge = { matched: 0, total: 0 }
  if (beamStemGraph) {
    for (const stem of beamStemGraph.stems ?? []) {
      nodes.push({
        id: stem.id,
        kind: SCORE_GRAPH_NODE.STEM,
        direction: stem.direction ?? null,
        noteheadIds: [...(stem.noteheadIds ?? [])],
        source: 'rendered-image',
      })
    }
    for (const beam of beamStemGraph.beams ?? []) {
      nodes.push({
        id: beam.id,
        kind: SCORE_GRAPH_NODE.BEAM,
        attachedStemIds: [...(beam.attachedStemIds ?? [])],
        source: 'rendered-image',
      })
      for (const stemId of beam.attachedStemIds ?? []) {
        edges.push({
          kind: SCORE_GRAPH_EDGE.BEAM_LINKS_STEM,
          from: beam.id,
          to: stemId,
          weight: 1,
          source: 'beam-stem-graph',
        })
      }
    }

    const graphHeads = beamStemGraph.noteheads ?? []
    bridge.total = graphHeads.length
    for (const graphHead of graphHeads) {
      const match = nearestNotehead(noteheadNodes, graphHead.cx, graphHead.cy)
      if (match) {
        bridge.matched += 1
        edges.push({
          kind: SCORE_GRAPH_EDGE.HEAD_GEOMETRY_LINK,
          from: match.id,
          to: graphHead.id,
          weight: 1,
          source: 'geometry-bridge',
        })
      }
      const headRef = match?.id ?? graphHead.id
      for (const stemId of graphHead.attachedStemIds ?? []) {
        edges.push({
          kind: SCORE_GRAPH_EDGE.STEM_OWNS_HEAD,
          from: stemId,
          to: headRef,
          weight: 1,
          source: 'beam-stem-graph',
        })
      }
    }
  }

  return {
    measureNumber,
    page,
    systemIndex,
    totalDivisions,
    geometry: beamStemGraph?.measureBounds ?? null,
    onsetColumns: extractOnsetColumns(events),
    nodes,
    edges,
    provenance: {
      hasBeamStemGraph: Boolean(beamStemGraph),
      geometryBridge: bridge,
    },
  }
}

/**
 * Build the whole ScoreGraph from the page diagnostics the pipeline already
 * carries (pages -> systems -> measure records). Pure — reads only.
 */
export function buildScoreGraph(pages = [], options = {}) {
  const measures = []
  for (const page of pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        measures.push(buildMeasureGraph(measure, options))
      }
    }
  }
  return { version: SCORE_GRAPH_VERSION, measures }
}

function countNodesByKind(scoreGraph) {
  const counts = {}
  for (const measure of scoreGraph.measures ?? []) {
    for (const node of measure.nodes) {
      counts[node.kind] = (counts[node.kind] ?? 0) + 1
    }
  }
  return counts
}

function countEdgesByKind(scoreGraph) {
  const counts = {}
  for (const measure of scoreGraph.measures ?? []) {
    for (const edge of measure.edges) {
      counts[edge.kind] = (counts[edge.kind] ?? 0) + 1
    }
  }
  return counts
}

/**
 * Compact, dashboard-friendly summary of a ScoreGraph.
 */
export function summarizeScoreGraph(scoreGraph = { measures: [] }) {
  const nodeCounts = countNodesByKind(scoreGraph)
  const edgeCounts = countEdgesByKind(scoreGraph)
  let onsetColumns = 0
  let bridgeMatched = 0
  let bridgeTotal = 0
  let measuresWithGraph = 0
  for (const measure of scoreGraph.measures ?? []) {
    onsetColumns += measure.onsetColumns?.length ?? 0
    bridgeMatched += measure.provenance?.geometryBridge?.matched ?? 0
    bridgeTotal += measure.provenance?.geometryBridge?.total ?? 0
    if (measure.provenance?.hasBeamStemGraph) {
      measuresWithGraph += 1
    }
  }
  return {
    version: scoreGraph.version ?? SCORE_GRAPH_VERSION,
    measureCount: scoreGraph.measures?.length ?? 0,
    measuresWithBeamStemGraph: measuresWithGraph,
    nodeCounts,
    edgeCounts,
    totalNodes: Object.values(nodeCounts).reduce((sum, count) => sum + count, 0),
    totalEdges: Object.values(edgeCounts).reduce((sum, count) => sum + count, 0),
    onsetColumns,
    geometryBridge: {
      matched: bridgeMatched,
      total: bridgeTotal,
      coverage: bridgeTotal > 0 ? round(bridgeMatched / bridgeTotal, 4) : null,
    },
  }
}

/**
 * Diagnostic: confirm the ScoreGraph faithfully mirrors runtime events, and
 * surface how much geometry (stems/beams) is bridged to musical noteheads.
 * Parity should be exact by construction; if it is not, the IR builder drifted.
 */
export function buildRuntimeVsScoreGraphReport(pages = [], scoreGraph = null) {
  const graph = scoreGraph ?? buildScoreGraph(pages)

  let runtimeNoteCount = 0
  let runtimeRestCount = 0
  let runtimeNoteEventCount = 0
  for (const page of pages ?? []) {
    for (const system of page.systems ?? []) {
      for (const measure of system.measures ?? []) {
        for (const event of measure.events ?? []) {
          if (event.type === 'rest') {
            runtimeRestCount += 1
          } else if (event.type === 'note') {
            runtimeNoteEventCount += 1
            runtimeNoteCount += event.notes?.length ?? 0
          }
        }
      }
    }
  }

  const summary = summarizeScoreGraph(graph)
  const irNoteheads = summary.nodeCounts[SCORE_GRAPH_NODE.NOTEHEAD] ?? 0
  const irRests = summary.nodeCounts[SCORE_GRAPH_NODE.REST] ?? 0

  return {
    runtime: {
      noteCount: runtimeNoteCount,
      restCount: runtimeRestCount,
      noteEventCount: runtimeNoteEventCount,
    },
    scoreGraph: {
      noteheadNodes: irNoteheads,
      restNodes: irRests,
      stemNodes: summary.nodeCounts[SCORE_GRAPH_NODE.STEM] ?? 0,
      beamNodes: summary.nodeCounts[SCORE_GRAPH_NODE.BEAM] ?? 0,
    },
    parity: {
      noteheads: irNoteheads === runtimeNoteCount,
      rests: irRests === runtimeRestCount,
    },
    geometryBridge: summary.geometryBridge,
  }
}
