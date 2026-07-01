import { formatTime } from '../../features/playback/formatTime.js'
import {
  PRACTICE_SYNC_LABELS,
  PRACTICE_SYNC_STATUS,
} from '../../features/practice/practiceClock.js'
import AlignmentDiagnosticsSection from './AlignmentDiagnosticsSection.jsx'

function EventRow({ event }) {
  const detail =
    event.type === 'tempo-change'
      ? `${event.bpm} BPM`
      : event.type === 'time-signature'
        ? `${event.beats}/${event.beatType}`
        : event.type === 'note-on'
          ? event.label
          : event.type === 'measure-start'
            ? `measure ${event.measureNumber}`
            : event.type

  return (
    <li className="timing-diagnostics__event">
      <span className="timing-diagnostics__event-time">
        {formatTime(event.timeSeconds)}
      </span>
      <span className="timing-diagnostics__event-type">{event.type}</span>
      <span className="timing-diagnostics__event-detail">{detail}</span>
    </li>
  )
}

export default function ScoreTimingDiagnosticsPanel({
  timingMap,
  debugState,
  practiceTime,
  manualTime,
  onManualTimeChange,
  canManualScrub,
  syncStatus,
  isFollowingMidi,
  isLoading,
  error,
  hasMidi,
  hasMusicXml,
  alignmentDiagnostics,
  isAlignmentLoading,
  alignmentError,
}) {
  if (!hasMusicXml && !isLoading && !error) {
    return (
      <p className="timing-diagnostics__empty">
        Load a timing file to inspect measure data and file alignment.
      </p>
    )
  }

  const syncLabel =
    PRACTICE_SYNC_LABELS[syncStatus] ?? PRACTICE_SYNC_LABELS[PRACTICE_SYNC_STATUS.NONE]

  return (
    <div className="timing-diagnostics">
      <p className={`timing-diagnostics__sync${isFollowingMidi ? ' timing-diagnostics__sync--active' : ''}`}>
        Clock: {syncLabel}
      </p>

      {isLoading && <p className="timing-diagnostics__status">Parsing timing file…</p>}
      {error && <p className="timing-diagnostics__error">{error}</p>}

      {timingMap?.fileName && (
        <p className="timing-diagnostics__file" title={timingMap.fileName}>
          {timingMap.fileName}
          {timingMap.title ? ` · ${timingMap.title}` : ''}
        </p>
      )}

      {timingMap && debugState && (
        <>
          <dl className="timing-diagnostics__stats">
            <div>
              <dt>Tempo</dt>
              <dd>{Math.round(debugState.tempo)} BPM</dd>
            </div>
            <div>
              <dt>Notes in map</dt>
              <dd>{debugState.noteCount}</dd>
            </div>
            <div>
              <dt>Written measures</dt>
              <dd>
                {timingMap.performedMeasureTimeline?.diagnostics?.writtenMeasureCount ??
                  timingMap.measures.length}
              </dd>
            </div>
            <div>
              <dt>Performed passes</dt>
              <dd>
                {timingMap.performedMeasureTimeline?.diagnostics?.performedMeasureCount ??
                  timingMap.measures.length}
              </dd>
            </div>
            <div>
              <dt>Timeline</dt>
              <dd>
                {timingMap.performedMeasureTimeline?.diagnostics?.usesPerformedTimeline
                  ? 'Performed (repeats expanded)'
                  : 'Written order'}
              </dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>{timingMap.timingEvents.length}</dd>
            </div>
          </dl>

          {timingMap.performedMeasureTimeline?.diagnostics?.hasRepeatMarks && (
            <dl className="timing-diagnostics__stats timing-diagnostics__stats--repeats">
              <div>
                <dt>Repeat sections</dt>
                <dd>{timingMap.performedMeasureTimeline.diagnostics.repeatSections.length}</dd>
              </div>
              <div>
                <dt>Endings</dt>
                <dd>{timingMap.performedMeasureTimeline.diagnostics.endings.length}</dd>
              </div>
              {debugState.repeatPass != null && (
                <div>
                  <dt>Current pass</dt>
                  <dd>{debugState.repeatPass}</dd>
                </div>
              )}
            </dl>
          )}

          {timingMap.performedMeasureTimeline?.diagnostics?.warning && (
            <p className="timing-diagnostics__repeat-warning" role="status">
              {timingMap.performedMeasureTimeline.diagnostics.warning}
            </p>
          )}

          {canManualScrub ? (
            <label className="timing-diagnostics__scrub">
              <span>Manual scrub (no playback)</span>
              <input
                type="range"
                min={0}
                max={timingMap.durationSeconds || 0}
                step={0.01}
                value={manualTime}
                onChange={(event) => onManualTimeChange(Number(event.target.value))}
              />
              <span className="timing-diagnostics__scrub-time">
                {formatTime(manualTime)} / {formatTime(timingMap.durationSeconds)}
              </span>
            </label>
          ) : (
            <p className="timing-diagnostics__clock">
              Practice clock: {formatTime(practiceTime)} /{' '}
              {formatTime(timingMap.durationSeconds)}
            </p>
          )}

          <details className="timing-diagnostics__details">
            <summary>Recent timing events</summary>
            <ul>
              {debugState.recentEvents.length === 0 ? (
                <li className="timing-diagnostics__event timing-diagnostics--muted">
                  No events at this position.
                </li>
              ) : (
                debugState.recentEvents.map((event, index) => (
                  <EventRow key={`${event.type}-${event.timeSeconds}-${index}`} event={event} />
                ))
              )}
            </ul>
          </details>

          {hasMidi && hasMusicXml && (
            <AlignmentDiagnosticsSection
              diagnostics={alignmentDiagnostics}
              isLoading={isAlignmentLoading}
              error={alignmentError}
            />
          )}
        </>
      )}
    </div>
  )
}
