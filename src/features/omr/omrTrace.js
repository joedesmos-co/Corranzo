/**
 * High-signal OMR execution tracing (structured console output).
 * Disable in dev with: localStorage.setItem('scoreflow:omr-trace', '0')
 */

import { getOmrDiagnosticFlags, isOmrTraceGroupsEnabled, OMR_DIAGNOSTIC_FLAG } from './omrDiagnosticFlags.js'

let traceRunId = 0
const activePhaseGroups = new Map()

function performanceNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

export function nextOmrTraceRunId() {
  traceRunId += 1
  return traceRunId
}

export function isOmrTraceEnabled() {
  return getOmrDiagnosticFlags().trace
}

function formatTracePrefix({ runId = null, phase = null, ms = null } = {}) {
  const parts = ['[omr-trace]']
  if (runId != null) {
    parts.push(`run=${runId}`)
  }
  if (phase) {
    parts.push(`phase=${phase}`)
  }
  if (ms != null) {
    parts.push(`ms=${ms}`)
  }
  return parts.join(' ')
}

function logTraceLine(prefix, label, detail = null) {
  const message = `${prefix} ${label}`
  if (detail == null) {
    console.log(message)
    return
  }
  console.log(message, detail)
}

export function omrTrace(label, detail = null, runId = null) {
  if (!isOmrTraceEnabled()) {
    return
  }
  logTraceLine(formatTracePrefix({ runId }), label, detail)
}

export function omrTraceError(code, message, detail = null, runId = null) {
  if (!isOmrTraceEnabled()) {
    return
  }
  const payload = {
    code,
    message,
    ...(detail && typeof detail === 'object' ? detail : { detail }),
  }
  console.error(`${formatTracePrefix({ runId })} error code=${code}`, payload)
}

export function omrTracePhaseStart(phase, runId = null) {
  if (!isOmrTraceEnabled()) {
    return null
  }
  const token = {
    phase,
    runId,
    start: performanceNow(),
  }
  const prefix = formatTracePrefix({ runId, phase })
  if (isOmrTraceGroupsEnabled()) {
    const groupKey = `${runId ?? 'global'}:${phase}`
    console.groupCollapsed(`${prefix} start`)
    activePhaseGroups.set(groupKey, true)
    token.groupKey = groupKey
  } else {
    logTraceLine(prefix, 'start')
  }
  return token
}

export function omrTracePhaseEnd(token, detail = null) {
  if (!token || !isOmrTraceEnabled()) {
    return
  }
  const ms = Math.round(performanceNow() - token.start)
  const prefix = formatTracePrefix({ runId: token.runId, phase: token.phase, ms })
  logTraceLine(prefix, 'end', detail)
  if (token.groupKey && activePhaseGroups.has(token.groupKey)) {
    console.groupEnd()
    activePhaseGroups.delete(token.groupKey)
  }
}

export function createOmrPhaseTracer(runId = null) {
  return {
    async run(phase, fn) {
      const token = omrTracePhaseStart(phase, runId)
      try {
        const result = await fn()
        omrTracePhaseEnd(token)
        return result
      } catch (error) {
        omrTraceError(
          'phase-failed',
          error?.message ?? String(error),
          { phase, name: error?.name ?? null },
          runId,
        )
        omrTracePhaseEnd(token, { failed: true })
        throw error
      }
    },
    sync(phase, fn) {
      const token = omrTracePhaseStart(phase, runId)
      try {
        const result = fn()
        omrTracePhaseEnd(token)
        return result
      } catch (error) {
        omrTraceError(
          'phase-failed',
          error?.message ?? String(error),
          { phase, name: error?.name ?? null },
          runId,
        )
        omrTracePhaseEnd(token, { failed: true })
        throw error
      }
    },
    mark(label, detail = null) {
      omrTrace(label, detail, runId)
    },
  }
}

export { OMR_DIAGNOSTIC_FLAG }
