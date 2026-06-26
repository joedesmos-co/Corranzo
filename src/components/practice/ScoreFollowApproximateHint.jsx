import { useEffect, useState } from 'react'

/** How long the approximate-cursor hint stays fully visible before fading out. */
export const APPROXIMATE_HINT_VISIBLE_MS = 6000

/**
 * The "Approximate — measure barlines" (and sibling) cursor-quality hints are
 * informational, not warnings: useful the moment setup settles, then just noise.
 * This shows the current label briefly and fades it out after a few seconds.
 * A change in the label (i.e. the alignment status actually changed) re-shows it,
 * so the user always sees the latest state before it quietly dismisses.
 */
export default function ScoreFollowApproximateHint({ label, visibleMs = APPROXIMATE_HINT_VISIBLE_MS }) {
  const [shownLabel, setShownLabel] = useState(label)
  const [dismissed, setDismissed] = useState(false)

  // Re-show whenever the label (i.e. the alignment status) changes. Adjusting
  // state during render is the React-recommended pattern and avoids a synchronous
  // setState inside the effect below.
  if (label !== shownLabel) {
    setShownLabel(label)
    setDismissed(false)
  }

  useEffect(() => {
    if (!label) {
      return undefined
    }
    // Only the async dismissal sets state here, so no cascading render on mount.
    const timer = setTimeout(() => setDismissed(true), visibleMs)
    return () => clearTimeout(timer)
  }, [label, visibleMs])

  if (!label) {
    return null
  }

  return (
    <p
      className={`score-follow-setup-status score-follow-setup-status--hint score-follow-approximate-hint${
        dismissed ? ' score-follow-approximate-hint--dismissed' : ''
      }`}
      role="status"
      aria-live="polite"
    >
      {label}
    </p>
  )
}
