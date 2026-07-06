import { WFY_STATUS } from '../../features/practice/waitForYouEngine.js'
import { WFY_DISPLAY_STATUS } from '../../features/practice/waitForYouDisplayStatus.js'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import { getExpectedMidis } from '../../features/practice/waitForYouNoteMatch.js'
import { WFY_INPUT_OUTCOME } from '../../features/practice/waitForYouInputFeedback.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'
import {
  MIC_PERMISSION,
  WFY_INPUT_SOURCE,
} from '../../features/microphone-input/micInputConstants.js'
import WaitForYouMatchSettingsPanel from './WaitForYouMatchSettingsPanel.jsx'
import WaitForYouInputSourceSelector from './WaitForYouInputSourceSelector.jsx'
import PracticeHelpTip from './PracticeHelpTip.jsx'

function statusMessage(status, currentCheckpoint, checkpointMode, displayLabel) {
  if (displayLabel) {
    return displayLabel
  }
  if (status === WFY_STATUS.NO_CHECKPOINTS) {
    return 'No practice steps'
  }
  if (status === WFY_STATUS.COMPLETE) {
    return 'Section complete'
  }
  if (status === WFY_STATUS.WAITING && currentCheckpoint) {
    return checkpointMode === WFY_CHECKPOINT_MODE.NOTE ? 'Waiting' : 'Waiting'
  }
  return 'Ready'
}

function statusClassName(displayStatus, engineStatus) {
  if (displayStatus === WFY_DISPLAY_STATUS.MISSED) {
    return 'missed'
  }
  if (displayStatus === WFY_DISPLAY_STATUS.CORRECT) {
    return 'correct'
  }
  if (displayStatus === WFY_DISPLAY_STATUS.CONTINUING) {
    return 'continuing'
  }
  return engineStatus
}

function feedbackClassName(outcome) {
  switch (outcome) {
    case WFY_INPUT_OUTCOME.CORRECT:
      return 'wait-for-you__feedback--success'
    case WFY_INPUT_OUTCOME.WRONG:
      return 'wait-for-you__feedback--error'
    case WFY_INPUT_OUTCOME.CHORD_PARTIAL:
      return 'wait-for-you__feedback--partial'
    case WFY_INPUT_OUTCOME.CHORD_WAITING:
      return 'wait-for-you__feedback--waiting'
    default:
      return 'wait-for-you__feedback--neutral'
  }
}

export default function WaitForYouSection({
  active,
  status,
  displayStatus = null,
  displayLabel = '',
  checkpointMode,
  currentCheckpoint,
  checkpointIndex,
  totalCheckpoints,
  inputSource,
  onInputSourceChange,
  midiAvailable,
  microphoneAvailable,
  inputMatchingActive,
  inputFeedback,
  guidance = null,
  matchSettings,
  rawMatchSettings,
  onMatchSettingChange,
  onResetMatchSettings,
  onPlayReference,
  referencePlaying,
  referenceError = null,
  onMarkCorrect,
  onSkip,
  onShowHint,
  onRestart,
  instrumentId = null,
  micListening = false,
  micPermission = null,
  micStatusLabel = null,
  micCalibrating = false,
  onRequestMicAccess = null,
  noteTarget = null,
  noteTargetWrongPage = false,
  showMatchSettings = true,
  compact = false,
}) {
  if (!active) {
    return null
  }

  const sectionClass = `practice-section wait-for-you${compact ? ' practice-section--compact' : ''}`

  const progressPercent =
    totalCheckpoints > 0
      ? Math.round((Math.min(checkpointIndex + 1, totalCheckpoints) / totalCheckpoints) * 100)
      : 0

  const showNoteFeedback =
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    inputMatchingActive &&
    inputFeedback?.message

  const showGuidance =
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    status === WFY_STATUS.WAITING &&
    guidance?.primary != null

  const showMicInputHint =
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    inputSource === WFY_INPUT_SOURCE.MICROPHONE &&
    status === WFY_STATUS.WAITING &&
    getExpectedMidis(currentCheckpoint).length > 1 &&
    !isGuitarChordShape
  const showMicOffNotice =
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    inputSource === WFY_INPUT_SOURCE.MICROPHONE &&
    status === WFY_STATUS.WAITING &&
    !micListening
  const micAccessBlocked = micPermission === MIC_PERMISSION.DENIED
  const micAccessError = micPermission === MIC_PERMISSION.ERROR
  const currentStatusMessage = statusMessage(
    status,
    currentCheckpoint,
    checkpointMode,
    displayLabel,
  )
  const targetApproximate = Boolean(
    noteTarget?.visible &&
      (noteTarget.approximate || (noteTarget.confidence != null && noteTarget.confidence < 0.7)),
  )
  const statusModifier = statusClassName(displayStatus, status)
  // "Structurally done" states (finished / nothing to practice) hide the
  // action buttons entirely instead of stacking disabled ones — only Restart
  // stays. Transient states (Continuing, reference playing) keep buttons
  // visible-but-disabled so the row doesn't flicker between checkpoints.
  const structurallyDone =
    status === WFY_STATUS.COMPLETE || status === WFY_STATUS.NO_CHECKPOINTS
  const primaryActionDisabled = displayStatus === WFY_DISPLAY_STATUS.CONTINUING
  const expectedMidis = currentCheckpoint ? getExpectedMidis(currentCheckpoint) : []
  const isGuitarChordShape = Boolean(currentCheckpoint?.isGuitarChordShape)
  const micChordSequence =
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    inputSource === WFY_INPUT_SOURCE.MICROPHONE &&
    expectedMidis.length > 1 &&
    !isGuitarChordShape

  return (
    <section className={sectionClass} aria-label="Wait For You">
      <div className="wait-for-you__header">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial practice-section__title--with-tip">
          Wait For You
          <PracticeHelpTip label="About Wait For You">
            Pauses at each note in your loop until you play it or tap Continue.
          </PracticeHelpTip>
        </h3>
        {status === WFY_STATUS.WAITING && displayStatus !== WFY_DISPLAY_STATUS.CONTINUING && (
          <span className="wait-for-you__badge wait-for-you__badge--pulse" role="status">
            {displayStatus === WFY_DISPLAY_STATUS.MISSED ? 'Try again' : 'Your turn'}
          </span>
        )}
        {displayStatus === WFY_DISPLAY_STATUS.CONTINUING && (
          <span className="wait-for-you__badge wait-for-you__badge--continuing" role="status">
            Continuing
          </span>
        )}
      </div>

      <WaitForYouInputSourceSelector
        checkpointMode={checkpointMode}
        inputSource={inputSource}
        onInputSourceChange={onInputSourceChange}
        instrumentId={instrumentId}
        midiAvailable={midiAvailable}
        microphoneAvailable={microphoneAvailable}
        disabled={structurallyDone}
      />

      {showMatchSettings && matchSettings && (
        <WaitForYouMatchSettingsPanel
          checkpointMode={checkpointMode}
          settings={matchSettings}
          rawSettings={rawMatchSettings}
          onUpdateSetting={onMatchSettingChange}
          onResetSettings={onResetMatchSettings}
          disabled={structurallyDone}
        />
      )}

      {currentStatusMessage && (
        <p
          className={`wait-for-you__status wait-for-you__status--${statusModifier}`}
          role="status"
          aria-live="polite"
        >
          {currentStatusMessage}
        </p>
      )}

      {totalCheckpoints > 0 && (
        <div className="wait-for-you__progress-block">
          <div className="wait-for-you__progress-header">
            <span>Progress</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="wait-for-you__progress-track">
            <div
              className="wait-for-you__progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {inputMatchingActive && inputSource === WFY_INPUT_SOURCE.MICROPHONE && (
        <p
          className={`wait-for-you__mic-calibration${
            micCalibrating ? ' wait-for-you__mic-calibration--measuring' : ' wait-for-you__mic-calibration--ready'
          }`}
          role="status"
          aria-live="polite"
        >
          {micStatusLabel ?? 'Listening on mic'}
        </p>
      )}

      {inputMatchingActive && inputSource === WFY_INPUT_SOURCE.MIDI && (
        <p className="wait-for-you__listening">Listening on MIDI</p>
      )}

      {showMicOffNotice && (
        <div className="wait-for-you__mic-off" role="status" aria-live="polite">
          <p>
            {micAccessBlocked
              ? 'Microphone access is blocked. Allow it in your browser, or change input.'
              : micAccessError
                ? 'Microphone did not start. Check your input device, or change input.'
                : 'Starting microphone... allow access, then stay quiet for a moment.'}
          </p>
          {onRequestMicAccess && !micAccessBlocked && (
            <button type="button" className="wait-for-you__btn" onClick={onRequestMicAccess}>
              Start microphone
            </button>
          )}
        </div>
      )}

      {showMicInputHint && (
        <p className="wait-for-you__mic-chord-hint" role="status">
          Chord practice sequence: play one chord tone at a time. Use MIDI for chords together.
        </p>
      )}

      {checkpointMode === WFY_CHECKPOINT_MODE.NOTE && status === WFY_STATUS.WAITING && (
        <p className="wait-for-you__note-target-status" role="status">
          {noteTargetWrongPage && noteTarget?.visible ? (
            <>Target on page {noteTarget.page} — switching…</>
          ) : noteTarget?.visible ? (
            <>
              <span className="wait-for-you__note-target-chip">Your note</span>
              {targetApproximate
                ? ' · approximate position'
                : noteTarget.displayMode === 'highlight'
                  ? ' · highlighted on score'
                  : ' · approximate position'}
            </>
          ) : (
            <>Set up the score cursor in Advanced to highlight your note.</>
          )}
        </p>
      )}

      {showGuidance && (
        <div
          className={`wait-for-you__guidance wait-for-you__guidance--${guidance.tone}`}
          role="status"
          aria-live="polite"
        >
          <p className="wait-for-you__guidance-primary">{guidance.primary}</p>
          {guidance.state === 'wrong' && guidance.playedLabel && (
            <p className="wait-for-you__guidance-detail">
              Expected: <strong>{guidance.expectedLabel}</strong>
              {' · '}You played: <strong>{guidance.playedLabel}</strong>
            </p>
          )}
          {guidance.state === 'partial' && guidance.heardLabels?.length > 0 && (
            <p className="wait-for-you__guidance-detail">
              Heard: <strong>{guidance.heardLabels.join(' + ')}</strong>
            </p>
          )}
          {guidance.state === 'partial' && guidance.missingLabels?.length > 0 && (
            <p className="wait-for-you__guidance-detail">
              Still need: <strong>{guidance.missingLabels.join(', ')}</strong>
            </p>
          )}
          {guidance.hint && <p className="wait-for-you__guidance-hint">{guidance.hint}</p>}
        </div>
      )}

      {referenceError && (
        <p className="wait-for-you__reference-error" role="alert">
          {referenceError}
        </p>
      )}

      {/* Live "hearing X" confirmation (mic) while still waiting. */}
      {showNoteFeedback && !showGuidance && (
        <p
          className={`wait-for-you__feedback ${feedbackClassName(inputFeedback.outcome)}`}
          role="status"
          aria-live="polite"
        >
          {inputFeedback.message}
        </p>
      )}

      {currentCheckpoint && (
        <div className="wait-for-you__now-playing">
          <p className="wait-for-you__now-label">At</p>
          <p className="wait-for-you__now-place">
            Measure {currentCheckpoint.measureNumber ?? '—'}
            {currentCheckpoint.beat != null && (
              <span>, beat {currentCheckpoint.beat}</span>
            )}
          </p>
          {checkpointMode === WFY_CHECKPOINT_MODE.NOTE && (
            <p className="wait-for-you__now-notes">
              <span className="wait-for-you__now-notes-label">
                {isGuitarChordShape
                  ? 'Play shape'
                  : micChordSequence
                    ? 'Chord practice sequence'
                    : expectedMidis.length > 1
                      ? 'Play together'
                      : 'Play'}
              </span>
              <span className="wait-for-you__note-chips">
                {isGuitarChordShape ? (
                  <span className="wait-for-you__note-chip wait-for-you__note-chip--shape">
                    {currentCheckpoint.displayLabel ?? guidance?.expectedLabel ?? 'Chord shape'}
                  </span>
                ) : (
                  expectedMidis.map((midi) => (
                    <span key={midi} className="wait-for-you__note-chip">
                      {midiToNoteLabel(midi)}
                    </span>
                  ))
                )}
              </span>
            </p>
          )}
        </div>
      )}

      {status !== WFY_STATUS.NO_CHECKPOINTS && (
        <div className="wait-for-you__actions">
          {!structurallyDone && (
            <button
              type="button"
              className="wait-for-you__btn wait-for-you__btn--primary"
              disabled={primaryActionDisabled}
              onClick={onMarkCorrect}
            >
              Continue
            </button>
          )}
          {!structurallyDone && checkpointMode === WFY_CHECKPOINT_MODE.NOTE && currentCheckpoint && (
            <button
              type="button"
              className="wait-for-you__btn"
              disabled={
                referencePlaying ||
                displayStatus === WFY_DISPLAY_STATUS.CONTINUING ||
                expectedMidis.length === 0
              }
              onClick={() => onPlayReference(currentCheckpoint)}
            >
              {referencePlaying ? 'Playing…' : 'Hear it'}
            </button>
          )}
          {!structurallyDone && checkpointMode === WFY_CHECKPOINT_MODE.NOTE && onShowHint && (
            <button type="button" className="wait-for-you__btn" onClick={onShowHint}>
              Show hint
            </button>
          )}
          {!structurallyDone && onSkip && (
            <button
              type="button"
              className="wait-for-you__btn"
              disabled={displayStatus === WFY_DISPLAY_STATUS.CONTINUING}
              onClick={onSkip}
              title="Skip this note/chord"
            >
              Skip
            </button>
          )}
          {totalCheckpoints > 0 && (
            <button type="button" className="wait-for-you__btn" onClick={onRestart}>
              Restart
            </button>
          )}
        </div>
      )}
    </section>
  )
}
