import { replayMicClip } from './micReplayHarness.js'

/**
 * Offline polyphony replay — runs labeled chord WAVs through the **V1 monophonic**
 * mic pipeline to establish a measurement baseline before Mic Engine V2 ships.
 *
 * Does not modify runtime behavior.
 */
export function replayPolyphonyClip(samples, sampleRate, options = {}) {
  return replayMicClip(samples, sampleRate, options)
}
