import { useEffect, useReducer, useState } from 'react'
import { useProfileStats } from '../../context/ProfileStatsContext.jsx'
import { useInstrument } from '../../context/instrumentContext.js'
import { EXERCISE_TYPES } from '../../features/profile/exerciseTypes.js'
import {
  MANUAL_TIMER_IDLE,
  MANUAL_TIMER_PAUSED,
  MANUAL_TIMER_RUNNING,
  clearManualDraft,
  createManualTimerState,
  formatTimerDisplay,
  getManualTimerElapsedMs,
  loadManualDraft,
  pauseManualTimer,
  resumeManualTimer,
  saveManualDraft,
  startManualTimer,
  stopManualTimer,
} from '../../features/profile/manualPracticeTimer.js'

function timerReducer(state, action) {
  switch (action.type) {
    case 'start':
      return startManualTimer(state, action.now)
    case 'pause':
      return pauseManualTimer(state, action.now)
    case 'resume':
      return resumeManualTimer(state, action.now)
    case 'stop':
      return action.nextState
    case 'reset':
      return createManualTimerState()
    case 'restore':
      return action.timerState
    default:
      return state
  }
}

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

function getInitialDraft() {
  try {
    return loadManualDraft()
  } catch {
    return null
  }
}

export default function ManualPracticeLog({ defaultPieceId = null }) {
  const { saveManualPracticeSession } = useProfileStats()
  const { instrumentId } = useInstrument()
  const [initialDraft] = useState(getInitialDraft)
  const [timerState, dispatchTimer] = useReducer(
    timerReducer,
    undefined,
    () => initialDraft?.timerState ?? createManualTimerState(),
  )
  const [displayMs, setDisplayMs] = useState(() =>
    getManualTimerElapsedMs(initialDraft?.timerState ?? createManualTimerState()),
  )
  const [pendingSave, setPendingSave] = useState(() => initialDraft?.pendingSave ?? null)
  const [sessionInstrumentId, setSessionInstrumentId] = useState(
    () => initialDraft?.sessionInstrumentId ?? null,
  )
  const [pieceTitle, setPieceTitle] = useState(() => initialDraft?.pieceTitle ?? '')
  const [exerciseType, setExerciseType] = useState(() => initialDraft?.exerciseType ?? 'scales')
  const [notes, setNotes] = useState(() => initialDraft?.notes ?? '')
  const [saveMessage, setSaveMessage] = useState(() =>
    initialDraft?.pendingSave || (initialDraft && initialDraft.timerState.status !== MANUAL_TIMER_IDLE)
      ? 'Your timer was restored after reloading. Nothing was lost.'
      : '',
  )
  const [saveFailed, setSaveFailed] = useState(false)

  const isRunning = timerState.status === MANUAL_TIMER_RUNNING
  const isPaused = timerState.status === MANUAL_TIMER_PAUSED
  const isActive = isRunning || isPaused

  useEffect(() => {
    if (!isRunning) {
      setDisplayMs(getManualTimerElapsedMs(timerState))
      return undefined
    }

    const tick = () => {
      setDisplayMs(getManualTimerElapsedMs(timerState))
    }

    tick()
    const intervalId = window.setInterval(tick, 250)
    return () => window.clearInterval(intervalId)
  }, [isRunning, timerState])

  // Durable draft: reload restores the timer + pending form.
  useEffect(() => {
    if (timerState.status === MANUAL_TIMER_IDLE && !pendingSave && !pieceTitle && !notes) {
      clearManualDraft()
      return
    }
    saveManualDraft({
      timerState,
      sessionInstrumentId,
      pieceTitle,
      exerciseType,
      notes,
      pendingSave,
    })
  }, [timerState, sessionInstrumentId, pieceTitle, exerciseType, notes, pendingSave])

  function handleStart() {
    setSaveMessage('')
    setSaveFailed(false)
    setPendingSave(null)
    setSessionInstrumentId(instrumentId)
    dispatchTimer({ type: 'start', now: Date.now() })
  }

  function handlePause() {
    dispatchTimer({ type: 'pause', now: Date.now() })
  }

  function handleResume() {
    dispatchTimer({ type: 'resume', now: Date.now() })
  }

  function handleStop() {
    const result = stopManualTimer(timerState, Date.now())
    dispatchTimer({ type: 'stop', nextState: result.nextState })

    if (result.elapsedSeconds < 1) {
      setSaveMessage('Practice for at least one second before saving.')
      setSaveFailed(false)
      setPendingSave(null)
      return
    }

    setSaveMessage('')
    setSaveFailed(false)
    setPendingSave({
      durationSeconds: result.elapsedSeconds,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      instrumentId: sessionInstrumentId ?? instrumentId,
    })
  }

  function handleDiscard() {
    setPendingSave(null)
    setSessionInstrumentId(null)
    setPieceTitle('')
    setExerciseType('scales')
    setNotes('')
    setSaveMessage('')
    setSaveFailed(false)
    dispatchTimer({ type: 'reset' })
    clearManualDraft()
  }

  function handleSave(event) {
    event.preventDefault()
    if (!pendingSave) {
      return
    }

    const result = saveManualPracticeSession({
      pieceTitle,
      exerciseType,
      notes,
      durationSeconds: pendingSave.durationSeconds,
      startedAt: pendingSave.startedAt,
      endedAt: pendingSave.endedAt,
      instrumentId: pendingSave.instrumentId,
      // Integrator seam: exact current-score identity when the product has
      // it (App.jsx passes practicePiece.id). trySaveManualSession joins this
      // canonical id; when null it falls back to title/slug aliases.
      ...(defaultPieceId ? { pieceId: defaultPieceId } : {}),
    })

    if (result?.ok) {
      setSaveMessage('Session saved to your practice log.')
      setSaveFailed(false)
      setPendingSave(null)
      setSessionInstrumentId(null)
      setPieceTitle('')
      setExerciseType('scales')
      setNotes('')
      dispatchTimer({ type: 'reset' })
      clearManualDraft()
    } else {
      // Truthful failure: keep the pending work for retry, never claim success.
      setSaveFailed(true)
      setSaveMessage(
        'Your session couldn’t be saved — device storage may be full. Your work is kept here; try saving again.',
      )
    }
  }

  return (
    <section
      className="profile-panel profile-manual-log"
      aria-labelledby="manual-practice-heading"
    >
      <h2 id="manual-practice-heading" className="profile-panel__title">
        Log practice
      </h2>
      <p className="profile-manual-log__lede">
        Start a timer when you sit down to practice, then save what you worked on.
      </p>

      <div className="profile-manual-log__timer" aria-live="polite">
        <span className="profile-manual-log__time">
          {formatTimerDisplay(isActive || pendingSave ? displayMs : 0)}
        </span>
        {pendingSave ? (
          <span className="profile-manual-log__status">
            Ready to save · {formatDuration(pendingSave.durationSeconds)}
          </span>
        ) : (
          <span className="profile-manual-log__status">
            {timerState.status === MANUAL_TIMER_IDLE && 'Timer stopped'}
            {isRunning && 'Practicing'}
            {isPaused && 'Paused'}
          </span>
        )}
      </div>

      <div className="profile-manual-log__controls">
        {timerState.status === MANUAL_TIMER_IDLE && !pendingSave ? (
          <button
            type="button"
            className="profile-manual-log__btn profile-manual-log__btn--primary"
            onClick={handleStart}
          >
            Start timer
          </button>
        ) : null}

        {isRunning ? (
          <>
            <button
              type="button"
              className="profile-manual-log__btn"
              onClick={handlePause}
            >
              Pause
            </button>
            <button
              type="button"
              className="profile-manual-log__btn profile-manual-log__btn--primary"
              onClick={handleStop}
            >
              Stop
            </button>
          </>
        ) : null}

        {isPaused ? (
          <>
            <button
              type="button"
              className="profile-manual-log__btn profile-manual-log__btn--primary"
              onClick={handleResume}
            >
              Resume
            </button>
            <button
              type="button"
              className="profile-manual-log__btn"
              onClick={handleStop}
            >
              Stop
            </button>
          </>
        ) : null}
      </div>

      {pendingSave ? (
        <form className="profile-manual-log__form" onSubmit={handleSave}>
          <label className="profile-manual-log__field">
            <span>Piece or topic</span>
            <input
              type="text"
              value={pieceTitle}
              onChange={(event) => setPieceTitle(event.target.value)}
              placeholder="e.g. C major scale, Bach prelude"
              maxLength={120}
              required
            />
          </label>

          <label className="profile-manual-log__field">
            <span>Exercise type</span>
            <select
              value={exerciseType}
              onChange={(event) => setExerciseType(event.target.value)}
            >
              {EXERCISE_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          <label className="profile-manual-log__field">
            <span>Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What went well, what to revisit..."
              rows={3}
              maxLength={500}
            />
          </label>

          <div className="profile-manual-log__form-actions">
            <button
              type="button"
              className="profile-manual-log__btn"
              onClick={handleDiscard}
            >
              Discard
            </button>
            <button
              type="submit"
              className="profile-manual-log__btn profile-manual-log__btn--primary"
            >
              {saveFailed ? 'Try saving again' : 'Save session'}
            </button>
          </div>
        </form>
      ) : null}

      {saveMessage ? (
        <p className="profile-manual-log__message" role="status">
          {saveMessage}
        </p>
      ) : null}
    </section>
  )
}
