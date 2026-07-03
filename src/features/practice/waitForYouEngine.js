export const WFY_STATUS = {
  INACTIVE: 'inactive',
  WAITING: 'waiting',
  COMPLETE: 'complete',
  NO_CHECKPOINTS: 'no-checkpoints',
}

export function getWaitForYouStatus({ active, checkpointCount, checkpointIndex }) {
  if (!active) {
    return WFY_STATUS.INACTIVE
  }
  if (checkpointCount === 0) {
    return WFY_STATUS.NO_CHECKPOINTS
  }
  if (checkpointIndex >= checkpointCount) {
    return WFY_STATUS.COMPLETE
  }
  return WFY_STATUS.WAITING
}

export function getCurrentCheckpoint(checkpoints, index) {
  if (!checkpoints.length || index < 0 || index >= checkpoints.length) {
    return null
  }
  return checkpoints[index]
}

export function getNextCheckpointIndex(currentIndex, checkpointCount) {
  const next = currentIndex + 1
  if (next >= checkpointCount) {
    return checkpointCount
  }
  return next
}

/** Whether advancing to the next checkpoint is allowed (not inactive / empty / complete). */
export function canMarkWaitForYouCheckpoint({ active, checkpointCount, checkpointIndex }) {
  if (!active) {
    return false
  }
  if (checkpointCount === 0) {
    return false
  }
  if (checkpointIndex >= checkpointCount) {
    return false
  }
  return true
}

/** Block duplicate advance signals for the same checkpoint (held MIDI/mic, double Enter). */
export function shouldBlockWaitForYouAdvance(consumedCheckpointId, checkpointId) {
  if (!checkpointId) {
    return true
  }
  return consumedCheckpointId === checkpointId
}
