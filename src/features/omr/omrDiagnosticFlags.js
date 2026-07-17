/**
 * Central toggles for OMR developer diagnostics (localStorage in dev only).
 *
 * Trace (console.log, high signal):
 *   localStorage.setItem('scoreflow:omr-trace', '1')  // force on in dev
 *   localStorage.setItem('scoreflow:omr-trace', '0')  // force off
 *
 * Debug (console.debug, image buffer dumps):
 *   localStorage.setItem('scoreflow:omr-debug', '1')
 *   localStorage.setItem('scoreflow:omr-debug', '0')
 *
 * Trace groups (console.groupCollapsed per phase):
 *   localStorage.setItem('scoreflow:omr-trace-groups', '1')
 *
 * V3 comparison mode (runs independent V3 beside V2; V2 stays user-visible):
 *   localStorage.setItem('scoreflow:omr-v3-compare', '1')
 *
 * Prefer V3 MusicXML in the UI (dev only; never arms runtime promotion):
 *   localStorage.setItem('scoreflow:omr-v3-prefer', '1')
 *
 * Emit compact V2↔V3 disagreement telemetry to the console (dev only):
 *   localStorage.setItem('scoreflow:omr-v3-telemetry', '1')
 */

export const OMR_DIAGNOSTIC_FLAG = {
  TRACE: 'scoreflow:omr-trace',
  DEBUG: 'scoreflow:omr-debug',
  TRACE_GROUPS: 'scoreflow:omr-trace-groups',
  V3_COMPARE: 'scoreflow:omr-v3-compare',
  V3_PREFER: 'scoreflow:omr-v3-prefer',
  V3_TELEMETRY: 'scoreflow:omr-v3-telemetry',
}

const memoryFlags = new Map()

function readFlag(key, defaultWhenUnset) {
  if (memoryFlags.has(key)) {
    return memoryFlags.get(key)
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.PROD) {
      return false
    }
    if (typeof localStorage === 'undefined') {
      return defaultWhenUnset
    }
    const value = localStorage.getItem(key)
    if (value === '1' || value === 'true') {
      return true
    }
    if (value === '0' || value === 'false') {
      return false
    }
  } catch {
    // ignore storage errors
  }
  return defaultWhenUnset
}

export function isOmrTraceGroupsEnabled() {
  return readFlag(OMR_DIAGNOSTIC_FLAG.TRACE_GROUPS, false)
}

export function getOmrDiagnosticFlags() {
  const traceDefault =
    typeof import.meta === 'undefined' || import.meta.env?.PROD ? false : true
  const debugDefault =
    typeof import.meta === 'undefined' || import.meta.env?.DEV !== false
  return {
    trace: readFlag(OMR_DIAGNOSTIC_FLAG.TRACE, traceDefault),
    debug: readFlag(OMR_DIAGNOSTIC_FLAG.DEBUG, debugDefault),
    traceGroups: readFlag(OMR_DIAGNOSTIC_FLAG.TRACE_GROUPS, false),
    v3Compare: readFlag(OMR_DIAGNOSTIC_FLAG.V3_COMPARE, false),
    v3Prefer: readFlag(OMR_DIAGNOSTIC_FLAG.V3_PREFER, false),
    v3Telemetry: readFlag(OMR_DIAGNOSTIC_FLAG.V3_TELEMETRY, false),
  }
}

/**
 * Pipeline options derived from developer diagnostic flags.
 * Never enables runtime promotion or alters production defaults in PROD.
 */
export function resolveOmrV3DeveloperPipelineOptions(flags = getOmrDiagnosticFlags()) {
  const isProd =
    typeof import.meta !== 'undefined' && import.meta.env?.PROD === true
  if (isProd) {
    return {
      omrV3Compare: false,
      omrV3Shadow: false,
      preferV3Output: false,
      logV3Telemetry: false,
    }
  }
  return {
    omrV3Compare: Boolean(flags.v3Compare),
    // Compare mode implies shadow so both engines run with page capture.
    omrV3Shadow: Boolean(flags.v3Compare || flags.v3Prefer),
    preferV3Output: Boolean(flags.v3Prefer),
    logV3Telemetry: Boolean(flags.v3Telemetry || flags.v3Compare),
  }
}

export function setOmrDiagnosticFlag(flag, enabled) {
  memoryFlags.set(flag, enabled)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(flag, enabled ? '1' : '0')
    }
  } catch {
    // ignore storage errors
  }
  return getOmrDiagnosticFlags()
}

export function formatOmrDiagnosticHelp() {
  return [
    'OMR diagnostic flags (dev only):',
    `  ${OMR_DIAGNOSTIC_FLAG.TRACE}=1|0 — structured pipeline trace logs`,
    `  ${OMR_DIAGNOSTIC_FLAG.DEBUG}=1|0 — per-step image buffer debug`,
    `  ${OMR_DIAGNOSTIC_FLAG.TRACE_GROUPS}=1 — collapse phases in console groups`,
    `  ${OMR_DIAGNOSTIC_FLAG.V3_COMPARE}=1 — run V2+V3 comparison (V2 stays user-visible)`,
    `  ${OMR_DIAGNOSTIC_FLAG.V3_PREFER}=1 — prefer V3 MusicXML in developer UI only`,
    `  ${OMR_DIAGNOSTIC_FLAG.V3_TELEMETRY}=1 — log compact V2↔V3 disagreement telemetry`,
  ].join('\n')
}
