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
  const pieces = Object.values(stats.pieces).sort(
    (left, right) =>
      (right.lastPracticedAt ?? 0) - (left.lastPracticedAt ?? 0),
  )
  const recentPieces = pieces.slice(0, 5)
  const hasStats = stats.totalSessions > 0 || stats.recentSessions.length > 0

  return (
    <section className="profile-view" aria-labelledby="profile-heading">
      <header className="profile-header">
        <h2 id="profile-heading" className="profile-header__title">
          Practice stats
        </h2>
        <p className="profile-header__lede">
          A simple history stored only in this browser.
        </p>
      </header>

      <div className="profile-stats-grid">
        <StatCard
          label="Total practice time"
          value={formatDuration(stats.totalPracticeSeconds)}
        />
        <StatCard label="Total sessions" value={stats.totalSessions} />
        <StatCard label="Pieces practiced" value={pieces.length} />
      </div>

      {!hasStats ? (
        <div className="profile-empty">
          <h3>No practice stats yet</h3>
          <p>Open a score in Practice to start building your local history.</p>
        </div>
      ) : (
        <div className="profile-panels">
          <section className="profile-panel" aria-labelledby="recent-pieces-heading">
            <h3 id="recent-pieces-heading" className="profile-panel__title">
              Recent pieces
            </h3>
            {recentPieces.length === 0 ? (
              <p className="profile-panel__empty">No pieces recorded yet.</p>
            ) : (
              <ul className="profile-list">
                {recentPieces.map((piece) => (
                  <li key={piece.id} className="profile-list__item">
                    <span>
                      <strong>{piece.title}</strong>
                      <small>{formatDate(piece.lastPracticedAt)}</small>
                    </span>
                    <span>{formatDuration(piece.totalPracticeSeconds)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="profile-panel" aria-labelledby="recent-sessions-heading">
            <h3 id="recent-sessions-heading" className="profile-panel__title">
              Recent sessions
            </h3>
            {stats.recentSessions.length === 0 ? (
              <p className="profile-panel__empty">No sessions recorded yet.</p>
            ) : (
              <ul className="profile-list">
                {stats.recentSessions.map((session) => (
                  <li key={session.id} className="profile-list__item">
                    <span>
                      <strong>{session.pieceTitle}</strong>
                      <small>{formatDate(session.endedAt)}</small>
                    </span>
                    <span>{formatDuration(session.durationSeconds)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
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
    </section>
  )
}
