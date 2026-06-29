import {
  SCORE_FOLLOW_OMR_PLAYBACK_READY,
  SCORE_FOLLOW_OMR_SETUP_FAILED,
  SCORE_FOLLOW_OMR_SETUP_RUNNING,
} from '../../features/score-follow/scoreFollowUserMessages.js'
import { INSTRUMENT_STATUS } from '../../features/playback/pianoInstrumentStatus.js'
import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'

function StatusChip({ label, tone = 'neutral' }) {
  return (
    <span className={`practice-status-chip practice-status-chip--${tone}`}>
      {label}
    </span>
  )
}

function soundStatus(playback) {
  if (playback.error) {
    return { label: 'Sound issue', tone: 'warning' }
  }
  if (playback.instrumentStatus === INSTRUMENT_STATUS.SAMPLED) {
    return { label: 'Piano ready', tone: 'ready' }
  }
  if (playback.instrumentStatus === INSTRUMENT_STATUS.SYNTH) {
    return { label: 'Synth fallback', tone: 'neutral' }
  }
  return { label: 'Piano loading', tone: 'neutral' }
}

function followStatus(session, scoreFollow) {
  if (!session.hasMusicXml) {
    return { label: 'Timing missing', tone: 'warning' }
  }

  if (scoreFollow?.experimentalOmrPlayback) {
    if (scoreFollow?.setupStatus?.phase === 'running') {
      return { label: SCORE_FOLLOW_OMR_SETUP_RUNNING, tone: 'neutral' }
    }
    if (scoreFollow?.setupStatus?.phase === 'failed') {
      return { label: SCORE_FOLLOW_OMR_SETUP_FAILED, tone: 'warning' }
    }
    if (scoreFollow?.canFollow && scoreFollow?.enabled) {
      return { label: 'Following score', tone: 'ready' }
    }
    if (
      scoreFollow?.setupStatus?.message === SCORE_FOLLOW_OMR_PLAYBACK_READY ||
      (scoreFollow?.followNeedsSetup && !scoreFollow?.hasAnchors)
    ) {
      return { label: SCORE_FOLLOW_OMR_PLAYBACK_READY, tone: 'ready' }
    }
  }

  if (scoreFollow?.setupStatus?.phase === 'running') {
    return { label: 'Setting up score', tone: 'neutral' }
  }
  if (scoreFollow?.followNeedsSetup || !scoreFollow?.hasAnchors) {
    return { label: 'Needs setup', tone: 'warning' }
  }
  if (!scoreFollow?.enabled) {
    return { label: 'Following off', tone: 'neutral' }
  }
  return { label: 'Following score', tone: 'ready' }
}

function inputStatus(session) {
  if (
    !session.isWaitForYou ||
    session.checkpointMode !== WFY_CHECKPOINT_MODE.NOTE
  ) {
    return null
  }

  if (session.wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE) {
    if (session.microphone.isListening) {
      return { label: 'Mic listening', tone: 'ready' }
    }
    if (session.microphone.isGranted) {
      return { label: 'Mic ready', tone: 'ready' }
    }
    return { label: 'Mic off', tone: 'neutral' }
  }

  if (session.wfyInputSource === WFY_INPUT_SOURCE.MIDI) {
    if (session.webMidi.isGranted && session.webMidi.devices.length > 0) {
      return { label: 'MIDI ready', tone: 'ready' }
    }
    if (session.webMidi.isGranted) {
      return { label: 'MIDI disconnected', tone: 'warning' }
    }
    return { label: 'MIDI off', tone: 'neutral' }
  }

  return { label: 'Manual input', tone: 'neutral' }
}

export default function PracticeStatusStrip({ session, scoreFollow }) {
  const statuses = [
    soundStatus(session.playback),
    followStatus(session, scoreFollow),
    inputStatus(session),
  ].filter(Boolean)

  return (
    <div className="practice-status-strip" aria-label="Practice status">
      {statuses.map((status) => (
        <StatusChip key={status.label} {...status} />
      ))}
    </div>
  )
}
