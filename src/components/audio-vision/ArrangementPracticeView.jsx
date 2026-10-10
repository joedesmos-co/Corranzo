/**
 * A8 — Practice surface for audio arrangements (no PDF).
 *
 * The timing/practice ENGINE is PDF-independent (checkpoints, playback, WFY
 * matching all run off the timing map); only the page-follow visuals need a
 * PDF. This surface exposes the engine honestly: modes, transport, current
 * target with TAB/hand readout, progress and the full checkpoint list.
 * It consumes the shared practice session read-only and modifies no
 * practice-engine code.
 */
import { useMemo } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { PRACTICE_MODE, PRACTICE_MODE_LABELS } from '../../features/practice/practiceMode.js'
import { buildNoteCheckpoints } from '../../features/practice/waitForYouCheckpoints.js'

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return '–'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function describeTarget(checkpoint) {
  if (!checkpoint) return 'Get ready…'
  const frets = checkpoint.expectedStringFrets ?? []
  if (frets.length) {
    const tabs = [...frets]
      .sort((a, b) => a.string - b.string)
      .map((sf) => `string ${sf.string} fret ${sf.fret}`)
      .join(' · ')
    return `${checkpoint.label ?? ''} — ${tabs}`
  }
  return checkpoint.label ?? `Measure ${checkpoint.measureNumber}`
}

export default function ArrangementPracticeView({ musicXmlSource = null, onReturnToLibrary = null }) {
  const { session } = usePracticeSessionContext()
  const arrangement = musicXmlSource?.omrMeta?.arrangement ?? null
  const timingMap = session.timing?.timingMap ?? null
  const checkpoints = useMemo(
    () => (timingMap ? buildNoteCheckpoints(timingMap) : []),
    [timingMap],
  )
  const waitForYou = session.waitForYou
  const practiceTime = session.practiceTime ?? session.clock?.practiceTime ?? 0
  const activeIndex = useMemo(() => {
    if (!checkpoints.length) return 0
    if (session.isWaitForYou && Number.isFinite(waitForYou?.checkpointIndex)) {
      return Math.max(0, Math.min(checkpoints.length - 1, waitForYou.checkpointIndex))
    }
    const t = Number(practiceTime)
    let idx = 0
    for (let i = 0; i < checkpoints.length; i += 1) {
      if (checkpoints[i].timeSeconds <= t + 1e-6) idx = i
      else break
    }
    return idx
  }, [checkpoints, session.isWaitForYou, waitForYou, practiceTime])
  const current = checkpoints[activeIndex] ?? null
  const isPlaying = Boolean(session.playback?.isPlaying)
  const playDisabled = Boolean(session.playback?.playDisabled) || Boolean(session.timingDisabled)
  const wfyReady = Boolean(session.wfyInputSourceReady)

  if (!session.hasMusicXml || session.timingDisabled || !checkpoints.length) {
    return (
      <div className="practice-workspace__empty" role="status">
        <h2>Preparing your arrangement</h2>
        <p className="practice-workspace__empty-lead">Reading the generated notation…</p>
        {onReturnToLibrary && <button className="cz-text-link" onClick={onReturnToLibrary}>Library</button>}
      </div>
    )
  }

  const excerpt = arrangement?.excerpt ?? null
  return (
    <div className="arrangement-practice" aria-label="Arrangement practice">
      <header className="arrangement-practice__header">
        <p className="cz-edition-label">Arranged from your recording</p>
        <h2>
          {arrangement?.targetPart === 'solo-guitar' ? 'Solo Guitar' : 'Solo Piano'}
          {arrangement?.difficulty ? ` · ${arrangement.difficulty}` : ''}
        </h2>
        <p className="audio-vision-hint">
          {musicXmlSource?.fileName ?? 'audio arrangement'}
          {Number.isFinite(arrangement?.confidence) ? ` · confidence ${Math.round(arrangement.confidence * 100)}%` : ''}
          {excerpt?.truncated ? ` · covers ${formatClock(excerpt.startSeconds)}–${formatClock(excerpt.startSeconds + excerpt.durationSeconds)} of ${formatClock(excerpt.totalSeconds)}` : ''}
        </p>
      </header>

      <div className="arrangement-practice__modes" role="radiogroup" aria-label="Practice mode">
        {Object.values(PRACTICE_MODE).map((value) => {
          const disabled = value === PRACTICE_MODE.WAIT_FOR_YOU && !wfyReady
          return (
            <button
              key={value}
              role="radio"
              aria-checked={session.practiceMode === value}
              disabled={disabled}
              title={disabled ? 'Wait For You needs a connected microphone or MIDI instrument' : undefined}
              onClick={() => session.setPracticeMode?.(value)}
            >
              <strong>{PRACTICE_MODE_LABELS[value]}</strong>
            </button>
          )
        })}
      </div>
      {!wfyReady && (
        <p className="audio-vision-hint" role="note">Wait For You needs a connected microphone or MIDI instrument. Preview and Play Along work now.</p>
      )}

      <div className="arrangement-practice__transport">
        {isPlaying
          ? <button className="cz-collection-button" onClick={() => session.playback?.pause?.()}>Pause</button>
          : <button className="cz-collection-button" onClick={() => session.handlePlay?.()} disabled={playDisabled}>Play</button>}
        <span className="audio-vision-hint" role="status">
          Target {activeIndex + 1} of {checkpoints.length}
          {session.playback?.isLoading ? ' · loading sound…' : ''}
        </span>
      </div>

      <section className="arrangement-practice__target" aria-label="Current target" aria-live="polite">
        <p className="cz-edition-label">Now {session.isWaitForYou ? 'play' : 'hear'} · Measure {current?.measureNumber ?? '–'}</p>
        <p><strong>{describeTarget(current)}</strong></p>
        {session.isWaitForYou && session.waitForYou?.displayLabel && (
          <p className="audio-vision-hint">{session.waitForYou.displayLabel}</p>
        )}
      </section>

      <details className="arrangement-practice__list">
        <summary>All targets ({checkpoints.length})</summary>
        <ol>
          {checkpoints.map((checkpoint, index) => (
            <li key={checkpoint.id} aria-current={index === activeIndex ? 'true' : undefined}>
              <span>m{checkpoint.measureNumber} · {formatClock(checkpoint.timeSeconds)} · {describeTarget(checkpoint)}</span>
            </li>
          ))}
        </ol>
      </details>

      <p className="audio-vision-hint">Page-follow visuals need a PDF. Timing, sound and targets run from your arrangement.</p>
      {onReturnToLibrary && <button className="cz-text-link" onClick={onReturnToLibrary}>Back to Library</button>}
    </div>
  )
}
