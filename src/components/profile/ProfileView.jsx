import { useProfileStats } from '../../context/ProfileStatsContext.jsx'
import { exerciseTypeLabel } from '../../features/profile/exerciseTypes.js'
import { isManualSession } from '../../features/profile/manualPracticeLog.js'
import ManualPracticeLog from './ManualPracticeLog.jsx'

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
    return 'Unknown date'
  }

  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function StatCard({ label, value }) {
  return (
    <div className="profile-stat">
      <span className="profile-stat__label">{label}</span>
      <span className="profile-stat__value">{value}</span>
    </div>
  )
}

export default function ProfileView() {
  const { stats, resetAllStats } = useProfileStats()
  const manualSessions = stats.recentSessions.filter(isManualSession).slice(0, 5)
  const hasManualHistory = (stats.manualSessionsCompleted ?? 0) > 0

  return (
    <main className="profile-view" aria-labelledby="profile-heading">
      <header className="profile-header">
        <h2 id="profile-heading" className="profile-header__title">
          Practice log
        </h2>
        <p className="profile-header__lede">
          Start the timer when you practice and save what you worked on. Time is
          only recorded when you log a session — not from playback or browsing pieces.
        </p>
      </header>

      <ManualPracticeLog />

      <div className="profile-stats-grid profile-stats-grid--two">
        <StatCard
          label="Auto-tracked practice"
          value={formatDuration(stats.autoPracticeSeconds ?? 0)}
        />
        <StatCard
          label="Last auto session"
          value={formatDate(stats.lastAutoPracticedAt)}
        />
      </div>

      {Object.values(stats.pieces ?? {}).some((piece) => (piece.autoPracticeSeconds ?? 0) > 0) && (
        <section className="profile-panel" aria-labelledby="auto-piece-stats-heading">
          <h3 id="auto-piece-stats-heading" className="profile-panel__title">
            Per-piece activity
          </h3>
          <ul className="profile-list">
            {Object.values(stats.pieces)
              .filter((piece) => (piece.autoPracticeSeconds ?? 0) > 0)
              .sort((a, b) => (b.lastPracticedAt ?? 0) - (a.lastPracticedAt ?? 0))
              .slice(0, 8)
              .map((piece) => (
                <li key={piece.id} className="profile-list__item">
                  <span>
                    <strong>{piece.title}</strong>
                    <small>
                      {formatDate(piece.lastPracticedAt)}
                      {piece.lastTempoBpm ? ` · ${piece.lastTempoBpm} BPM` : ''}
                      {(piece.wfyMissed ?? 0) > 0 ? ` · ${piece.wfyMissed} missed` : ''}
                    </small>
                  </span>
                  <span>{formatDuration(piece.autoPracticeSeconds)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="profile-stats-grid profile-stats-grid--two">
        <StatCard
          label="Logged practice time"
          value={formatDuration(stats.totalPracticeSeconds)}
        />
        <StatCard
          label="Logged sessions"
          value={stats.manualSessionsCompleted ?? 0}
        />
      </div>

      {!hasManualHistory ? (
        <div className="profile-empty">
          <h3>Your practice log starts here</h3>
          <p>
            Press Start timer above when you begin practicing, then save the session
            with what you worked on.
          </p>
        </div>
      ) : (
        <section
          className="profile-panel"
          aria-labelledby="manual-sessions-heading"
        >
          <h3 id="manual-sessions-heading" className="profile-panel__title">
            Recent logged sessions
          </h3>
          <ul className="profile-list">
            {manualSessions.map((session) => (
              <li key={session.id} className="profile-list__item">
                <span>
                  <strong>{session.pieceTitle}</strong>
                  <small>
                    {exerciseTypeLabel(session.exerciseType)} ·{' '}
                    {formatDate(session.endedAt)}
                  </small>
                  {session.notes ? (
                    <small className="profile-list__notes">{session.notes}</small>
                  ) : null}
                </span>
                <span>{formatDuration(session.durationSeconds)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="profile-footer">
        <p>Clearing browser data also removes these stats.</p>
        <button
          type="button"
          className="profile-footer__reset"
          onClick={() => {
            if (window.confirm('Clear all local practice stats? This cannot be undone.')) {
              resetAllStats()
            }
          }}
        >
          Clear stats
        </button>
      </footer>
    </main>
  )
}
