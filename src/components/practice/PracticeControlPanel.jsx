import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import PracticeFilesSummary from './PracticeFilesSummary.jsx'
import PracticeImportNotices from './PracticeImportNotices.jsx'
import PracticeTransportTick from './PracticeTransportTick.jsx'
import PracticePositionTick from './PracticePositionTick.jsx'
import PracticeModeSection from './PracticeModeSection.jsx'
import PracticeLoopCompactSection from './PracticeLoopCompactSection.jsx'
import PracticeTracksCompactSection from './PracticeTracksCompactSection.jsx'
import { isWebMidiSupported } from '../../features/midi-input/parseMidiMessage.js'
import { isMicrophoneSupported } from '../../features/microphone-input/micEnvironment.js'
import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'
import MidiInputStatusPanel from './MidiInputStatusPanel.jsx'
import MicrophoneInputStatusPanel from './MicrophoneInputStatusPanel.jsx'
import WaitForYouSection from './WaitForYouSection.jsx'
import PracticeCollapsibleSection from './PracticeCollapsibleSection.jsx'
import PracticeSetupPanel from './PracticeSetupPanel.jsx'
import PracticeDiagnosticsPanel from './PracticeDiagnosticsPanel.jsx'
import PracticeEnvironmentNotices from './PracticeEnvironmentNotices.jsx'
import { buildDiagnosticsSummary, buildSetupSummary } from './practicePanelSummaries.js'

function buildFilesSummary({ pdfFileName, hasMusicXml, hasMidi }) {
  const parts = []
  if (pdfFileName) {
    parts.push('PDF')
  }
  if (hasMusicXml) {
    parts.push('Timing')
  }
  if (hasMidi) {
    parts.push('Sound')
  }
  if (parts.length === 0) {
    return 'Nothing loaded yet'
  }
  return parts.join(' · ')
}

export default function PracticeControlPanel({
  pdfFileName,
  session,
  scoreFollow,
  waitForYouNoteTarget = null,
}) {
  const setupSummary = buildSetupSummary(session, scoreFollow)
  const diagnosticsSummary = buildDiagnosticsSummary(session)

  const needsScoreFollowSetup =
    Boolean(session.timing.timingMap) &&
    (scoreFollow?.anchors?.length ?? 0) === 0 &&
    !scoreFollow?.alignmentMode &&
    !scoreFollow?.semiAutoPreview

  const openSetupByDefault = needsScoreFollowSetup && !session.isDemoPiece

  const filesReady = Boolean(pdfFileName && session.hasMusicXml)
  const filesSummary = buildFilesSummary({
    pdfFileName,
    hasMusicXml: session.hasMusicXml,
    hasMidi: session.hasMidi,
  })

  const importWarnings = [...(session.importReadiness?.warnings ?? [])]
  if (scoreFollow?.anchorStorageWarning) {
    importWarnings.push({
      id: 'anchor-storage',
      strength: 'mild',
      message: scoreFollow.anchorStorageWarning,
    })
  }

  const filesBlock = (
    <PracticeFilesSummary
      pdfFileName={pdfFileName}
      hasMidi={session.hasMidi}
      hasMusicXml={session.hasMusicXml}
      playbackFileName={session.sources.playbackFileName}
      timingFileName={session.sources.timingFileName}
      timingError={session.timing.error}
      timingLoading={session.timing.isLoading}
    />
  )

  return (
    <aside className="practice-control-panel" aria-label="Practice controls">
      {filesReady ? (
        <PracticeCollapsibleSection
          title="Your files"
          summary={filesSummary}
          defaultOpen={false}
        >
          {filesBlock}
        </PracticeCollapsibleSection>
      ) : (
        filesBlock
      )}

      <PracticeImportNotices
        warnings={importWarnings}
        guidance={session.importReadiness?.guidance ?? []}
        maxGuidance={3}
      />

      <PracticeEnvironmentNotices />

      <div className="practice-control-panel__primary practice-control-panel__primary--focus">
        <PracticeTransportTick />

        <PracticePositionTick />

        <PracticeModeSection
          practiceMode={session.practiceMode}
          onPracticeModeChange={session.setPracticeMode}
          disabled={session.timingDisabled}
          hasMusicXml={session.hasMusicXml}
          compact
        />

        <PracticeLoopCompactSection session={session} />

        <PracticeTracksCompactSection session={session} />
      </div>

      {session.isWaitForYou &&
        session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
        session.wfyInputSource === WFY_INPUT_SOURCE.MIDI && (
          <MidiInputStatusPanel
            support={session.webMidi.support}
            permission={session.webMidi.permission}
            devices={session.webMidi.devices}
            lastNote={session.webMidi.lastNote}
            errorMessage={session.webMidi.errorMessage}
            isGranted={session.webMidi.isGranted}
            onRequestAccess={session.webMidi.requestAccess}
            onRefreshDevices={session.webMidi.refreshDevices}
            listenHint={
              session.waitForYouInput.matchingEnabled
                ? 'Listening for your playing in Wait For You.'
                : 'Enable MIDI to play along in Wait For You.'
            }
            compact
          />
        )}

      {session.isWaitForYou &&
        session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
        session.wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE && (
          <MicrophoneInputStatusPanel
            support={session.microphone.support}
            permission={session.microphone.permission}
            errorMessage={session.microphone.errorMessage}
            isGranted={session.microphone.isGranted}
            isListening={session.microphone.isListening}
            lastHeardMidi={session.waitForYouMic.lastHeardMidi}
            liveFrame={session.waitForYouMic.liveFrame}
            calibration={session.waitForYouMic.calibration}
            inputFeedback={session.waitForYouMic.inputFeedback}
            isChordCheckpoint={session.waitForYouMic.isChordCheckpoint}
            chordMicMode={session.waitForYouMic.chordMicMode}
            onRequestAccess={session.microphone.requestAccess}
            onDisable={session.microphone.disable}
            compact
          />
        )}

      <WaitForYouSection
        active={session.waitForYou.active}
        status={session.waitForYou.status}
        checkpointMode={session.checkpointMode}
        noteTarget={waitForYouNoteTarget?.target ?? null}
        noteTargetWrongPage={waitForYouNoteTarget?.wrongPage ?? false}
        onCheckpointModeChange={session.setCheckpointMode}
        currentCheckpoint={session.waitForYou.currentCheckpoint}
        checkpointIndex={session.waitForYou.checkpointIndex}
        totalCheckpoints={session.waitForYou.totalCheckpoints}
        inputSource={session.wfyInputSource}
        onInputSourceChange={session.setWfyInputSource}
        midiAvailable={isWebMidiSupported()}
        microphoneAvailable={isMicrophoneSupported()}
        inputMatchingActive={session.waitForYouInput.matchingEnabled}
        inputFeedback={session.waitForYouInput.inputFeedback}
        onMarkCorrect={session.waitForYou.markCorrectAndContinue}
        onRestart={session.waitForYou.restart}
        onPlayReference={session.referencePlayback.playCheckpointReference}
        referencePlaying={session.referencePlayback.isPlaying}
        showMatchSettings={false}
        compact
      />

      <div className="practice-control-panel__footer">
        <p className="practice-shortcuts-hint" aria-label="Keyboard shortcuts">
          <span className="practice-shortcuts-hint__touch">Use the on-screen controls on touch devices.</span>
          <span className="practice-shortcuts-hint__keys">
            <kbd>Space</kbd> play · <kbd>Enter</kbd> continue · <kbd>←</kbd>
            <kbd>→</kbd> pages · <kbd>F</kbd> fullscreen
          </span>
        </p>

        <PracticeCollapsibleSection
          title="Setup"
          summary={setupSummary}
          defaultOpen={openSetupByDefault}
          onOpenChange={scoreFollow?.setSetupPanelOpen}
        >
          <PracticeSetupPanel
            session={session}
            scoreFollow={scoreFollow}
            isDemoPiece={session.isDemoPiece}
          />
        </PracticeCollapsibleSection>

        <PracticeCollapsibleSection
          title="Technical details"
          summary={diagnosticsSummary}
          defaultOpen={false}
        >
          <PracticeDiagnosticsPanel session={session} scoreFollow={scoreFollow} />
        </PracticeCollapsibleSection>
      </div>
    </aside>
  )
}
