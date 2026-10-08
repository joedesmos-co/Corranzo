/**
 * Mic Engine rescue (M9) — microphone frame → canonical input event bridge.
 *
 * STAGE 1 shadow bridge: converts one analyzed mic frame into the SAME
 * canonical input-event contract MIDI input uses
 * (`normalizeMicrophoneInputEvent` in canonicalInputEvent.js) WITHOUT
 * changing any matching decision. The live matcher keeps its current
 * behavior; this bridge exists so (a) multi-pitch evidence is preserved in
 * one place with the exact contract fields, and (b) latency/accuracy
 * harnesses can measure mic and MIDI through the identical shape.
 *
 * Preserved on every event:
 * - detectedMidis (full simultaneous set — never reduced to one pitch here)
 * - per-frame confidence (V2 mean confidence preferred, clarity fallback)
 * - onset timing (frame timeMs + wall clock capture time)
 * - source ('microphone'), timestamp, chord group, attempt identity
 *
 * Pure + testable. No audio APIs, no React.
 */
import { normalizeMicrophoneInputEvent } from './canonicalInputEvent.js'

function uniqueMidis(values = []) {
  const seen = new Set()
  const result = []
  for (const value of values ?? []) {
    const midi = Number(value)
    if (!Number.isFinite(midi)) {
      continue
    }
    const rounded = Math.round(midi)
    if (!seen.has(rounded)) {
      seen.add(rounded)
      result.push(rounded)
    }
  }
  return result.sort((left, right) => left - right)
}

/**
 * Build the canonical microphone input event for one analyzed frame.
 *
 * @param {object} [frame] analyzed mic frame (v2DetectedMidis / midi /
 *   v2MeanConfidence / clarity / timeMs)
 * @param {object} [context]
 * @param {number|null} [context.scoreTimeSeconds] authoritative score time at
 *   attack (Play Along) or null (Wait For You — untimed by design)
 * @param {number|null} [context.wallTimestampMs] capture wall time
 * @param {number|null} [context.rawTimestamp] source timestamp when available
 * @param {string|null} [context.chordGroupId] simultaneous-attack group; when
 *   omitted and several midis were detected together, a deterministic group
 *   id is derived from the wall timestamp
 * @param {string|null} [context.attemptId] practice attempt at capture
 * @param {number} [context.iterationIndex]
 * @returns canonical input event, or null when the frame carries no pitch
 */
export function toCanonicalMicrophoneEvent(frame = null, context = {}) {
  const v2Midis = Array.isArray(frame?.v2DetectedMidis) ? frame.v2DetectedMidis : []
  const primary =
    frame?.midi ?? (v2Midis.length ? v2Midis[0] : null) ?? null
  const detectedMidis = uniqueMidis(
    v2Midis.length ? v2Midis : primary != null ? [primary] : [],
  )
  if (primary == null && detectedMidis.length === 0) {
    return null
  }

  const confidence =
    frame?.v2MeanConfidence ?? frame?.clarity ?? null
  const wallTimestampMs = Number.isFinite(Number(context.wallTimestampMs))
    ? Number(context.wallTimestampMs)
    : Date.now()
  const chordGroupId =
    context.chordGroupId ??
    (detectedMidis.length > 1 ? `mic-chord-${Math.round(wallTimestampMs)}` : null)

  return normalizeMicrophoneInputEvent(
    {
      midi: primary != null ? Number(primary) : null,
      detectedMidis: detectedMidis.length ? detectedMidis : null,
    },
    {
      scoreTimeSeconds: context.scoreTimeSeconds ?? null,
      wallTimestampMs,
      rawTimestamp:
        frame?.timeMs ?? context.rawTimestamp ?? null,
      confidence,
      kind: 'attack',
      chordGroupId,
      attemptId: context.attemptId ?? null,
      iterationIndex: context.iterationIndex ?? 0,
    },
  )
}
