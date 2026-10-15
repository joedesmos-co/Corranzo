/**
 * Imperative live mic-frame store — the level/signal-quality readout.
 *
 * The microphone detector produces a frame every animation frame, and the
 * level meter renders it. Routing that through React state re-rendered the
 * whole practice session on every frame (the frame is a dependency of the
 * session's `waitForYouInput` memo, so every publish invalidated the session,
 * the provider value and every practice subscriber).
 *
 * This mirrors the score-follow cursor runtime: the detector publishes here,
 * and only the small mic readout subscribes. React re-renders one component
 * instead of the practice tree.
 */

import { useSyncExternalStore } from 'react'

const EMPTY_FRAME = Object.freeze({
  level: 0,
  midi: null,
  noteLabel: null,
  clarityPercent: 0,
  centsOffset: null,
  signalQuality: null,
  signalLabel: null,
  diagnostic: null,
  micEngineMode: null,
})

let frameSnapshot = EMPTY_FRAME
const listeners = new Set()

export function getMicLiveFrameSnapshot() {
  return frameSnapshot
}

export function subscribeMicLiveFrame(listener) {
  listeners.add(listener)
  listener()
  return () => listeners.delete(listener)
}

/**
 * React binding for the live mic frame. Returns the current frame and
 * re-renders the caller only when the frame actually changes.
 */
export function useMicLiveFrame() {
  return useSyncExternalStore(subscribeMicLiveFrame, getMicLiveFrameSnapshot)
}

/**
 * Publish a live frame. `null` resets to the empty frame. Returns true when
 * the snapshot changed, so callers can skip redundant work.
 */
export function publishMicLiveFrame(next) {
  const frame = next ?? EMPTY_FRAME
  const previous = frameSnapshot
  if (
    previous.level === frame.level &&
    previous.midi === frame.midi &&
    previous.noteLabel === frame.noteLabel &&
    previous.clarityPercent === frame.clarityPercent &&
    previous.centsOffset === frame.centsOffset &&
    previous.signalQuality === frame.signalQuality &&
    previous.signalLabel === frame.signalLabel &&
    previous.diagnostic === frame.diagnostic &&
    previous.micEngineMode === frame.micEngineMode
  ) {
    return false
  }
  frameSnapshot = frame
  for (const listener of listeners) {
    listener()
  }
  return true
}
