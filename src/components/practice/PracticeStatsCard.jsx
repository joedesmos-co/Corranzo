import { useProfileStats } from '../../context/ProfileStatsContext.jsx'

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    return `${totalMinutes} min`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function formatDate(timestamp) {
  if (!timestamp) {
    return '—'
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function StatRow({ label, value }) {
  return (
    <div className="practice-stats-card__row">
      <span className="practice-stats-card__label">{label}</span>
      <span className="practice-stats-card__value">{value}</span>
    </div>
  )
}

/**
 * Compact local practice stats — live session plus persisted per-piece totals.
 */
export default function PracticeStatsCard({
  pieceId = null,
  liveSession = null,
  compact = false,
}) {
  const { stats } = useProfileStats()
  const pieceStats = pieceId ? stats.pieces?.[pieceId] : null

  const practiceSeconds =
    (liveSession?.practiceSeconds ?? 0) + (pieceStats?.autoPracticeSeconds ?? 0)
  const measuresPlayed =
    (liveSession?.measuresPlayed ?? 0) + (pieceStats?.measuresPlayed ?? 0)
  const loopsCompleted =
    (liveSession?.loopsCompleted ?? 0) + (pieceStats?.loopsCompleted ?? 0)
  const wfyMissed =
    (liveSession?.wfyMissed ?? 0) + (pieceStats?.wfyMissed ?? 0)
  const tempoBpm = liveSession?.tempoBpm ?? pieceStats?.lastTempoBpm ?? null
  const lastPracticedAt = pieceStats?.lastPracticedAt ?? stats.lastAutoPracticedAt

  if (!pieceId && !liveSession) {
    return null
  }

  return (
    <section
      className={`practice-stats-card${compact ? ' practice-stats-card--compact' : ''}`}
      aria-label="Practice stats"
    >
      <div className="practice-stats-card__header">
        <h3 className="practice-stats-card__title">Session stats</h3>
        <span className="practice-stats-card__hint">Saved locally</span>
      </div>
      <div className="practice-stats-card__grid">
        <StatRow label="Time practiced" value={formatDuration(practiceSeconds)} />
        <StatRow label="Measures visited" value={measuresPlayed} />
        <StatRow label="Loops completed" value={loopsCompleted} />
        <StatRow label="Tempo" value={tempoBpm ? `${tempoBpm} BPM` : '—'} />
        {wfyMissed > 0 && <StatRow label="Missed notes" value={wfyMissed} />}
        <StatRow label="Last practiced" value={formatDate(lastPracticedAt)} />
      </div>
    </section>
  )
}
