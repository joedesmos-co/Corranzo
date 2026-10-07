import { useMemo, useState } from 'react'
import { useProfileStats } from '../../context/ProfileStatsContext.jsx'
import { exerciseTypeLabel } from '../../features/profile/exerciseTypes.js'
import { getInstrument } from '../../features/instruments/instruments.js'
import { isManualSession } from '../../features/profile/manualPracticeLog.js'
import {
  STATS_SCOPE_ALL,
  filterStatsByInstrument,
  listStatsScopes,
} from '../../features/profile/statsInstrumentFilter.js'
import ManualPracticeLog from './ManualPracticeLog.jsx'

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  if (totalSeconds <= 0) {
    return '—'
  }
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
  // Placeholder values ("None yet", "—") are quiet by design: an empty
  // journal should invite the single Start timer action, not headline absence.
  const isPlaceholder = value === 'None yet' || value === '—'
  return (
    <div className="profile-stat">
      <span className="profile-stat__label">{label}</span>
      <span
        className={`profile-stat__value${isPlaceholder ? ' profile-stat__value--placeholder' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

/** Three views over one stats store: both instruments combined, piano, guitar. */
function StatsScopeSelector({ scope, onScopeChange }) {
  return (
    <div className="profile-scope" role="radiogroup" aria-label="Stats instrument filter">
      {listStatsScopes().map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={scope === option.id}
          className={`profile-scope__option${
            scope === option.id ? ' profile-scope__option--active' : ''
          }`}
          onClick={() => onScopeChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default function ProfileView({ currentPieceId = null }) {
  const { stats, resetAllStats, statsCorrupted, statsRecovered } = useProfileStats()
  const [statsScope, setStatsScope] = useState(STATS_SCOPE_ALL)

  // One stats implementation, three projections (all / piano / guitar).
  const viewStats = useMemo(
    () => filterStatsByInstrument(stats, statsScope),
    [stats, statsScope],
  )
  const scopedToInstrument = statsScope !== STATS_SCOPE_ALL

  const manualSessions = viewStats.recentSessions.filter(isManualSession).slice(0, 5)
  const hasManualHistory = (viewStats.manualSessionsCompleted ?? 0) > 0
  const scopeLabel = viewStats.statsScopeLabel ?? 'this instrument'
  const piecesWithActivity = Object.values(viewStats.pieces ?? {}).filter(
    (piece) => (piece.autoPracticeSeconds ?? 0) > 0,
  )
  const hasPieceActivity = piecesWithActivity.length > 0

  return (
    <main className="profile-view" aria-labelledby="profile-heading">
      <header className="profile-header">
        <span className="cz-edition-label">Time with your instrument</span>
        <h1 id="profile-heading" className="profile-header__title">
          Practice journal
        </h1>
        <p className="profile-header__lede">
          Keep a record of what you worked on. Time with an open score is saved automatically.
        </p>
      </header>

      {statsCorrupted || statsRecovered ? (
        <p className="profile-empty" role="status">
          {statsRecovered
            ? 'Your practice history needed recovery, but your last good save is shown. Nothing was deleted.'
            : 'Your saved practice data looks damaged. Your history is paused to protect it — export what you can, then clear stats to start fresh.'}
        </p>
      ) : null}

      <ManualPracticeLog defaultPieceId={currentPieceId} />

      <StatsScopeSelector scope={statsScope} onScopeChange={setStatsScope} />

      <div className="profile-stats-grid profile-stats-grid--two">
        <StatCard
          label="Time with your scores"
          value={
            (viewStats.autoPracticeSeconds ?? 0) > 0
              ? formatDuration(viewStats.autoPracticeSeconds ?? 0)
              : 'None yet'
          }
        />
        <StatCard
          label="Last played"
          value={
            viewStats.lastAutoPracticedAt ? formatDate(viewStats.lastAutoPracticedAt) : 'None yet'
          }
        />
      </div>

      {hasPieceActivity ? (
        <section className="profile-panel" aria-labelledby="auto-piece-stats-heading">
          <h2 id="auto-piece-stats-heading" className="profile-panel__title">
            Pieces in practice
          </h2>
          <ul className="profile-list">
            {piecesWithActivity
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
      ) : (
        <section className="profile-panel" aria-labelledby="auto-piece-stats-heading">
          <h2 id="auto-piece-stats-heading" className="profile-panel__title">
            Pieces in practice
          </h2>
          <div className="profile-empty">
            <p>
              {scopedToInstrument
                ? `No ${scopeLabel.toLowerCase()} pieces practiced yet. Open a piece with ${scopeLabel} selected and practice to see it here.`
                : 'Practice a piece to see it tracked here automatically — no timer needed.'}
            </p>
          </div>
        </section>
      )}

      <div className="profile-stats-grid profile-stats-grid--two">
        <StatCard
          label="Practice you’ve logged"
          value={formatDuration(viewStats.totalPracticeSeconds)}
        />
        <StatCard
          label="Sessions you’ve logged"
          value={(viewStats.manualSessionsCompleted ?? 0) > 0 ? viewStats.manualSessionsCompleted : '—'}
        />
      </div>

      {!hasManualHistory ? (
        <div className="profile-empty">
          {scopedToInstrument ? (
            <>
              <h2>No {scopeLabel.toLowerCase()} sessions yet</h2>
              <p>
                Log a session while {scopeLabel} is selected and it shows up here.
                Use Start timer above.
              </p>
            </>
          ) : (
            <>
              <h2>No logged sessions yet</h2>
              <p>
                Press Start timer above when you begin practicing, then save the session
                with what you worked on.
              </p>
            </>
          )}
        </div>
      ) : (
        <section
          className="profile-panel"
          aria-labelledby="manual-sessions-heading"
        >
          <h2 id="manual-sessions-heading" className="profile-panel__title">
            Session notes
          </h2>
          <ul className="profile-list">
            {manualSessions.map((session) => (
              <li key={session.id} className="profile-list__item">
                <span>
                  <strong>{session.pieceTitle}</strong>
                  <small>
                    {getInstrument(session.instrumentId).label} ·{' '}
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
        <p>Your practice journal stays in this browser. Clearing browser data removes it.</p>
        {hasPieceActivity || hasManualHistory || (viewStats.autoPracticeSeconds ?? 0) > 0 ? (
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
        ) : null}
      </footer>
    </main>
  )
}
