/**
 * Imperative cursor position store — updated every animation frame from the
 * audio clock without forcing React re-renders across the practice UI.
 */

const EMPTY_CURSOR = Object.freeze({
  visible: false,
  page: 1,
  x: 0,
  y: 0,
  measureNumber: null,
  smoothed: false,
})

let cursorSnapshot = EMPTY_CURSOR
const listeners = new Set()

export function getScoreFollowCursorSnapshot() {
  return cursorSnapshot
}

export function subscribeScoreFollowCursor(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishScoreFollowCursor(next) {
  const prev = cursorSnapshot
  if (
    prev.visible === next.visible &&
    prev.page === next.page &&
    prev.x === next.x &&
    prev.y === next.y &&
    prev.measureNumber === next.measureNumber &&
    prev.smoothed === next.smoothed
  ) {
    return false
  }
  cursorSnapshot = next
  for (const listener of listeners) {
    listener()
  }
  return true
}

export function resetScoreFollowCursorRuntime(next = EMPTY_CURSOR) {
  cursorSnapshot = next
  for (const listener of listeners) {
    listener()
  }
}
