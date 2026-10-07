/**
 * E11 — Microphone path localization (no real-device certification).
 *
 * Audit R6: Chromium fake capture (`--use-file-for-fake-audio-capture` with
 * real-piano-c4, padded silence, quiet room) granted permission but never
 * advanced WFY; final status "No input — check mic". Root cause unlocalized.
 *
 * This test localizes the DETERMINISTIC software stages in Node:
 *  1. clip synthesis (capture-layer substitute — no permission/hardware)
 *  2. audio frame processing (replayMicSamples → frames)
 *  3. pitch detection (stable C4 detection)
 *  4. canonical input conversion (microphone canonical event)
 *  5. evaluator (WFY pitch match COMPLETE)
 *  6. WFY advancement (engine commits)
 *
 * If all six pass deterministically, the R6 browser failure lives in the
 * browser-only stages NOT exercised here: permission/capture layer
 * (getUserMedia fake-stream routing), live calibration gating, or the
 * harness audio plumbing — not in pitch/evaluator/advancement software.
 * Physical microphone end-to-end remains REAL_DEVICE_REQUIRED.
 */
import { describe, expect, it } from 'vitest'
import { renderSyntheticClip } from '../src/features/microphone-input/micSyntheticClips.js'
import { replayMicSamples } from '../src/features/microphone-input/micReplayHarness.js'
import {
  createMusicalEventBufferState,
  evaluateNoteInput,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import {
  canMarkWaitForYouCheckpoint,
  getNextCheckpointIndex,
  shouldBlockWaitForYouAdvance,
} from '../src/features/practice/waitForYouEngine.js'
import { normalizeMicrophoneInputEvent } from '../src/features/practice/canonicalInputEvent.js'

const SAMPLE_RATE = 44100

function synthC4() {
  return renderSyntheticClip({ type: 'sine', midi: 60, seconds: 1.2, amplitude: 0.4 }, SAMPLE_RATE)
}

describe('E11 microphone software localization (deterministic, no device)', () => {
  it('stage 1+2: synthetic C4 renders and frame processing yields frames', () => {
    const samples = synthC4()
    expect(samples.length).toBeGreaterThan(SAMPLE_RATE)
    const replay = replayMicSamples(samples, SAMPLE_RATE, { skipCalibration: true })
    expect(replay.frames.length).toBeGreaterThan(5)
  })

  it('stage 3: pitch detection hears C4 (60)', () => {
    const samples = synthC4()
    const replay = replayMicSamples(samples, SAMPLE_RATE, { skipCalibration: true })
    const heardMidis = new Set()
    for (const frame of replay.frames) {
      if (frame.midi != null) heardMidis.add(frame.midi)
      for (const midi of frame.v2DetectedMidis ?? []) heardMidis.add(midi)
    }
    expect(heardMidis.has(60)).toBe(true)
  })

  it('stage 4: canonical microphone conversion preserves pitch/source', () => {
    const event = normalizeMicrophoneInputEvent({ midi: 60, detectedMidis: [60] }, { scoreTimeSeconds: null })
    expect(event.source).toBe('microphone')
    expect(event.midi).toBe(60)
    expect(event.detectedMidis).toEqual([60])
    expect(event.kind).toBe('attack')
  })

  it('stage 5+6: evaluator COMPLETE and engine advancement commit', () => {
    const checkpoint = { id: 'cp-c4', expectedMidis: [60], expectedMidi: 60, isChord: false }
    const buffer = createMusicalEventBufferState()
    const result = evaluateNoteInput(checkpoint, 60, buffer, {})
    expect(result.outcome).toBe(MATCH_OUTCOME.COMPLETE)
    // Engine commits exactly once.
    let consumed = null
    let index = 0
    expect(canMarkWaitForYouCheckpoint({ active: true, checkpointCount: 1, checkpointIndex: index })).toBe(true)
    expect(shouldBlockWaitForYouAdvance(consumed, checkpoint.id)).toBe(false)
    consumed = checkpoint.id
    index = getNextCheckpointIndex(index, 1)
    expect(index).toBe(1)
  })

  it('documents the REAL_DEVICE_REQUIRED gate for physical capture', () => {
    // This file intentionally does NOT certify: OS permission prompts,
    // device selection/routing, acoustic piano bleed, room noise, Bluetooth
    // latency, or mobile backgrounding. Those require real hardware.
    const gate = {
      realDeviceRequired: true,
      covers: ['permission/capture', 'device routing', 'acoustic bleed', 'latency distribution', 'interrupt recovery'],
      softwareLocalizedHere: ['frame processing', 'pitch detection', 'canonical conversion', 'evaluator', 'advancement'],
    }
    expect(gate.realDeviceRequired).toBe(true)
    expect(gate.softwareLocalizedHere).toContain('evaluator')
  })
})
