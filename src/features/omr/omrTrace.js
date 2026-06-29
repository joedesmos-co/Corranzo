/**
 * High-signal OMR execution tracing (console.log — visible without Verbose filter).
 * Disable in dev with: localStorage.setItem('scoreflow:omr-trace', '0')
 */

let traceRunId = 0

export function nextOmrTraceRunId() {
  traceRunId += 1
  return traceRunId
}

export function isOmrTraceEnabled() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.PROD) {
      return false
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('scoreflow:omr-trace') === '0') {
      return false
    }
  } catch {
    // ignore
  }
  return true
}

export function omrTrace(label, detail = null, runId = null) {
  if (!isOmrTraceEnabled()) {
    return
  }
  const prefix = runId != null ? `[omr-trace run=${runId}]` : '[omr-trace]'
  if (detail == null) {
    console.log(`${prefix} ${label}`)
    return
  }
  console.log(`${prefix} ${label}`, detail)
}
