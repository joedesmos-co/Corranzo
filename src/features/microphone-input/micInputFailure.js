/**
 * Mic Engine rescue (M2) — three-way input-failure classification.
 *
 * When a musician plays but nothing advances, exactly one of these is true:
 *
 *   NO_USABLE_AUDIO_SIGNAL   — the microphone hears nothing usable
 *                              (gate closed, silence, still calibrating).
 *   PITCH_DETECTION_FAILED   — there IS audible input, but neither the
 *                              monophonic tracker nor the V2 score-informed
 *                              scorer found the expected pitch in it.
 *   PRACTICE_ENGINE_REJECTED — pitch evidence EXISTS, but a downstream gate
 *                              (musical acceptance, noise/soft gate, attack
 *                              latch, match confirm, wrong-note) held it back.
 *
 * These are completely different problems with completely different fixes
 * (move closer / check gain  vs  detector tuning  vs  gate tuning), so they
 * must never be lumped into one "not hearing you" bucket.
 *
 * Pure + testable: plain data in, classification out. No audio APIs, no
 * React, no matching-behavior change — diagnostics only.
 */

export const MIC_INPUT_FAILURE = {
  /** Signal is flowing and unconsumed — not a failure (or already matched). */
  NONE: 'none',
  /** No usable audio reached the detector. Check mic/gain/distance. */
  NO_USABLE_AUDIO_SIGNAL: 'no-usable-audio-signal',
  /** Audible input, but no pitch was extracted from it. Detector issue. */
  PITCH_DETECTION_FAILED: 'pitch-detection-failed',
  /** Pitch evidence exists but a downstream gate rejected it. Gate issue. */
  PRACTICE_ENGINE_REJECTED: 'practice-engine-rejected',
}

/**
 * Mirrors the audibility floor used by signal-quality guidance: below this
 * RMS there is no musically useful energy in the frame.
 */
const AUDIBLE_RMS = 0.02
const QUIET_RMS = 0.006

function frameRms(frame) {
  return frame?.filteredRms ?? frame?.rms ?? 0
}

function frameIsAudible(frame) {
  const rms = frameRms(frame)
  if (rms >= AUDIBLE_RMS) {
    return true
  }
  const shape = frame?.signalShape ?? null
  return shape != null && shape !== 'quiet' && rms > QUIET_RMS
}

function hasPitchEvidence(frame) {
  if (frame?.midi != null) {
    return true
  }
  return Array.isArray(frame?.v2DetectedMidis) && frame.v2DetectedMidis.length > 0
}

/**
 * Classify one analyzed mic frame into the three-way failure taxonomy.
 *
 * @param {object} input
 * @param {object} [input.frame]            analyzed mic frame (may be null)
 * @param {string|null} [input.rejectReason] from micFrameRejectReason() /
 *   micMusicalRejectReason() ('wrong-note', gate/musical reasons, or null
 *   when the frame was accepted for matching)
 * @param {boolean} [input.matchingEnabled]
 * @param {number[]} [input.expectedMidis]
 * @param {boolean} [input.attackLatched]   attack latch currently blocks
 *   matching while the previous note still rings
 * @param {boolean} [input.awaitingConfirm] a candidate is mid-confirm
 *   (confident frames accumulating, threshold not yet met)
 */
export function classifyMicInputFailure({
  frame = null,
  rejectReason = null,
  matchingEnabled = false,
  expectedMidis = [],
  attackLatched = false,
  awaitingConfirm = false,
} = {}) {
  const audible = frameIsAudible(frame)
  const pitchEvidence = hasPitchEvidence(frame)

  // No frame at all (detector not running / missing buffer).
  if (!frame) {
    return {
      category: MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL,
      reason: 'missing-frame',
      audible: false,
      pitchEvidence: false,
      detail: 'No analyzed frame — detector produced nothing to evaluate.',
    }
  }

  // Still measuring the room: no decision has been made yet.
  if (rejectReason === 'calibrating') {
    return {
      category: MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL,
      reason: 'calibrating',
      audible,
      pitchEvidence,
      detail: 'Calibration in progress — stay quiet for a moment.',
    }
  }

  // The engine is not evaluating this checkpoint at all.
  if (!matchingEnabled || rejectReason === 'matching-disabled') {
    return {
      category: MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED,
      reason: 'matching-disabled',
      audible,
      pitchEvidence,
      detail: 'Matching is disabled for this checkpoint — input is ignored by design.',
    }
  }
  if (rejectReason === 'no-expected-midi') {
    return {
      category: MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED,
      reason: 'no-expected-midi',
      audible,
      pitchEvidence,
      detail: 'Checkpoint has no expected pitch — nothing to match against.',
    }
  }

  // Gate closed and nothing heard: the classic "too quiet / too far" case.
  // (The soft-note variant below is handled separately because V2 DID hear it.)
  if (rejectReason === 'noise-gate-closed' && !pitchEvidence) {
    return {
      category: MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL,
      reason: 'noise-gate-closed',
      audible,
      pitchEvidence,
      detail: 'Input below the noise gate — move closer, play louder, or check gain.',
    }
  }

  // Quiet/non-musical frames with no pitch at all: no signal to work with.
  if (
    (rejectReason === 'non-musical-quiet' || rejectReason === 'non-musical-noise') &&
    !pitchEvidence &&
    !audible
  ) {
    return {
      category: MIC_INPUT_FAILURE.NO_USABLE_AUDIO_SIGNAL,
      reason: rejectReason,
      audible,
      pitchEvidence,
      detail: 'No audible pitched signal in this frame.',
    }
  }

  // Audible input, gate open (or audibly shaped), but no pitch came out.
  if (
    rejectReason === 'no-midi-detected' ||
    rejectReason === 'v2-below-threshold' ||
    rejectReason === 'non-musical-no-v2' ||
    (!pitchEvidence && (frame?.gateOpen || audible))
  ) {
    return {
      category: MIC_INPUT_FAILURE.PITCH_DETECTION_FAILED,
      reason: rejectReason ?? 'no-pitch-extracted',
      audible,
      pitchEvidence,
      detail:
        'Audible input but no pitch extracted — detector missed it ' +
        `(expected: ${(expectedMidis ?? []).join(', ') || 'none'}).`,
    }
  }

  // Pitch evidence exists but a downstream gate held it back.
  if (
    rejectReason === 'soft-note-below-gate' ||
    rejectReason === 'non-musical-formant-harmonics' ||
    rejectReason === 'non-musical-speech-like' ||
    rejectReason === 'non-musical-noise' ||
    rejectReason === 'wrong-note' ||
    (pitchEvidence && (attackLatched || awaitingConfirm))
  ) {
    return {
      category: MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED,
      reason:
        rejectReason ??
        (attackLatched ? 'attack-latch-holding' : 'awaiting-confirm'),
      audible,
      pitchEvidence,
      detail:
        'Pitch evidence present but held by a downstream gate — ' +
        'see reason for which one.',
    }
  }

  // Attack latch / confirm backpressure even without a frame reject reason.
  if (attackLatched || awaitingConfirm) {
    return {
      category: MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED,
      reason: attackLatched ? 'attack-latch-holding' : 'awaiting-confirm',
      audible,
      pitchEvidence,
      detail: 'Previous note still owns the matcher — waiting for release or confirm.',
    }
  }

  // Accepted for matching (no reject reason): not a failure.
  if (rejectReason == null) {
    return {
      category: MIC_INPUT_FAILURE.NONE,
      reason: 'accepted-for-matching',
      audible,
      pitchEvidence,
      detail: 'Frame passed all gates and is being evaluated.',
    }
  }

  // Unknown future reason: fail safe toward the engine-rejected bucket so it
  // is investigated as gating, never misreported as silence.
  return {
    category: MIC_INPUT_FAILURE.PRACTICE_ENGINE_REJECTED,
    reason: rejectReason,
    audible,
    pitchEvidence,
    detail: `Unrecognized reject reason '${rejectReason}' — treated as engine rejection.`,
  }
}
