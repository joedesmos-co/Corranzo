/**
 * Neural confirmation tracker (Stage 8, L4/L6/M8) — pure + tested.
 *
 * Owns per-checkpoint confirmation state for the live neural path:
 * - tracks confirmed attack midis so each is emitted to the evaluator once
 *   (no duplicate awards across overlapping windows);
 * - resets on checkpoint identity change (seek / loop / restart / next).
 *
 * Confirmation itself (expected∩heard) stays in micNeuralHybrid; this
 * module only guards emission identity across the stream.
 */

export function createNeuralConfirmTracker() {
  return { checkpointId: null, confirmedMidis: new Set() }
}

export function resetNeuralConfirmTracker(state, checkpointId = null) {
  if (!state) {
    return
  }
  state.checkpointId = checkpointId ?? null
  state.confirmedMidis = new Set()
}

/**
 * @param {object} state tracker
 * @param {string|null} checkpointId current checkpoint identity
 * @param {number[]} confirmedMidis freshly confirmed tones
 * @returns {number[]} tones to emit now (newly confirmed only)
 */
export function takeNewlyConfirmed(state, checkpointId, confirmedMidis = []) {
  if (!state) {
    throw new TypeError('takeNewlyConfirmed requires state')
  }
  if (state.checkpointId !== checkpointId) {
    resetNeuralConfirmTracker(state, checkpointId)
  }
  const fresh = []
  for (const midi of confirmedMidis ?? []) {
    if (!state.confirmedMidis.has(midi)) {
      state.confirmedMidis.add(midi)
      fresh.push(midi)
    }
  }
  return fresh
}
