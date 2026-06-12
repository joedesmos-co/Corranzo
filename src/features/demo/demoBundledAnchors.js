import { FIXTURE_FILENAMES, FIXTURE_PATHS, DEMO_PIECE } from '../../dev/fixturePaths.js'
import { ANCHOR_SOURCE } from '../score-follow/anchorUtils.js'
import { createAnchorId } from '../score-follow/scoreFollowStorage.js'

export const DEMO_BUNDLED_ANCHORS_PATH = FIXTURE_PATHS.demoAnchors

let cachedBundled = null
let cachedBundledPromise = null

export function isDemoFixtureFileSet(pdfFileName, timingFileName) {
  return (
    pdfFileName === FIXTURE_FILENAMES.pdf &&
    timingFileName === FIXTURE_FILENAMES.musicXml
  )
}

function normalizeBundledAnchor(raw) {
  const measureNumber = Number(raw.measureNumber)
  const page = Number(raw.page)
  const x = Number(raw.x)
  const y = Number(raw.y)
  if (
    !Number.isFinite(measureNumber) ||
    !Number.isFinite(page) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null
  }
  return {
    id: raw.id ?? createAnchorId(),
    page,
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    measureNumber,
    source: ANCHOR_SOURCE.DEMO,
    meta: raw.meta ?? { bundled: true },
  }
}

export function validateDemoBundledPayload(payload) {
  if (!payload || payload.pieceId !== DEMO_PIECE.id) {
    return { ok: false, reason: 'piece-mismatch' }
  }
  const anchors = Array.isArray(payload.anchors) ? payload.anchors : []
  const normalized = anchors.map(normalizeBundledAnchor).filter(Boolean)
  if (normalized.length < 2) {
    return { ok: false, reason: 'too-few-anchors' }
  }

  const sorted = normalized.sort((a, b) => a.measureNumber - b.measureNumber)
  const measureNumbers = sorted.map((anchor) => anchor.measureNumber)
  const uniqueMeasures = new Set(measureNumbers)
  if (uniqueMeasures.size !== measureNumbers.length) {
    return { ok: false, reason: 'duplicate-measure-anchors' }
  }

  const measureOne = sorted.find((anchor) => anchor.measureNumber === 1)
  if (!measureOne) {
    return { ok: false, reason: 'missing-measure-1' }
  }
  if (measureOne.page !== 1 || measureOne.y > 0.38) {
    return { ok: false, reason: 'measure-1-not-on-system-1' }
  }

  if (import.meta.env?.DEV ?? process.env.NODE_ENV !== 'production') {
    console.info('[score-follow] demo bundle validated', {
      count: sorted.length,
      measure1: {
        page: measureOne.page,
        x: measureOne.x,
        y: measureOne.y,
        systemIndex: measureOne.meta?.systemIndex,
      },
    })
  }

  return {
    ok: true,
    anchors: sorted,
    alignmentNote: payload.alignmentNote ?? null,
  }
}

/**
 * Fetch pre-bundled score-follow anchors for the demo piece (public fixture, not user storage).
 */
export async function fetchDemoBundledAnchors() {
  if (cachedBundled) {
    return cachedBundled
  }
  if (!cachedBundledPromise) {
    cachedBundledPromise = (async () => {
      const response = await fetch(DEMO_BUNDLED_ANCHORS_PATH)
      if (!response.ok) {
        throw new Error(`Demo anchors not found (${response.status})`)
      }
      const payload = await response.json()
      const result = validateDemoBundledPayload(payload)
      if (!result.ok) {
        throw new Error(`Invalid demo anchors bundle (${result.reason})`)
      }
      cachedBundled = result
      return result
    })()
  }
  return cachedBundledPromise
}

export function clearDemoBundledAnchorsCache() {
  cachedBundled = null
  cachedBundledPromise = null
}
