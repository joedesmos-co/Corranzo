import { useEffect, useState } from 'react'
import { useProfileStats } from '../../context/ProfileStatsContext.jsx'
import { INPUT_MODE } from '../../features/profile/profileStatsSchema.js'
import ProfileDevTools from './ProfileDevTools.jsx'

const INPUT_LABELS = {
  [INPUT_MODE.MIDI]: 'MIDI',
  [INPUT_MODE.MICROPHONE]: 'Microphone',
  [INPUT_MODE.MANUAL]: 'Manual',
  [INPUT_MODE.MIXED]: 'Mixed',
  midi: 'MIDI',
  microphone: 'Microphone',
  manual: 'Manual',
  mixed: 'Mixed',
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds ?? 0))
  if (total < 60) {
    return `${total}s`
  }
  const minutes = Math.floor(total / 60)
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function StatCard({ label, value, hint }) {
  return (
    <div className="profile-stat">
      <span className="profile-stat__label">{label}</span>
      <span className="profile-stat__value">{value}</span>
      {hint ? <span className="profile-stat__hint">{hint}</span> : null}
    </div>
  )
}

export default function ProfileView() {
  const { metrics, profile, updateDisplayName, resetAllStats } = useProfileStats()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(profile.displayName)

  useEffect(() => {
    setNameDraft(profile.displayName)
  }, [profile.displayName])

  function commitName() {
    updateDisplayName(nameDraft)
    setEditingName(false)
  }

  const hasHistory =
    metrics.recentSessions.length > 0 ||
    metrics.sessionsCompleted > 0 ||
    metrics.totalPracticeMinutes > 0

  return (
    <section className="profile-view" aria-labelledby="profile-heading">
      <header className="profile-header">
        <div className="profile-header__identity">
          <h2 id="profile-heading" className="profile-header__title">
            Practice profile
          </h2>
          {editingName ? (
            <form
              className="profile-name-form"
              onSubmit={(event) => {
                event.preventDefault()
                commitName()
              }}
            >
              <input
                className="profile-name-form__input"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                maxLength={40}
                aria-label="Display name"
                autoFocus
              />
              <button type="submit" className="profile-name-form__save">
                Save
              </button>
              <button
                type="button"
                className="profile-name-form__cancel"
                onClick={() => {
                  setNameDraft(profile.displayName)
                  setEditingName(false)
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <p className="profile-header__name">
              {metrics.displayName}
              <button
                type="button"
                className="profile-header__edit"
                onClick={() => {
                  setNameDraft(profile.displayName)
                  setEditingName(true)
                }}
              >
                Edit name
              </button>
            </p>
          )}
          <p className="profile-header__lede">
            Your progress stays on this device. Calm tallies — no accounts, no pressure.
          </p>
        </div>

        <div className="profile-level" aria-label="Practice level">
          <div className="profile-level__row">
            <span className="profile-level__label">Level {metrics.level.level}</span>
            <span className="profile-level__name">{metrics.level.label}</span>
          </div>
          <div className="profile-level__track" role="progressbar" aria-valuenow={Math.round(metrics.level.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="profile-level__fill"
              style={{ width: `${Math.round(metrics.level.progress * 100)}%` }}
            />
          </div>
          {!metrics.level.isMaxLevel ? (
            <p className="profile-level__hint">
              {metrics.level.xpToNext} XP to next level — earned from steady practice, not streaks alone.
            </p>
          ) : null}
        </div>
      </header>

      <div className="profile-stats-grid">
        <StatCard label="Practice time" value={`${metrics.totalPracticeMinutes} min`} />
        <StatCard label="Sessions" value={metrics.sessionsCompleted} hint="≥1 min or 3 WFY matches" />
        <StatCard label="Pieces" value={metrics.uniquePieces} />
        <StatCard
          label="Current streak"
          value={`${metrics.streak.current} day${metrics.streak.current === 1 ? '' : 's'}`}
          hint="Days with meaningful practice"
        />
        <StatCard
          label="Longest streak"
          value={`${metrics.streak.longest} day${metrics.streak.longest === 1 ? '' : 's'}`}
        />
        <StatCard label="WFY notes matched" value={metrics.notesMatched} />
        <StatCard
          label="WFY accuracy"
          value={metrics.accuracyPercent != null ? `${metrics.accuracyPercent}%` : '—'}
          hint={metrics.notesAttempted > 0 ? `${metrics.notesAttempted} attempts` : 'After first attempts'}
        />
        <StatCard label="Wait For You time" value={`${metrics.waitForYouMinutes} min`} />
      </div>

      {!hasHistory ? (
        <div className="profile-empty">
          <p>Practice a piece to start building your history. Open Practice after loading a score.</p>
        </div>
      ) : (
        <>
          <section className="profile-panel" aria-labelledby="profile-weekly-heading">
            <h3 id="profile-weekly-heading" className="profile-panel__title">
              This week
            </h3>
            <div className="profile-weekly" role="img" aria-label="Weekly practice minutes chart">
              {metrics.weeklyChart.map((bucket) => (
                <div key={bucket.dayKey} className="profile-weekly__col">
                  <div className="profile-weekly__bar-wrap">
                    <div
                      className="profile-weekly__bar"
                      style={{ height: `${bucket.heightPercent}%` }}
                      title={`${bucket.minutes} min`}
                    />
                  </div>
                  <span className="profile-weekly__label">{bucket.label}</span>
                  <span className="profile-weekly__mins">{bucket.minutes}m</span>
                </div>
              ))}
            </div>
          </section>

          <div className="profile-panels-row">
            <section className="profile-panel" aria-labelledby="profile-heatmap-heading">
              <h3 id="profile-heatmap-heading" className="profile-panel__title">
                Practice rhythm
              </h3>
              <p className="profile-panel__subtitle">Last 12 weeks — darker means more active time.</p>
              <div className="profile-heatmap" aria-hidden="true">
                {metrics.heatmap.map((cell) => (
                  <span
                    key={cell.dayKey}
                    className={`profile-heatmap__cell profile-heatmap__cell--${cell.level}`}
                  />
                ))}
              </div>
            </section>

            <section className="profile-panel" aria-labelledby="profile-wfy-trend-heading">
              <h3 id="profile-wfy-trend-heading" className="profile-panel__title">
                Wait For You accuracy
              </h3>
              {metrics.wfyTrend.length === 0 ? (
                <p className="profile-panel__empty">No matched attempts yet.</p>
              ) : (
                <ul className="profile-trend">
                  {metrics.wfyTrend.map((point) => (
                    <li key={point.sessionId} className="profile-trend__row">
                      <span>{point.label}</span>
                      <span>{point.percent != null ? `${point.percent}%` : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="profile-panels-row">
            <section className="profile-panel" aria-labelledby="profile-recent-heading">
              <h3 id="profile-recent-heading" className="profile-panel__title">
                Recent sessions
              </h3>
              {metrics.recentSessions.length === 0 ? (
                <p className="profile-panel__empty">No sessions recorded yet.</p>
              ) : (
                <ul className="profile-sessions">
                  {metrics.recentSessions.map((session) => (
                    <li key={session.id} className="profile-sessions__item">
                      <div className="profile-sessions__main">
                        <span className="profile-sessions__piece">{session.pieceTitle}</span>
                        <span className="profile-sessions__meta">
                          {formatDate(session.endedAt ?? session.startedAt)}
                          {' · '}
                          {formatDuration(session.practiceSecondsActive)}
                          {session.practiceMode === 'wait-for-you' ? ' · WFY' : ''}
                        </span>
                      </div>
                      <span className="profile-sessions__mode">
                        {INPUT_LABELS[session.dominantInputMode] ?? session.dominantInputMode ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="profile-panel" aria-labelledby="profile-pieces-heading">
              <h3 id="profile-pieces-heading" className="profile-panel__title">
                Most practiced
              </h3>
              {metrics.favoritePieces.length === 0 ? (
                <p className="profile-panel__empty">Pieces appear here after you practice them.</p>
              ) : (
                <ul className="profile-pieces">
                  {metrics.favoritePieces.map((piece) => (
                    <li key={piece.id} className="profile-pieces__item">
                      <span className="profile-pieces__title">
                        {piece.title}
                        {piece.isDemoPiece ? (
                          <span className="profile-pieces__tag">Sample</span>
                        ) : null}
                      </span>
                      <span className="profile-pieces__meta">
                        {formatDuration(piece.totalSeconds)} · {piece.sessionCount} session
                        {piece.sessionCount === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <ProfileDevTools />

      <footer className="profile-footer">
        <p>Stored locally in your browser. Clearing site data removes this history.</p>
        <button
          type="button"
          className="profile-footer__reset"
          onClick={() => {
            if (
              window.confirm(
                'Clear all local practice stats and reset your display name? This cannot be undone.',
              )
            ) {
              resetAllStats()
              setNameDraft('Musician')
              setEditingName(false)
            }
          }}
        >
          Reset local stats
        </button>
      </footer>
    </section>
  )
}
