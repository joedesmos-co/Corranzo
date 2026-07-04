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

/** Default gate shape — reproduces the long-standing behavior. */
export const DEFAULT_GATE_OPTIONS = { absoluteMin: 0.012, floorMultiplier: 2.8 }

/**
 * The level the (filtered) RMS must exceed to open the gate. Scales with the
 * measured noise floor but never drops below an absolute audible minimum.
 * Instrument profiles can nudge both knobs (e.g. plucky guitar a touch lower).
 */
export function gateOpenThreshold(noiseFloor, options = null) {
  const { absoluteMin = DEFAULT_GATE_OPTIONS.absoluteMin, floorMultiplier = DEFAULT_GATE_OPTIONS.floorMultiplier } =
    options ?? {}
  const floor = Math.max(MIN_FLOOR, noiseFloor ?? MIN_FLOOR)
  return Math.max(absoluteMin, floor * floorMultiplier)
}

export function passesNoiseGate(rms, noiseFloor, options = null) {
  return rms >= gateOpenThreshold(noiseFloor, options)
}
