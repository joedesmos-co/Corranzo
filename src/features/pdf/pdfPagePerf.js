/**
 * PDF page transition instrumentation (dev / opt-in via localStorage).
 */

const SLOW_SWITCH_MS = 50
const PERF_STORAGE_KEY = 'corranzo-pdf-perf'

/** @type {{ fromPage: number, toPage: number, startedAt: number, trigger: string } | null} */
let pendingSwitch = null

const warmPages = new Set()

export function isPdfPerfEnabled() {
  if (import.meta.env.DEV) {
    return true
  }
  try {
    return localStorage.getItem(PERF_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function log(level, message, detail = {}) {
  if (!isPdfPerfEnabled()) {
    return
  }
  const payload = { ...detail, ts: performance.now() }
  if (level === 'warn') {
    console.warn(`[pdf-perf] ${message}`, payload)
  } else {
    console.debug(`[pdf-perf] ${message}`, payload)
  }
}

/**
 * @param {{ fromPage: number, toPage: number, trigger?: string }} params
 */
export function beginPageSwitch({ fromPage, toPage, trigger = 'unknown' }) {
  pendingSwitch = {
    fromPage,
    toPage,
    trigger,
    startedAt: performance.now(),
  }
  if (isPdfPerfEnabled()) {
    performance.mark('pdf-page-switch-start')
  }
  log('debug', 'page switch started', { fromPage, toPage, trigger })
}

export function markPageWarm(pageNumber) {
  warmPages.add(pageNumber)
  log('debug', 'page warm', { pageNumber })
}

export function isPageWarm(pageNumber) {
  return warmPages.has(pageNumber)
}

export function clearWarmPages() {
  warmPages.clear()
}

/**
 * @param {{ pageNumber: number, phase: 'pdf-load' | 'raster', durationMs: number, width?: number }} params
 */
export function notePageRender({ pageNumber, phase, durationMs, width }) {
  log('debug', `page ${phase}`, { pageNumber, durationMs: Math.round(durationMs * 10) / 10, width })
  if (phase === 'raster' && durationMs > SLOW_SWITCH_MS) {
    log('warn', `slow ${phase}`, {
      pageNumber,
      durationMs: Math.round(durationMs * 10) / 10,
      bottleneck: 'pdf.js canvas rasterization',
      width,
    })
  }
}

/**
 * @param {{ toPage: number, wasWarm?: boolean, rasterMs?: number | null }} params
 */
export function completePageSwitch({ toPage, wasWarm = false, rasterMs = null }) {
  if (!pendingSwitch || pendingSwitch.toPage !== toPage) {
    return
  }

  const latencyMs = performance.now() - pendingSwitch.startedAt
  const detail = {
    fromPage: pendingSwitch.fromPage,
    toPage,
    trigger: pendingSwitch.trigger,
    latencyMs: Math.round(latencyMs * 10) / 10,
    wasWarm,
    rasterMs: rasterMs == null ? null : Math.round(rasterMs * 10) / 10,
  }

  if (isPdfPerfEnabled()) {
    performance.mark('pdf-page-switch-end')
    try {
      performance.measure('pdf-page-switch', 'pdf-page-switch-start', 'pdf-page-switch-end')
    } catch {
      // marks may be missing if perf disabled mid-flight
    }
  }

  if (latencyMs > SLOW_SWITCH_MS) {
    const reasons = []
    if (!wasWarm) {
      reasons.push('target page canvas was not warm (not pre-rendered in page window)')
    }
    if (rasterMs != null && rasterMs > SLOW_SWITCH_MS) {
      reasons.push(`PDF.js rasterization took ${detail.rasterMs}ms`)
    }
    if (pendingSwitch.trigger === 'score-follow' && latencyMs > 80) {
      reasons.push('score-follow page switch may have waited on debounce or React commit')
    }
    log('warn', 'slow page switch (>50ms)', { ...detail, reasons })
  } else {
    log('debug', 'page switch complete', detail)
  }

  pendingSwitch = null
}
