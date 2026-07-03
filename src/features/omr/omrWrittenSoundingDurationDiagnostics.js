/**
 * Phase 3 — classify dense duration errors as written vs sounding vs coupling artifacts.
 * Diagnostic only; does not change runtime OMR output.
 */

import {
  categorizeDurationError,
  DURATION_ERROR_CATEGORY,
  summarizeDurationErrors,
} from './omrDurationErrorAnalysis.js'
import { hotspotMeasuresForFixture } from './omrHotspotDiagnostics.js'
import { traceTieChainsInMeasure } from './scoreGraphDurationObservation.js'
import { SCORE_GRAPH_NODE } from './scoreGraph.js'

export const WRITTEN_SOUNDING_DURATION_CLASS = {
  WRITTEN_DURATION_WRONG: 'written-duration-wrong',
  SOUNDING_RELEASE_WRONG: 'sounding-release-wrong',
  ONSET_COUPLED_DURATION: 'onset-coupled-duration',
  TIE_SUSTAIN_RELATED: 'tie-sustain-related',
  SERIALIZATION_ARTIFACT: 'serialization-artifact',
}

/** Gymnopédie (clean fixture) — tie-chain observation target. */
export const OMR_V2_TIE_CHAIN_FIXTURES = new Set(['clean'])

function histogramTemplate() {
  return Object.fromEntries(
    Object.values(WRITTEN_SOUNDING_DURATION_CLASS).map((bucket) => [bucket, 0]),
  )
}

/**
 * Classify one wrong-duration evaluator row into written/sounding buckets.
 */
export function classifyWrittenSoundingDurationError(entry = {}) {
  const onsetDelta = Math.abs(Number(entry.onsetDiffQuarters) || 0)
  const pitchDelta = Math.abs(Number(entry.pitchDeltaSemitones) || 0)
  const legacy = categorizeDurationError(entry)

  if (legacy === DURATION_ERROR_CATEGORY.ONSET_COUPLED) {
    return WRITTEN_SOUNDING_DURATION_CLASS.ONSET_COUPLED_DURATION
  }
  if (legacy === DURATION_ERROR_CATEGORY.TIE_SUSTAIN) {
    return WRITTEN_SOUNDING_DURATION_CLASS.TIE_SUSTAIN_RELATED
  }
  if (onsetDelta > 0.15 && pitchDelta > 1) {
    return WRITTEN_SOUNDING_DURATION_CLASS.SERIALIZATION_ARTIFACT
  }
  if (onsetDelta > 0.15 && pitchDelta <= 1) {
    return WRITTEN_SOUNDING_DURATION_CLASS.ONSET_COUPLED_DURATION
  }
  if (
    legacy === DURATION_ERROR_CATEGORY.BASS_SUSTAIN ||
    legacy === DURATION_ERROR_CATEGORY.MELODY_ACCOMPANIMENT
  ) {
    return WRITTEN_SOUNDING_DURATION_CLASS.SOUNDING_RELEASE_WRONG
  }
  if (legacy === DURATION_ERROR_CATEGORY.REST_GAP) {
    return WRITTEN_SOUNDING_DURATION_CLASS.SOUNDING_RELEASE_WRONG
  }
  return WRITTEN_SOUNDING_DURATION_CLASS.WRITTEN_DURATION_WRONG
}

export function summarizeWrittenSoundingDurationErrors(wrongDurations = []) {
  const histogram = histogramTemplate()
  for (const entry of wrongDurations) {
    histogram[classifyWrittenSoundingDurationError(entry)] += 1
  }
  return histogram
}

function perMeasureDurationSplit(wrongDurations = [], measureNumbers = null) {
  const targetSet = measureNumbers?.length ? new Set(measureNumbers) : null
  const byMeasure = new Map()

  for (const entry of wrongDurations) {
    const measureNumber = entry.measureNumber ?? entry.truth?.measureNumber ?? entry.generated?.measureNumber
    if (measureNumber == null) {
      continue
    }
    if (targetSet && !targetSet.has(measureNumber)) {
      continue
    }
    if (!byMeasure.has(measureNumber)) {
      byMeasure.set(measureNumber, {
        measureNumber,
        wrongDurationCount: 0,
        histogram: histogramTemplate(),
        samples: [],
      })
    }
    const bucket = classifyWrittenSoundingDurationError(entry)
    const row = byMeasure.get(measureNumber)
    row.wrongDurationCount += 1
    row.histogram[bucket] += 1
    if (row.samples.length < 8) {
      row.samples.push({
        bucket,
        onsetDiffQuarters: entry.onsetDiffQuarters ?? null,
        durationDiffQuarters: entry.durationDiffQuarters ?? null,
        pitchDeltaSemitones: entry.pitchDeltaSemitones ?? null,
        truthLabel: entry.truth?.label ?? null,
        generatedLabel: entry.generated?.label ?? null,
      })
    }
  }

  return [...byMeasure.values()].sort((left, right) => left.measureNumber - right.measureNumber)
}

function measureGraphToEvents(measureGraph = {}) {
  const byEvent = new Map()
  for (const node of measureGraph.nodes ?? []) {
    if (node.kind !== SCORE_GRAPH_NODE.NOTEHEAD && node.kind !== SCORE_GRAPH_NODE.REST) {
      continue
    }
    const key = node.eventIndex ?? `${node.kind}-${node.onsetDivision}`
    if (!byEvent.has(key)) {
      byEvent.set(key, {
        type: node.kind === SCORE_GRAPH_NODE.REST ? 'rest' : 'note',
        startDivision: node.onsetDivision ?? 0,
        durationDivisions: node.durationDivisions ?? 0,
        notes: [],
        beams: node.beams ?? undefined,
        dotted: Boolean(node.dotted),
      })
    }
    if (node.kind === SCORE_GRAPH_NODE.NOTEHEAD) {
      byEvent.get(key).notes.push({
        midi: node.midi,
        clef: node.clef,
        tieStart: node.tieStart,
        tieStop: node.tieStop,
      })
    }
  }
  return [...byEvent.values()].sort(
    (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
  )
}

export function buildTieChainDiagnostics(scoreGraphMeasures = [], { fixtureId = null } = {}) {
  if (!OMR_V2_TIE_CHAIN_FIXTURES.has(fixtureId)) {
    return null
  }

  const perMeasure = []
  for (const measure of scoreGraphMeasures) {
    const events = measureGraphToEvents(measure)
    const chains = traceTieChainsInMeasure(events, { measureNumber: measure.measureNumber })
    if (!chains.length) {
      continue
    }
    perMeasure.push({
      measureNumber: measure.measureNumber,
      tieChainCount: chains.length,
      chains: chains.slice(0, 6),
    })
  }

  if (!perMeasure.length) {
    return null
  }

  return {
    fixtureId,
    measureCount: perMeasure.length,
    totalChains: perMeasure.reduce((sum, entry) => sum + entry.tieChainCount, 0),
    perMeasure: perMeasure.slice(0, 24),
  }
}

/**
 * Dashboard bundle: legacy duration histogram + written/sounding split + hotspot traces.
 */
export function buildWrittenSoundingDurationDiagnostics(
  report = {},
  { fixtureId = null, scoreGraphMeasures = null } = {},
) {
  const wrongDurations = report.debug?.wrongDurations ?? []
  const hotspotMeasures = hotspotMeasuresForFixture(fixtureId)
  const writtenSoundingHistogram = summarizeWrittenSoundingDurationErrors(wrongDurations)
  const legacyHistogram = summarizeDurationErrors(wrongDurations)

  const dominantClass = Object.entries(writtenSoundingHistogram).sort(
    (left, right) => right[1] - left[1],
  )[0]

  return {
    fixtureId,
    phase: 3,
    totalWrongDurations: wrongDurations.length,
    legacyDurationHistogram: legacyHistogram,
    writtenSoundingHistogram,
    dominantClass: dominantClass?.[1] > 0 ? { bucket: dominantClass[0], count: dominantClass[1] } : null,
    hotspotMeasures,
    hotspotTraces: perMeasureDurationSplit(wrongDurations, hotspotMeasures),
    tieChains: scoreGraphMeasures
      ? buildTieChainDiagnostics(scoreGraphMeasures, { fixtureId })
      : null,
  }
}

export function formatWrittenSoundingDurationMarkdown(diagnostics, { indent = '' } = {}) {
  if (!diagnostics?.writtenSoundingHistogram) {
    return ''
  }
  const lines = [`${indent}Written vs sounding duration (V2 Phase 3):`]
  const entries = Object.entries(diagnostics.writtenSoundingHistogram).filter(([, count]) => count > 0)
  if (!entries.length) {
    lines.push(`${indent}- (no duration errors in report sample)`)
    return `${lines.join('\n')}\n`
  }
  for (const [bucket, count] of entries.sort((left, right) => right[1] - left[1])) {
    lines.push(`${indent}- ${bucket}: ${count}`)
  }
  if (diagnostics.dominantClass) {
    lines.push(
      `${indent}- Dominant: ${diagnostics.dominantClass.bucket} (${diagnostics.dominantClass.count})`,
    )
  }
  if (diagnostics.hotspotTraces?.length) {
    lines.push(`${indent}- Hotspot duration traces:`)
    for (const measure of diagnostics.hotspotTraces) {
      const top = Object.entries(measure.histogram)
        .filter(([, count]) => count > 0)
        .map(([bucket, count]) => `${bucket}=${count}`)
        .join(', ')
      lines.push(
        `${indent}  - m${measure.measureNumber}: ${measure.wrongDurationCount} wrong durations${top ? ` (${top})` : ''}`,
      )
    }
  }
  if (diagnostics.tieChains?.perMeasure?.length) {
    lines.push(
      `${indent}- Tie chains (${diagnostics.tieChains.fixtureId}): ${diagnostics.tieChains.totalChains} chain(s) in ${diagnostics.tieChains.measureCount} measure(s)`,
    )
  }
  return `${lines.join('\n')}\n`
}
