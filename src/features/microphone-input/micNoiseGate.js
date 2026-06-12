const MIN_FLOOR = 0.004
const MAX_FLOOR = 0.06

/**
 * Slow adaptive noise floor from quiet frames (room hiss).
 */
export function createNoiseFloorTracker(initialFloor = 0.006) {
  return {
    floor: initialFloor,
    alpha: 0.035,
  }
}

export function updateNoiseFloor(tracker, rms, isQuietFrame) {
  if (!tracker || !Number.isFinite(rms)) {
    return tracker?.floor ?? MIN_FLOOR
  }
  if (isQuietFrame) {
    tracker.floor = Math.min(
      MAX_FLOOR,
      Math.max(MIN_FLOOR, tracker.floor * (1 - tracker.alpha) + rms * tracker.alpha),
    )
  }
  return tracker.floor
}

export function passesNoiseGate(rms, noiseFloor) {
  const floor = Math.max(MIN_FLOOR, noiseFloor ?? MIN_FLOOR)
  const openThreshold = Math.max(0.012, floor * 2.8)
  return rms >= openThreshold
}
