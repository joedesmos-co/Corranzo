import { useState } from 'react'
import {
  OMR_ACCEPTANCE,
  OMR_QUALITY_WARNING_MESSAGE,
} from '../../features/omr/assessOmrAcceptance.js'

/**
 * Dismissible mid-confidence OMR quality warning.
 * Ownership is score-scoped: dismissal is keyed by ownerScoreId and does not
 * leak across score replacement within the same session.
 */
export default function OmrQualityWarningBanner({
  quality = null,
  ownerScoreId = null,
  dismissedScoreIds = null,
  onDismiss = null,
}) {
  const acceptance = quality?.acceptance ?? null
  const scoreKey = ownerScoreId ?? quality?.ownerScoreId ?? null
  const [localDismissedKey, setLocalDismissedKey] = useState(null)
  const [trackedScoreKey, setTrackedScoreKey] = useState(scoreKey)

  if (scoreKey !== trackedScoreKey) {
    setTrackedScoreKey(scoreKey)
    setLocalDismissedKey(null)
  }

  if (acceptance !== OMR_ACCEPTANCE.WARNING) {
    return null
  }

  const dismissedByParent =
    scoreKey && dismissedScoreIds instanceof Set ? dismissedScoreIds.has(scoreKey) : false
  const dismissedLocally = scoreKey != null && localDismissedKey === scoreKey
  if (dismissedByParent || dismissedLocally) {
    return null
  }

  const message = quality?.warningMessage || OMR_QUALITY_WARNING_MESSAGE

  return (
    <div className="omr-quality-warning" role="status" aria-live="polite">
      <p className="omr-quality-warning__text">{message}</p>
      <button
        type="button"
        className="omr-quality-warning__dismiss"
        onClick={() => {
          if (scoreKey) {
            setLocalDismissedKey(scoreKey)
          }
          onDismiss?.(scoreKey)
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
