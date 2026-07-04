import { WFY_CHECKPOINT_MODE } from './waitForYouCheckpointMode.js'

export function shouldShowWaitForYouInputSourceModal({
  isWaitForYou,
  checkpointMode,
  sourceSelectedThisSession,
}) {
  return Boolean(
    isWaitForYou &&
      checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
      !sourceSelectedThisSession,
  )
}

export function waitForYouInputSourceIsReady({
  checkpointMode,
  sourceSelectedThisSession,
}) {
  return checkpointMode !== WFY_CHECKPOINT_MODE.NOTE || Boolean(sourceSelectedThisSession)
}
