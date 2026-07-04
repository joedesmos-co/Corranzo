/**
 * Wait For You mic attack/release gating.
 *
 * After one checkpoint advance, the player must release (gate closes) before the
 * next attack can match — a sustained or ringing note must not consume future
 * checkpoints.
 */

export const MIC_ATTACK_RELEASE_FRAMES = 4

export function createMicAttackLatchState() {
  return {
    awaitingRelease: false,
    gateClosedFrames: 0,
  }
}

export function resetMicAttackLatch(state) {
  if (!state) {
    return
  }
  state.awaitingRelease = false
  state.gateClosedFrames = 0
}

export function updateMicAttackRelease(state, gateOpen, { releaseFrames = MIC_ATTACK_RELEASE_FRAMES } = {}) {
  if (!state) {
    return
  }
  if (gateOpen) {
    state.gateClosedFrames = 0
    return
  }
  state.gateClosedFrames += 1
  if (state.awaitingRelease && state.gateClosedFrames >= releaseFrames) {
    state.awaitingRelease = false
    state.gateClosedFrames = 0
  }
}

export function canAcceptMicAttackMatch(state) {
  return Boolean(state && !state.awaitingRelease)
}

export function markMicAttackConsumed(state) {
  if (!state) {
    return
  }
  state.awaitingRelease = true
  state.gateClosedFrames = 0
}
