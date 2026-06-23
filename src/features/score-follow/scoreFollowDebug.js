/** Temporary score-follow decision logging (dev builds). */
export function logScoreFollowDecision(payload) {
  const isDev = import.meta.env?.DEV ?? globalThis.process?.env?.NODE_ENV !== 'production'
  if (!isDev) {
    return
  }
  console.info('[score-follow]', payload)
}

const fmt = (value) => (Number.isFinite(value) ? value.toFixed(4) : '—')

/** Nearest value in a sorted/unsorted numeric list to `x`. */
function nearestValue(x, values) {
  if (!Number.isFinite(x) || !values?.length) {
    return null
  }
  let best = null
  let bestDist = Infinity
  for (const value of values) {
    const dist = Math.abs(value - x)
    if (dist < bestDist) {
      bestDist = dist
      best = value
    }
  }
  return best
}

export const ANCHOR_DEBUG_COLUMNS = [
  'page',
  'sys',
  'measure',
  'xSource',
  'measureStartX',
  'playableStartX',
  'playableEndX',
  'x',
  'nearestBarline',
  'error',
]

/**
 * Compact, dev-only table of the generated visual anchors — one row per measure.
 * Surfaces exactly where each marker landed and (when detected barline x's are
 * provided per system) how far the measure start sits from the nearest barline.
 *
 * @param {Array} anchors  per-measure anchors with `meta` (measureStartX, etc.)
 * @param {object} [opts]
 * @param {Record<number, number[]>} [opts.barlinesBySystem]  detected barline x
 *   positions keyed by systemIndex, for the nearest-barline error estimate.
 */
export function buildAnchorDebugTable(anchors = [], { barlinesBySystem = null } = {}) {
  const rows = anchors.map((anchor) => {
    const meta = anchor.meta ?? {}
    const systemIndex = meta.systemIndex ?? null
    const barlines = barlinesBySystem?.[systemIndex] ?? null
    const nearest = nearestValue(meta.measureStartX, barlines)
    const error =
      nearest != null && Number.isFinite(meta.measureStartX)
        ? Math.abs(nearest - meta.measureStartX)
        : null
    return {
      page: anchor.page ?? null,
      systemIndex,
      measure: anchor.measureNumber ?? null,
      xSource: meta.xSource ?? '—',
      measureStartX: meta.measureStartX ?? null,
      playableStartX: meta.playableStartX ?? null,
      playableEndX: meta.playableEndX ?? null,
      x: anchor.x ?? null,
      nearestBarline: nearest,
      error,
    }
  })

  const header =
    'page sys meas xSource            startX   playX    endX     x        nearBL   err'
  const lines = rows.map((r) =>
    [
      String(r.page ?? '—').padStart(4),
      String(r.systemIndex ?? '—').padStart(3),
      String(r.measure ?? '—').padStart(4),
      String(r.xSource).padEnd(18),
      fmt(r.measureStartX).padStart(8),
      fmt(r.playableStartX).padStart(8),
      fmt(r.playableEndX).padStart(8),
      fmt(r.x).padStart(8),
      fmt(r.nearestBarline).padStart(8),
      fmt(r.error).padStart(7),
    ].join(' '),
  )

  return { rows, text: [header, ...lines].join('\n') }
}
