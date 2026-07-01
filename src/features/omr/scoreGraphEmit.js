/**
 * ScoreGraph shadow MusicXML emitter — Phase 2.
 *
 * Emits MusicXML *from the ScoreGraph IR* and compares it against the runtime
 * MusicXML. This is a SHADOW path only:
 *
 *   - It is never wired into runtime output or playback.
 *   - `buildOmrMusicXml` (the runtime serializer) is reused unchanged.
 *   - Divergence between shadow and runtime is measured/reported, never promoted.
 *
 * Because the Phase-1 IR derives its musical layer from the runtime events, a
 * faithful emitter should round-trip to (near) identical MusicXML. The remaining,
 * reported gaps (per-measure repeats/dynamics/pedals, beams, articulations) are
 * markings the Phase-1 IR does not yet carry — not solver decisions. Future
 * phases replace the event grouping with a joint solve; the divergence then
 * becomes intentional and this same harness measures it.
 */

import { buildOmrMusicXml } from './buildOmrMusicXml.js'
import { parseMusicXml } from '../musicxml/parseMusicXml.js'
import { evaluateOmrAccuracy } from './omrAccuracyEvaluator.js'
import { SCORE_GRAPH_NODE } from './scoreGraph.js'

/**
 * Rebuild runtime-shaped measure records (with events) from a ScoreGraph.
 * Grouping uses the event provenance the IR records, so it reconstructs the
 * exact runtime event structure rather than re-inferring it.
 */
export function reconstructMeasureEvents(measureGraph = {}) {
  const byEvent = new Map()
  for (const node of measureGraph.nodes ?? []) {
    if (node.kind !== SCORE_GRAPH_NODE.NOTEHEAD && node.kind !== SCORE_GRAPH_NODE.REST) {
      continue
    }
    const key = node.eventIndex ?? `${node.kind}-${node.onsetDivision}`
    if (!byEvent.has(key)) {
      byEvent.set(key, [])
    }
    byEvent.get(key).push(node)
  }

  const events = []
  for (const [, group] of byEvent) {
    const first = group[0]
    if (first.kind === SCORE_GRAPH_NODE.REST) {
      events.push({
        type: 'rest',
        startDivision: first.onsetDivision ?? 0,
        durationDivisions: first.durationDivisions ?? 0,
        durationType: first.durationType ?? undefined,
        clef: first.clef ?? undefined,
      })
      continue
    }
    events.push({
      type: 'note',
      startDivision: first.onsetDivision ?? 0,
      durationDivisions: first.durationDivisions ?? 0,
      durationType: first.durationType ?? undefined,
      dotted: Boolean(first.dotted),
      tieStart: group.some((node) => node.tieStart),
      tieStop: group.some((node) => node.tieStop),
      beams: first.beams ?? undefined,
      notes: group.map((node) => ({
        midi: node.midi,
        clef: node.clef,
        articulation: node.articulation ?? undefined,
      })),
    })
  }

  events.sort((left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0))
  return events
}

export function reconstructMeasuresFromScoreGraph(scoreGraph = { measures: [] }) {
  return (scoreGraph.measures ?? []).map((measureGraph) => ({
    measureNumber: measureGraph.measureNumber,
    page: measureGraph.page,
    systemIndex: measureGraph.systemIndex,
    events: reconstructMeasureEvents(measureGraph),
  }))
}

/**
 * Emit shadow MusicXML from a ScoreGraph, reusing the runtime serializer.
 */
export function emitMusicXmlFromScoreGraph(scoreGraph, { musical = {}, title = 'ScoreGraph shadow' } = {}) {
  const measures = reconstructMeasuresFromScoreGraph(scoreGraph)
  return buildOmrMusicXml({ title, measures, musical, includeDisclaimer: true })
}

function countTimingMap(xml, fileName) {
  const timing = parseMusicXml(xml, fileName)
  const notes = (timing?.notes ?? []).filter((note) => !note.isRest && note.midi != null)
  const measures = timing?.measures ?? []
  return { noteCount: notes.length, measureCount: measures.length }
}

/**
 * Structural diff between runtime XML and shadow XML.
 */
export function compareRuntimeVsShadow(runtimeXml, shadowXml) {
  const runtime = countTimingMap(runtimeXml, 'runtime.musicxml')
  const shadow = countTimingMap(shadowXml, 'shadow.musicxml')
  return {
    runtime,
    shadow,
    noteCountDiff: shadow.noteCount - runtime.noteCount,
    measureCountDiff: shadow.measureCount - runtime.measureCount,
    identicalBytes: runtimeXml === shadowXml,
  }
}

function metricSet(report) {
  const metrics = report?.metrics ?? {}
  return {
    pitch: metrics.pitchAccuracy ?? null,
    duration: metrics.durationAccuracy ?? null,
    onset: metrics.onsetAccuracy ?? null,
    chord: metrics.chordGroupingAccuracy ?? null,
    f1: metrics.noteDetectionF1 ?? null,
  }
}

/**
 * Evaluate one MusicXML against another. Using the runtime XML as the reference
 * yields "how much does shadow agree with runtime" (100% == identical content).
 */
export function evaluateShadowAgreement(shadowXml, referenceXml) {
  const report = evaluateOmrAccuracy({
    generatedMusicXml: shadowXml,
    groundTruthMusicXml: referenceXml,
  })
  return metricSet(report)
}

/**
 * Full shadow report for one fixture: structural diff + shadow↔runtime agreement,
 * and (when a truth file is provided) the evaluator delta of shadow vs runtime.
 */
export function buildScoreGraphShadowReport({
  id = 'fixture',
  runtimeXml,
  shadowXml,
  truthXml = null,
} = {}) {
  const comparison = compareRuntimeVsShadow(runtimeXml, shadowXml)
  const agreementVsRuntime = evaluateShadowAgreement(shadowXml, runtimeXml)

  let vsTruth = null
  if (truthXml) {
    const runtimeVsTruth = metricSet(
      evaluateOmrAccuracy({ generatedMusicXml: runtimeXml, groundTruthMusicXml: truthXml }),
    )
    const shadowVsTruth = metricSet(
      evaluateOmrAccuracy({ generatedMusicXml: shadowXml, groundTruthMusicXml: truthXml }),
    )
    const delta = {}
    for (const key of Object.keys(runtimeVsTruth)) {
      const a = shadowVsTruth[key]
      const b = runtimeVsTruth[key]
      delta[key] = a != null && b != null ? Math.round((a - b) * 10000) / 10000 : null
    }
    vsTruth = { runtime: runtimeVsTruth, shadow: shadowVsTruth, delta }
  }

  return { id, comparison, agreementVsRuntime, vsTruth }
}

function pct(value) {
  return value == null ? 'n/a' : `${Math.round(value * 100)}%`
}

function signed(value) {
  if (value == null) {
    return 'n/a'
  }
  const rounded = Math.round(value * 10000) / 100
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}

/**
 * Render a markdown section comparing runtime vs shadow across fixtures.
 * Standalone (does not modify the existing benchmark dashboard output).
 */
export function formatScoreGraphShadowMarkdown(reports = []) {
  const lines = ['# ScoreGraph shadow emitter comparison', '', `Fixtures: ${reports.length}`, '']
  for (const report of reports) {
    lines.push(`## ${report.id}`)
    const c = report.comparison
    lines.push(
      `- notes: runtime ${c.runtime.noteCount}, shadow ${c.shadow.noteCount} (Δ ${c.noteCountDiff})`,
    )
    lines.push(
      `- measures: runtime ${c.runtime.measureCount}, shadow ${c.shadow.measureCount} (Δ ${c.measureCountDiff})`,
    )
    const a = report.agreementVsRuntime
    lines.push(
      `- shadow↔runtime agreement: pitch ${pct(a.pitch)}, duration ${pct(a.duration)}, onset ${pct(a.onset)}, chord ${pct(a.chord)}, F1 ${pct(a.f1)}`,
    )
    if (report.vsTruth) {
      const d = report.vsTruth.delta
      lines.push(
        `- shadow − runtime vs truth: pitch ${signed(d.pitch)}, duration ${signed(d.duration)}, onset ${signed(d.onset)}, chord ${signed(d.chord)}, F1 ${signed(d.f1)}`,
      )
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}
