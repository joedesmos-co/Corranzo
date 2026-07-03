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
 */

export const OMR_DIAGNOSTIC_FLAG = {
  TRACE: 'scoreflow:omr-trace',
  DEBUG: 'scoreflow:omr-debug',
  TRACE_GROUPS: 'scoreflow:omr-trace-groups',
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
  ].join('\n')
}
