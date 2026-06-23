const STATUS_LABELS = {
  running: 'Setting up score…',
  warning: 'Check score setup',
}

export default function ScoreFollowSetupStatus({ setupStatus }) {
  const phase = setupStatus?.phase
  if (
    !phase ||
    phase === 'idle' ||
    phase === 'skipped' ||
    phase === 'ready' ||
    phase === 'needs-setup'
  ) {
    return null
  }

  const message =
    (phase === 'warning' || phase === 'failed'
      ? setupStatus.message
      : STATUS_LABELS[phase]) ||
    STATUS_LABELS[phase] ||
    (phase === 'failed' ? 'Setup failed' : '')
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
