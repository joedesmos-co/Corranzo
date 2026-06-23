import { WFY_STATUS } from '../../features/practice/waitForYouEngine.js'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import { getExpectedMidis } from '../../features/practice/waitForYouNoteMatch.js'
import { WFY_INPUT_OUTCOME } from '../../features/practice/waitForYouInputFeedback.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'
import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'
import WaitForYouMatchSettingsPanel from './WaitForYouMatchSettingsPanel.jsx'
import WaitForYouInputSourceSelector from './WaitForYouInputSourceSelector.jsx'
import PracticeHelpTip from './PracticeHelpTip.jsx'

const CHECKPOINT_LABELS = {
  [WFY_CHECKPOINT_MODE.BEAT]: 'Beat',
  [WFY_CHECKPOINT_MODE.NOTE]: 'Note',
}

function statusMessage(status, currentCheckpoint, checkpointMode) {
  if (status === WFY_STATUS.NO_CHECKPOINTS) {
    return 'No checkpoints'
  }
  if (status === WFY_STATUS.COMPLETE) {
    return 'Section complete'
  }
  if (status === WFY_STATUS.WAITING && currentCheckpoint) {
    return checkpointMode === WFY_CHECKPOINT_MODE.NOTE ? 'Play the note' : ''
  }
  return 'Ready'
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
  checkpointMode,
  onCheckpointModeChange,
  currentCheckpoint,
  checkpointIndex,
  totalCheckpoints,
  inputSource,
  onInputSourceChange,
  midiAvailable,
  microphoneAvailable,
  inputMatchingActive,
  inputFeedback,
  matchSettings,
  rawMatchSettings,
  onMatchSettingChange,
  onResetMatchSettings,
  onPlayReference,
  referencePlaying,
  onMarkCorrect,
  onRestart,
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

  const showMicChordHint =
    checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    inputSource === WFY_INPUT_SOURCE.MICROPHONE &&
    currentCheckpoint?.isChord &&
    status === WFY_STATUS.WAITING
  const currentStatusMessage = statusMessage(
    status,
    currentCheckpoint,
    checkpointMode,
  )

  return (
    <section className={sectionClass} aria-label="Wait For You">
      <div className="wait-for-you__header">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--with-tip">
          Wait For You
          <PracticeHelpTip label="About Wait For You">
            Pauses at each checkpoint until you play or tap Continue.
          </PracticeHelpTip>
        </h3>
        {status === WFY_STATUS.WAITING && (
          <span className="wait-for-you__badge wait-for-you__badge--pulse" role="status">
            Your turn
          </span>
        )}
      </div>

      <WaitForYouInputSourceSelector
        checkpointMode={checkpointMode}
        inputSource={inputSource}
        onInputSourceChange={onInputSourceChange}
        midiAvailable={midiAvailable}
        microphoneAvailable={microphoneAvailable}
        disabled={status === WFY_STATUS.COMPLETE || status === WFY_STATUS.NO_CHECKPOINTS}
      />

      <div className="wait-for-you__checkpoint-mode" role="radiogroup" aria-label="Checkpoint type">
        <span className="wait-for-you__checkpoint-mode-label">Step by</span>
        {Object.values(WFY_CHECKPOINT_MODE).map((mode) => (
          <label key={mode} className="wait-for-you__checkpoint-mode-option">
            <input
              type="radio"
              name="wfy-checkpoint-mode"
              checked={checkpointMode === mode}
              onChange={() => onCheckpointModeChange(mode)}
            />
            <span>{CHECKPOINT_LABELS[mode]}</span>
          </label>
        ))}
      </div>

      {showMatchSettings && matchSettings && (
        <WaitForYouMatchSettingsPanel
          checkpointMode={checkpointMode}
          settings={matchSettings}
          rawSettings={rawMatchSettings}
          onUpdateSetting={onMatchSettingChange}
          onResetSettings={onResetMatchSettings}
          disabled={status === WFY_STATUS.COMPLETE || status === WFY_STATUS.NO_CHECKPOINTS}
        />
      )}

      {currentStatusMessage && (
        <p className={`wait-for-you__status wait-for-you__status--${status}`}>
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

      {inputMatchingActive && (
        <p className="wait-for-you__listening">
          {inputSource === WFY_INPUT_SOURCE.MICROPHONE
            ? 'Mic listening'
            : 'MIDI listening'}
        </p>
      )}

      {showMicChordHint && (
        <p className="wait-for-you__mic-chord-hint" role="status">
          Mic hears one chord tone at a time. Use Continue if needed.
        </p>
      )}

      {checkpointMode === WFY_CHECKPOINT_MODE.NOTE && status === WFY_STATUS.WAITING && (
        <p className="wait-for-you__note-target-status" role="status">
          {noteTargetWrongPage && noteTarget?.visible ? (
            <>Note marker: page {noteTarget.page}</>
          ) : noteTarget?.visible ? (
            <>Note marker ready{noteTarget.confidence != null && noteTarget.confidence < 0.7 ? ' · approximate' : ''}</>
          ) : (
            <>Open Setup to show the note marker.</>
          )}
        </p>
      )}

      {showNoteFeedback && (
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
              <span className="wait-for-you__now-notes-label">Play</span>
              <span className="wait-for-you__note-chips">
                {getExpectedMidis(currentCheckpoint).map((midi) => (
                  <span key={midi} className="wait-for-you__note-chip">
                    {midiToNoteLabel(midi)}
                  </span>
                ))}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="wait-for-you__actions">
        {checkpointMode === WFY_CHECKPOINT_MODE.NOTE && currentCheckpoint && (
          <button
            type="button"
            className="wait-for-you__btn"
            disabled={
              referencePlaying ||
              status === WFY_STATUS.COMPLETE ||
              status === WFY_STATUS.NO_CHECKPOINTS ||
              getExpectedMidis(currentCheckpoint).length === 0
            }
            onClick={() => onPlayReference(currentCheckpoint)}
          >
            {referencePlaying ? 'Playing…' : 'Hear it'}
          </button>
        )}
        <button
          type="button"
          className="wait-for-you__btn wait-for-you__btn--primary"
          disabled={status === WFY_STATUS.COMPLETE || status === WFY_STATUS.NO_CHECKPOINTS}
          onClick={onMarkCorrect}
        >
          Continue
        </button>
        <button
          type="button"
          className="wait-for-you__btn"
          disabled={totalCheckpoints === 0}
          onClick={onRestart}
        >
          Restart
        </button>
      </div>
    </section>
  )
}
