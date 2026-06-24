import { FIXTURE_FILENAMES, FIXTURE_PATHS, DEMO_PIECE } from '../../dev/fixturePaths.js'
import { ANCHOR_SOURCE } from '../score-follow/anchorUtils.js'
import { createAnchorId } from '../score-follow/scoreFollowStorage.js'
import {
  assessBundledMeasureCursorX,
  validateBundledAnchorPayload,
} from '../score-follow/demoAnchorCalibration.js'

export const DEMO_BUNDLED_ANCHORS_PATH = FIXTURE_PATHS.demoAnchors

let cachedBundled = null
let cachedBundledPromise = null

// Dev/test switch: when disabled, the demo piece must go through the SAME
// automatic setup pipeline as user uploads (no bundled-anchor shortcut). This
// is the honesty check — if the demo can't auto-configure without its bundle,
// the auto pipeline isn't really working.
let bundledAnchorsDisabled = false

export function setBundledDemoAnchorsDisabled(disabled) {
  bundledAnchorsDisabled = Boolean(disabled)
}

export function areBundledDemoAnchorsDisabled() {
  if (bundledAnchorsDisabled) {
    return true
  }
  if (typeof globalThis !== 'undefined' && globalThis.__SCOREFLOW_DISABLE_BUNDLED_ANCHORS__) {
    return true
  }
  try {
    return import.meta.env?.VITE_DISABLE_BUNDLED_ANCHORS === 'true'
  } catch {
    return false
  }
}

export function isDemoFixtureFileSet(pdfFileName, timingFileName) {
  return (
    pdfFileName === FIXTURE_FILENAMES.pdf &&
    timingFileName === FIXTURE_FILENAMES.musicXml
  )
}

function normalizeBundledAnchor(raw) {
  const measureNumber = Number(raw.measureNumber)
  const page = Number(raw.page)
  const rawX = Number(raw.x)
  const y = Number(raw.y)
  const playableStartX = Number(raw.meta?.playableStartX)
  const resolvedX =
    raw.meta?.role === 'measure' && Number.isFinite(playableStartX) ? playableStartX : rawX
  if (
    !Number.isFinite(measureNumber) ||
    !Number.isFinite(page) ||
    !Number.isFinite(resolvedX) ||
    !Number.isFinite(y)
  ) {
    return null
  }
  return {
    id: raw.id ?? createAnchorId(),
    page,
    x: Math.min(1, Math.max(0, resolvedX)),
    y: Math.min(1, Math.max(0, y)),
    measureNumber,
    source: ANCHOR_SOURCE.DEMO,
    meta: raw.meta ?? { bundled: true },
  }
}

export function validateDemoBundledPayload(payload) {
  const structural = validateBundledAnchorPayload(payload, { pieceId: DEMO_PIECE.id })
  if (!structural.ok) {
    return structural
  }
  const normalized = structural.anchors.map((anchor) => {
    const fromRaw = payload.anchors.find((item) => item.measureNumber === anchor.measureNumber)
    return normalizeBundledAnchor({ ...fromRaw, source: ANCHOR_SOURCE.DEMO }) ?? anchor
  })
  if (normalized.length < 2) {
    return { ok: false, reason: 'too-few-anchors' }
  }

  const measureOne = normalized.find((anchor) => anchor.measureNumber === 1)
  const measureOneCursor = assessBundledMeasureCursorX(measureOne)
  if (!measureOneCursor.ok) {
    return measureOneCursor
  }

  if (import.meta.env?.DEV ?? globalThis.process?.env?.NODE_ENV !== 'production') {
    console.info('[score-follow] demo bundle validated', {
      count: normalized.length,
      measure1: {
        page: measureOne.page,
        x: measureOne.x,
        y: measureOne.y,
        systemIndex: measureOne.meta?.systemIndex,
        playableStartX: measureOne.meta?.playableStartX,
      },
    })
  }

  return {
    ok: true,
    anchors: normalized.sort((a, b) => a.measureNumber - b.measureNumber),
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
