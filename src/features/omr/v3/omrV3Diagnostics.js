/**
 * Developer diagnostics for OMR V2 ↔ V3 validation.
 *
 * Builds a side-by-side package (MusicXML, timings, stats, confidence) without
 * changing recognition. Prefer-V3 selection is explicit and never implied.
 */

import {
  compareOmrV2V3MusicXml,
  buildOmrV3DisagreementTelemetry,
  formatOmrV3ComparisonReport,
} from './omrV3Comparison.js'

export const OMR_V3_DIAGNOSTICS_VERSION = 1

/**
 * @param {'v2' | 'v3'} prefer
 * @param {object} result Pipeline result with optional V3 shadows.
 * @returns {{ engine: 'v2' | 'v3', musicXml: string, reason: string }}
 */
export function selectOmrDeveloperMusicXml(result, prefer = 'v2') {
  const v2 = String(result?.musicXml ?? '')
  const v3 =
    result?.omrV3IndependentShadow?.musicXml ??
    result?.omrV3Shadow?.musicXml ??
    null
  if (prefer === 'v3' && typeof v3 === 'string' && v3.length > 0) {
    return { engine: 'v3', musicXml: v3, reason: 'developer-prefer-v3' }
  }
  return { engine: 'v2', musicXml: v2, reason: prefer === 'v3' ? 'v3-unavailable' : 'default-v2' }
}

/**
 * Assemble a developer-facing diagnostics object from a pipeline result.
 * Safe to attach to results when comparison/shadow mode is enabled.
 */
export function buildOmrV3DeveloperDiagnostics(result, { prefer = 'v2' } = {}) {
  const v2MusicXml = String(result?.musicXml ?? '')
  const independent = result?.omrV3IndependentShadow ?? null
  const compatibility = result?.omrV3Shadow ?? null
  const v3MusicXml = independent?.musicXml ?? compatibility?.musicXml ?? ''
  const performance = result?.diagnostics?.performance ?? null
  const phases = Array.isArray(performance?.phases) ? performance.phases : []

  const comparison =
    result?.omrV3Comparison ??
    (v2MusicXml && v3MusicXml
      ? compareOmrV2V3MusicXml({
          v2MusicXml,
          v3MusicXml,
          v2Confidence: {
            overall:
              result?.diagnostics?.omrV3Confidence?.legacyConfidence ??
              result?.overallConfidence ??
              null,
          },
          v3Confidence: {
            overall:
              result?.diagnostics?.omrV3Confidence?.overallConfidence ??
              independent?.evaluation?.confidence?.overall ??
              null,
          },
          v3Serializer: independent?.serializer ?? compatibility?.serializer ?? null,
        })
      : null)

  const selected = selectOmrDeveloperMusicXml(
    { ...result, musicXml: v2MusicXml },
    prefer,
  )

  return {
    version: OMR_V3_DIAGNOSTICS_VERSION,
    preferredEngine: selected.engine,
    preferredReason: selected.reason,
    userVisibleEngine: result?.omrV3RuntimePromotion?.promotedToRuntime ? 'v3' : 'v2',
    musicXml: {
      v2: v2MusicXml,
      v3: v3MusicXml || null,
      v2ByteLength: v2MusicXml.length,
      v3ByteLength: v3MusicXml ? v3MusicXml.length : 0,
      sideBySideAvailable: Boolean(v2MusicXml && v3MusicXml),
    },
    comparison,
    comparisonText: comparison ? formatOmrV3ComparisonReport(comparison) : null,
    disagreementTelemetry: buildOmrV3DisagreementTelemetry(comparison),
    recognition: {
      noteCount: result?.noteCount ?? null,
      measureCount: result?.measureCount ?? null,
      uncertainMeasures: result?.uncertainMeasures ?? null,
      overallConfidence: result?.overallConfidence ?? null,
      v3Serializer: independent?.serializer ?? null,
      independentStatus: independent?.status ?? null,
      compatibilityStatus: compatibility?.status ?? null,
      independentPrimaryEventRate: independent?.evidence?.independentPrimaryEventRate ?? null,
    },
    confidence: {
      productionOverall: result?.overallConfidence ?? null,
      v3Overall: result?.diagnostics?.omrV3Confidence?.overallConfidence ?? null,
      v3Legacy: result?.diagnostics?.omrV3Confidence?.legacyConfidence ?? null,
      v3Structural: result?.diagnostics?.omrV3Confidence?.structuralConfidence ?? null,
      method: result?.diagnostics?.omrV3Confidence?.method ?? null,
    },
    timing: {
      totalMs: performance?.totalMs ?? null,
      phases: phases.map((phase) => ({
        phase: phase.phase,
        ms: phase.ms,
      })),
      v3ConfidenceMs: phaseMs(phases, 'omr-v3-confidence'),
      v3ShadowMs: phaseMs(phases, 'omr-v3-shadow'),
      v3IndependentShadowMs: phaseMs(phases, 'omr-v3-independent-shadow'),
    },
    rollout: {
      mode: result?.omrV3RuntimePromotion?.rolloutMode ?? null,
      decision: result?.omrV3RuntimePromotion?.decision ?? null,
      promotedToRuntime: result?.omrV3RuntimePromotion?.promotedToRuntime === true,
      disagreement: result?.omrV3RuntimePromotion?.disagreement ?? null,
    },
  }
}

function phaseMs(phases, name) {
  const entry = phases.find((phase) => phase.phase === name)
  return entry?.ms ?? null
}
