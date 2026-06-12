import {
  SCORE_FOLLOW_NEEDS_SETUP,
  SCORE_FOLLOW_SETUP_RUNNING,
} from '../../features/score-follow/scoreFollowUserMessages.js'

const STATUS_LABELS = {
  running: SCORE_FOLLOW_SETUP_RUNNING,
  'needs-setup': SCORE_FOLLOW_NEEDS_SETUP,
}

export default function ScoreFollowSetupStatus({ setupStatus }) {
  const phase = setupStatus?.phase
  if (!phase || phase === 'idle' || phase === 'skipped') {
    return null
  }

  const message = setupStatus.message || STATUS_LABELS[phase] || ''
  if (!message) {
    return null
  }

  return (
    <p
      className={`score-follow-setup-status score-follow-setup-status--${phase}`}
      role="status"
      aria-live="polite"
    >
      {phase === 'running' && <span className="score-follow-setup-status__spinner" aria-hidden />}
      {message}
    </p>
  )
}
