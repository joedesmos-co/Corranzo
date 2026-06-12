import { WFY_STATUS } from '../../features/practice/waitForYouEngine.js'
import {
  WFY_CHECKPOINT_MODE,
  WFY_CHECKPOINT_MODE_LABELS,
} from '../../features/practice/waitForYouCheckpointMode.js'
import { getExpectedMidis } from '../../features/practice/waitForYouNoteMatch.js'
import { WFY_INPUT_OUTCOME } from '../../features/practice/waitForYouInputFeedback.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'
import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'
import WaitForYouMatchSettingsPanel from './WaitForYouMatchSettingsPanel.jsx'
import WaitForYouInputSourceSelector from './WaitForYouInputSourceSelector.jsx'
import PracticeHelpTip from './PracticeHelpTip.jsx'

function statusMessage(status, currentCheckpoint, checkpointMode) {
  if (status === WFY_STATUS.NO_CHECKPOINTS) {
    return checkpointMode === WFY_CHECKPOINT_MODE.NOTE
      ? 'Nothing to play here yet — try another section or add timing data.'
      : 'Nothing to wait on here yet — try another section.'
  }
  if (status === WFY_STATUS.COMPLETE) {
    return 'Lovely work — you finished this section. Switch to Normal playback or start again.'
  }
  if (status === WFY_STATUS.WAITING && currentCheckpoint) {
    return 'Your turn — the app waits until you play the right note.'
  }
  return 'Getting ready…'
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

  return (
    <section className={sectionClass} aria-label="Wait For You">
      <div className="wait-for-you__header">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--with-tip">
          Wait For You
          <PracticeHelpTip label="About Wait For You">
            Playback waits at each checkpoint until you play the right notes (or tap continue).
            Great for slow practice — like a patient teacher who never rushes ahead.
          </PracticeHelpTip>
        </h3>
        {status === WFY_STATUS.WAITING && (
          <span className="wait-for-you__badge wait-for-you__badge--pulse" role="status">
            Your turn
          </span>
        )}
      </div>

      <p className="wait-for-you__explainer">
        The app waits until you play the right note, then continues — like a patient accompanist.
        <strong> Manual continue</strong> always works; MIDI and microphone are optional.
      </p>

      <WaitForYouInputSourceSelector
        checkpointMode={checkpointMode}
        inputSource={inputSource}
        onInputSourceChange={onInputSourceChange}
        midiAvailable={midiAvailable}
        microphoneAvailable={microphoneAvailable}
        disabled={status === WFY_STATUS.COMPLETE || status === WFY_STATUS.NO_CHECKPOINTS}
      />

      <div className="wait-for-you__checkpoint-mode" role="radiogroup" aria-label="Checkpoint type">
        <span className="wait-for-you__checkpoint-mode-label">Wait at each</span>
        {Object.values(WFY_CHECKPOINT_MODE).map((mode) => (
          <label key={mode} className="wait-for-you__checkpoint-mode-option">
            <input
              type="radio"
              name="wfy-checkpoint-mode"
              checked={checkpointMode === mode}
              onChange={() => onCheckpointModeChange(mode)}
            />
            <span>{WFY_CHECKPOINT_MODE_LABELS[mode]}</span>
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

      <p className={`wait-for-you__status wait-for-you__status--${status}`}>
        {statusMessage(status, currentCheckpoint, checkpointMode)}
      </p>

      {totalCheckpoints > 0 && (
        <div className="wait-for-you__progress-block">
          <div className="wait-for-you__progress-header">
            <span>Through this section</span>
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
            ? 'Listening via microphone…'
            : 'Listening for your playing…'}
        </p>
      )}

      {showMicChordHint && (
        <p className="wait-for-you__mic-chord-hint" role="status">
          Microphone chord spots are experimental — one pitch at a time, not full harmony. Use MIDI
          or &ldquo;I&apos;m ready — continue&rdquo; if notes are missed.
        </p>
      )}

      {checkpointMode === WFY_CHECKPOINT_MODE.NOTE && status === WFY_STATUS.WAITING && (
        <p className="wait-for-you__note-target-status" role="status">
          {noteTargetWrongPage && noteTarget?.visible ? (
            <>
              The amber <strong>Your note</strong> ring is on page {noteTarget.page} — switch pages
              to see it.
            </>
          ) : noteTarget?.visible ? (
            <>
              Look for the amber <strong>Your note</strong> ring on the score
              {noteTarget.confidence != null && noteTarget.confidence < 0.7
                ? ' — approximate position is normal'
                : ' — that is where to play'}
              . Tap <strong>I&apos;m ready — continue</strong> if it looks off.
            </>
          ) : (
            <>
              Open <strong>Setup</strong> below to link the PDF to your timing file — then the amber
              note ring can appear.
            </>
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
          I&apos;m ready — continue
        </button>
        <button
          type="button"
          className="wait-for-you__btn"
          disabled={totalCheckpoints === 0}
          onClick={onRestart}
        >
          Restart section
        </button>
      </div>

      <p className="wait-for-you__hint">
        {checkpointMode === WFY_CHECKPOINT_MODE.NOTE
          ? inputSource === WFY_INPUT_SOURCE.MANUAL
            ? 'Tap “I’m ready — continue” or press Enter when you have played the note.'
            : inputSource === WFY_INPUT_SOURCE.MICROPHONE
              ? 'Play the note shown. Microphone detection is approximate — use “I’m ready” if unsure.'
              : 'Play the notes shown, or tap “Hear it”. Press Enter or tap “I’m ready” to move on.'
          : 'The music pauses at each beat. Press Enter or tap “I’m ready” to continue.'}
      </p>
    </section>
  )
}
