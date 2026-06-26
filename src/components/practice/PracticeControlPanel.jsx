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
import MidiDiagnosticsPanel from './MidiDiagnosticsPanel.jsx'
import MicrophoneInputStatusPanel from './MicrophoneInputStatusPanel.jsx'
import WaitForYouSection from './WaitForYouSection.jsx'
import PracticeCollapsibleSection from './PracticeCollapsibleSection.jsx'
import PracticeSetupPanel from './PracticeSetupPanel.jsx'
import PracticeDiagnosticsPanel from './PracticeDiagnosticsPanel.jsx'
import PracticeEnvironmentNotices from './PracticeEnvironmentNotices.jsx'
import PracticeStatusStrip from './PracticeStatusStrip.jsx'
import { buildDiagnosticsSummary, buildSetupSummary } from './practicePanelSummaries.js'

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

  const importWarnings = [...(session.importReadiness?.warnings ?? [])]
  if (scoreFollow?.anchorStorageWarning) {
    importWarnings.push({
      id: 'anchor-storage',
      strength: 'mild',
      message: scoreFollow.anchorStorageWarning,
    })
  }
  const visibleWarnings = importWarnings.filter(
    (warning) => warning.strength === 'strong',
  )
  const detailWarnings = importWarnings.filter(
    (warning) => warning.strength !== 'strong',
  )

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
      <PracticeStatusStrip session={session} scoreFollow={scoreFollow} />

      <PracticeImportNotices
        warnings={visibleWarnings}
        guidance={[]}
      />

      <div className="practice-control-panel__primary practice-control-panel__primary--focus">
        <PracticeTransportTick />

        <PracticeModeSection
          practiceMode={session.practiceMode}
          onPracticeModeChange={session.setPracticeMode}
          disabled={session.timingDisabled}
          hasMusicXml={session.hasMusicXml}
          compact
        />

        <PracticeLoopCompactSection session={session} />

        <PracticePositionTick collapsible />
      </div>

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
        guidance={session.waitForYou.guidance}
        onMarkCorrect={session.waitForYou.markCorrectAndContinue}
        onSkip={session.waitForYou.skipCheckpoint}
        onShowHint={session.waitForYou.showHint}
        onRestart={session.waitForYou.restart}
        onPlayReference={session.referencePlayback.playCheckpointReference}
        referencePlaying={session.referencePlayback.isPlaying}
        showMatchSettings={false}
        compact
      />

      {session.isWaitForYou &&
        session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
        session.wfyInputSource === WFY_INPUT_SOURCE.MIDI && (
          <>
            <MidiInputStatusPanel
              support={session.webMidi.support}
              permission={session.webMidi.permission}
              devices={session.webMidi.devices}
              lastNote={session.webMidi.lastNote}
              errorMessage={session.webMidi.errorMessage}
              isGranted={session.webMidi.isGranted}
              deviceStatusLabel={session.webMidi.statusLabel}
              activeDeviceId={session.webMidi.activeDeviceId}
              onSelectDevice={session.webMidi.selectDevice}
              onRequestAccess={session.webMidi.requestAccess}
              onRefreshDevices={session.webMidi.refreshDevices}
              listenHint={
                session.waitForYouInput.matchingEnabled
                  ? 'Listening'
                  : 'Enable MIDI to continue automatically.'
              }
              compact
            />
            {session.webMidi.isGranted && (
              <MidiDiagnosticsPanel
                statusLabel={session.webMidi.statusLabel}
                latencyMs={session.webMidi.latencyMs}
                noteCount={session.webMidi.noteCount}
                sustain={session.webMidi.sustain}
                activeNotes={session.webMidi.activeNotes}
                lastNote={session.webMidi.lastNote}
              />
            )}
          </>
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

      <div className="practice-control-panel__footer">
        <PracticeCollapsibleSection
          title="More"
          summary="Files, tracks & shortcuts"
          defaultOpen={false}
        >
          <div className="practice-more">
            {filesReady ? filesBlock : null}
            <PracticeImportNotices
              warnings={detailWarnings}
              guidance={session.importReadiness?.guidance ?? []}
              maxGuidance={2}
            />
            <PracticeEnvironmentNotices />
            <PracticeTracksCompactSection session={session} />
            <p className="practice-shortcuts-hint" aria-label="Keyboard shortcuts">
              <kbd>Space</kbd> play · <kbd>Enter</kbd> continue · <kbd>←</kbd>
              <kbd>→</kbd> pages · <kbd>F</kbd> fullscreen
            </p>
            <PracticeCollapsibleSection
              title="Advanced"
              summary={diagnosticsSummary}
              defaultOpen={false}
            >
              <PracticeDiagnosticsPanel
                session={session}
                scoreFollow={scoreFollow}
                pieceName={pdfFileName}
              />
            </PracticeCollapsibleSection>
          </div>
        </PracticeCollapsibleSection>

        {!filesReady && filesBlock}

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

      </div>
    </aside>
  )
}
