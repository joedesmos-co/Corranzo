/**
 * Per-measure hotspot diagnostics for OMR Engine V2 planning canaries.
 * Diagnostic only — no runtime OMR changes.
 *
 * @see docs/OMR_ENGINE_V2_PLAN.md Appendix B
 */

import { buildRhythmErrorAttribution } from './omrRhythmErrorAttribution.js'
import { summarizeOnsetVoicePhaseDiagnosis } from './omrOnsetVoiceTrace.js'
import { buildWrittenSoundingDurationDiagnostics } from './omrWrittenSoundingDurationDiagnostics.js'

/** Cruel Angel dense canaries + Twinkle m10 (simple fixture). */
export const OMR_V2_HOTSPOT_MEASURES_BY_FIXTURE = {
  dense: [7, 9, 121],
  simple: [10],
}

export function hotspotMeasuresForFixture(fixtureId) {
  return OMR_V2_HOTSPOT_MEASURES_BY_FIXTURE[fixtureId] ?? []
}

/**
 * Compact per-measure trace bundle for dashboard export.
 */
export function buildHotspotDiagnostics(report = {}, { fixtureId = null, scoreGraphMeasures = null } = {}) {
  const measureNumbers = hotspotMeasuresForFixture(fixtureId)
  if (!measureNumbers.length) {
    return null
  }

  const onsetVoicePhase = summarizeOnsetVoicePhaseDiagnosis(report, { measureNumbers })
  const perMeasure = onsetVoicePhase.perMeasure.map((entry) => ({
    measureNumber: entry.measureNumber,
    wrongOnsetCount: entry.wrongOnsetCount,
    errorClassHistogram: entry.histogram,
    dominantDelta: entry.dominantDelta,
    rows: entry.rows.slice(0, 12),
  }))

  const durationSplit = buildWrittenSoundingDurationDiagnostics(report, {
    fixtureId,
    scoreGraphMeasures,
  })

  return {
    fixtureId,
    measureNumbers,
    rhythmAttribution: buildRhythmErrorAttribution(report),
    durationSplit,
    onsetVoicePhase: {
      totalWrongOnsets: onsetVoicePhase.totalWrongOnsets,
      strictIndependent: onsetVoicePhase.strictIndependent,
      errorClassHistogram: onsetVoicePhase.errorClassHistogram,
      signedDeltaHistogram: onsetVoicePhase.signedDeltaHistogram,
      perMeasure,
    },
  }
}

export function formatHotspotDiagnosticsMarkdown(hotspots, { indent = '' } = {}) {
  if (!hotspots?.onsetVoicePhase?.perMeasure?.length) {
    return ''
  }
  const lines = [`${indent}Hotspot measures (${hotspots.fixtureId}):`]
  for (const measure of hotspots.onsetVoicePhase.perMeasure) {
    const classes = Object.entries(measure.errorClassHistogram ?? {})
      .filter(([, count]) => count > 0)
      .map(([bucket, count]) => `${bucket}=${count}`)
      .join(', ')
    lines.push(
      `${indent}- m${measure.measureNumber}: ${measure.wrongOnsetCount} wrong onsets${classes ? ` (${classes})` : ''}`,
    )
  }
  return `${lines.join('\n')}\n`
}
