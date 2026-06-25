import { useProfileStats } from '../../context/ProfileStatsContext.jsx'
import { exerciseTypeLabel } from '../../features/profile/exerciseTypes.js'
import { isAutoSession, isManualSession } from '../../features/profile/manualPracticeLog.js'
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
  const pieces = Object.values(stats.pieces).sort(
    (left, right) =>
      (right.lastPracticedAt ?? 0) - (left.lastPracticedAt ?? 0),
  )
  const manualSessions = stats.recentSessions.filter(isManualSession).slice(0, 5)
  const autoSessions = stats.recentSessions.filter(isAutoSession).slice(0, 5)
  const autoPieceIds = new Set(autoSessions.map((session) => session.pieceId))
  const autoPieces = pieces.filter((piece) => autoPieceIds.has(piece.id)).slice(0, 5)
  const hasAutoStats = autoSessions.length > 0 || autoPieces.length > 0
  const hasAnyHistory = stats.totalSessions > 0

  return (
    <main className="profile-view" aria-labelledby="profile-heading">
      <header className="profile-header">
        <h2 id="profile-heading" className="profile-header__title">
          Practice log
        </h2>
        <p className="profile-header__lede">
          Log practice manually or let score-follow sessions add up automatically.
          Everything stays in this browser.
        </p>
      </header>

      <ManualPracticeLog />

      <div className="profile-stats-grid">
        <StatCard
          label="Total practice time"
          value={formatDuration(stats.totalPracticeSeconds)}
        />
        <StatCard label="Total sessions" value={stats.totalSessions} />
        <StatCard
          label="Manual sessions"
          value={stats.manualSessionsCompleted ?? 0}
        />
      </div>

      {!hasAnyHistory ? (
        <div className="profile-empty">
          <h3>Your practice history starts here</h3>
          <p>
            Use the timer above to log what you practiced, or finish a score-follow
            session and it will appear below.
          </p>
        </div>
      ) : (
        <div className="profile-panels">
          <section
            className="profile-panel"
            aria-labelledby="manual-sessions-heading"
          >
            <h3 id="manual-sessions-heading" className="profile-panel__title">
              Recent manual sessions
            </h3>
            {manualSessions.length === 0 ? (
              <p className="profile-panel__empty">
                No manual sessions saved yet. Start the timer above when you practice.
              </p>
            ) : (
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
            )}
          </section>

          <section
            className="profile-panel"
            aria-labelledby="score-follow-sessions-heading"
          >
            <h3
              id="score-follow-sessions-heading"
              className="profile-panel__title"
            >
              Score-follow sessions
            </h3>
            {!hasAutoStats ? (
              <p className="profile-panel__empty">
                Open a piece in Practice and time there is tracked automatically.
              </p>
            ) : (
              <>
                <h4 className="profile-panel__subtitle">Recent pieces</h4>
                {autoPieces.length === 0 ? (
                  <p className="profile-panel__empty">No pieces recorded yet.</p>
                ) : (
                  <ul className="profile-list profile-list--compact">
                    {autoPieces.map((piece) => (
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

                <h4 className="profile-panel__subtitle">Recent sessions</h4>
                {autoSessions.length === 0 ? (
                  <p className="profile-panel__empty">No score-follow sessions yet.</p>
                ) : (
                  <ul className="profile-list profile-list--compact">
                    {autoSessions.map((session) => (
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
              </>
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
    </main>
  )
}
