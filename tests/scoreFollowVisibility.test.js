/**
 * Score-follow cursor visibility after upload/setup and checkbox state.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import {
  getCursorVisibilityState,
  CURSOR_HIDE_REASON,
} from '../src/features/score-follow/scoreFollowVisibility.js'
import {
  getScoreFollowCursorSnapshot,
  publishScoreFollowCursor,
  resetScoreFollowCursorRuntime,
  subscribeScoreFollowCursor,
} from '../src/features/score-follow/scoreFollowCursorRuntime.js'
import * as F from './helpers/buildXml.js'

function anchorsForMeasures(count, { playableSpan = 0.12 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const measureNumber = index + 1
    const x = 0.1 + index * 0.18
    return {
      id: `m${measureNumber}`,
      page: 1,
      x,
      y: 0.3,
      measureNumber,
      source: 'manual',
      meta: {
        playableStartX: x,
        playableEndX: x + playableSpan,
        systemEndX: 0.95,
      },
    }
  })
}

describe('getCursorVisibilityState', () => {
  const trust = { showCursor: true, needsSetup: false }
  const cursor = { visible: true, page: 1, x: 0.2, y: 0.3, measureNumber: 1 }

  it('shows cursor when setup is ready, overlay enabled, and cursor is computed', () => {
    const state = getCursorVisibilityState({
      hasPdf: true,
      hasTiming: true,
      hasAnchors: true,
      enabled: true,
      alignmentMode: false,
      cursor,
      visiblePageNumber: 1,
      anchorTrust: trust,
      needsSetup: false,
    })
    expect(state.show).toBe(true)
    expect(state.reason).toBe(CURSOR_HIDE_REASON.VISIBLE)
  })

  it('hides cursor while setup is still needed even if the checkbox is checked', () => {
    const state = getCursorVisibilityState({
      hasPdf: true,
      hasTiming: true,
      hasAnchors: true,
      enabled: true,
      alignmentMode: false,
      cursor,
      visiblePageNumber: 1,
      anchorTrust: { showCursor: true, needsSetup: true },
      needsSetup: true,
    })
    expect(state.show).toBe(false)
    expect(state.reason).toBe(CURSOR_HIDE_REASON.NEEDS_SETUP)
  })

  it('hides cursor when the moving-cursor checkbox is off', () => {
    const state = getCursorVisibilityState({
      hasPdf: true,
      hasTiming: true,
      hasAnchors: true,
      enabled: false,
      alignmentMode: false,
      cursor,
      visiblePageNumber: 1,
      anchorTrust: trust,
      needsSetup: false,
    })
    expect(state.show).toBe(false)
    expect(state.reason).toBe(CURSOR_HIDE_REASON.OVERLAY_DISABLED)
  })

  it('shows cursor again when checkbox is re-enabled after setup is ready', () => {
    const hidden = getCursorVisibilityState({
      hasPdf: true,
      hasTiming: true,
      hasAnchors: true,
      enabled: false,
      alignmentMode: false,
      cursor,
      visiblePageNumber: 1,
      anchorTrust: trust,
      needsSetup: false,
    })
    const shown = getCursorVisibilityState({
      hasPdf: true,
      hasTiming: true,
      hasAnchors: true,
      enabled: true,
      alignmentMode: false,
      cursor,
      visiblePageNumber: 1,
      anchorTrust: trust,
      needsSetup: false,
    })
    expect(hidden.show).toBe(false)
    expect(shown.show).toBe(true)
  })
})

describe('cursor visibility after upload setup', () => {
  afterEach(() => {
    resetScoreFollowCursorRuntime()
  })

  const timingMap = parseMusicXml(F.straight4())
  const anchors = anchorsForMeasures(4)
  const trust = { showCursor: true, needsSetup: false }

  it('publishes a visible cursor snapshot when setup becomes ready', () => {
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0.5,
      trustedAnchors: anchors,
      trust,
    })
    expect(cursor.visible).toBe(true)

    publishScoreFollowCursor({ ...cursor, smoothed: false })

    const visibility = getCursorVisibilityState({
      hasPdf: true,
      hasTiming: true,
      hasAnchors: true,
      enabled: true,
      alignmentMode: false,
      cursor: getScoreFollowCursorSnapshot(),
      visiblePageNumber: cursor.page,
      anchorTrust: trust,
      needsSetup: false,
    })
    expect(visibility.show).toBe(true)
    expect(getScoreFollowCursorSnapshot().x).toBe(cursor.x)
  })

  it('late overlay subscription receives the current cursor without a checkbox toggle', () => {
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0.5,
      trustedAnchors: anchors,
      trust,
    })
    publishScoreFollowCursor({ ...cursor, smoothed: false })

    const listener = vi.fn()
    subscribeScoreFollowCursor(listener)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getScoreFollowCursorSnapshot().visible).toBe(true)
  })

  it('demo-style restored session still resolves a visible cursor on page 1', () => {
    const { cursor } = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0,
      trustedAnchors: anchors,
      trust,
    })
    expect(cursor.visible).toBe(true)
    expect(cursor.page).toBe(1)

    publishScoreFollowCursor({ ...cursor, smoothed: false })
    const visibility = getCursorVisibilityState({
      hasPdf: true,
      hasTiming: true,
      hasAnchors: true,
      enabled: true,
      alignmentMode: false,
      cursor: getScoreFollowCursorSnapshot(),
      visiblePageNumber: 1,
      anchorTrust: trust,
      needsSetup: false,
    })
    expect(visibility.show).toBe(true)
  })
})
