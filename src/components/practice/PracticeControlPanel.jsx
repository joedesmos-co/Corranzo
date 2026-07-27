import { memo } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import PracticeFilesSummary from './PracticeFilesSummary.jsx'
import PracticeImportNotices from './PracticeImportNotices.jsx'
import PracticeTransportTick from './PracticeTransportTick.jsx'
import PracticePositionTick from './PracticePositionTick.jsx'
import PracticeModeSection from './PracticeModeSection.jsx'
import PracticeScopeSection from './PracticeScopeSection.jsx'
import PracticeLoopCompactSection from './PracticeLoopCompactSection.jsx'
import PracticeTracksCompactSection from './PracticeTracksCompactSection.jsx'
import { isWebMidiSupported } from '../../features/midi-input/parseMidiMessage.js'
import { isMicrophoneSupported } from '../../features/microphone-input/micEnvironment.js'
import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'
import MidiInputStatusPanel from './MidiInputStatusPanel.jsx'
import MidiDiagnosticsPanel from './MidiDiagnosticsPanel.jsx'
import MicrophoneInputStatusPanel from './MicrophoneInputStatusPanel.jsx'
import WaitForYouSection from './WaitForYouSection.jsx'
import WaitForYouInputSourceModal from './WaitForYouInputSourceModal.jsx'
import WaitForYouInputSourceSelector from './WaitForYouInputSourceSelector.jsx'
import PracticeCollapsibleSection from './PracticeCollapsibleSection.jsx'
import PracticeSetupPanel from './PracticeSetupPanel.jsx'
import PracticeDiagnosticsPanel from './PracticeDiagnosticsPanel.jsx'
import PracticeEnvironmentNotices from './PracticeEnvironmentNotices.jsx'
import PracticeStatusStrip from './PracticeStatusStrip.jsx'
import PracticeStatsCard from './PracticeStatsCard.jsx'
import PracticeMetronomeAdvancedSettings from './PracticeMetronomeAdvancedSettings.jsx'
import PracticeScoreCursorSection from './PracticeScoreCursorSection.jsx'
import { buildDiagnosticsSummary } from './practicePanelSummaries.js'

export default memo(function PracticeControlPanel({
  pdfFileName,
  pdfPageNumber = 1,
  waitForYouNoteTarget = null,
}) {
  const { session, scoreFollow, practicePiece, practiceStats } = usePracticeSessionContext()
  const diagnosticsSummary = buildDiagnosticsSummary(session)

  // Only auto-expand Advanced when cursor setup actually failed — not for the
  // normal “preparing / ready” path after a PDF upload.
  const openSetupByDefault =
    !session.isDemoPiece && scoreFollow?.setupStatus?.phase === 'failed'

  const filesReady = Boolean(pdfFileName && session.hasMusicXml)
  const omrWaitForYouDisabled =
    Boolean(scoreFollow?.experimentalOmrPlayback) && !scoreFollow?.canFollow
  const midiWaitForYouActive =
    session.isWaitForYou &&
    session.wfyInputSourceReady &&
    session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    session.wfyInputSource === WFY_INPUT_SOURCE.MIDI
  const micWaitForYouActive =
    session.isWaitForYou &&
    session.wfyInputSourceReady &&
    session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE &&
    session.wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE

  const importWarnings = [...(session.importReadiness?.warnings ?? [])]
  if (scoreFollow?.anchorStorageWarning) {
    importWarnings.push({
      id: 'anchor-storage',
      strength: 'mild',
      message: scoreFollow.anchorStorageWarning,
    })
  }

  const pieceTitle =
    practicePiece?.title ||
    (pdfFileName ? String(pdfFileName).replace(/\.[^.]+$/, '') : null)

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
      <WaitForYouInputSourceModal
        open={session.showWfyInputSourceModal}
        onChooseSource={session.setWfyInputSource}
        instrumentId={session.instrumentId}
        midiAvailable={isWebMidiSupported()}
        microphoneAvailable={isMicrophoneSupported()}
      />

      <div className="practice-control-panel__primary practice-control-panel__primary--focus">
        {pieceTitle ? (
          <header className="practice-piece-header" data-tour-id="practice-piece">
            <h2 className="practice-piece-header__title">{pieceTitle}</h2>
          </header>
        ) : null}

        <PracticeTransportTick />

        <PracticeModeSection
          practiceMode={session.practiceMode}
          onPracticeModeChange={session.setPracticeMode}
          disabled={session.timingDisabled}
          hasMusicXml={session.hasMusicXml}
          waitForYouDisabled={omrWaitForYouDisabled}
          waitForYouDisabledReason={
            omrWaitForYouDisabled
              ? 'Set up the score cursor in Advanced first.'
              : ''
          }
          compact
        />

        <PracticeScopeSection
          visible={session.practiceScopeAvailable}
          practiceScope={session.rawPracticeScope}
          onPracticeScopeChange={session.setPracticeScope}
          disabled={session.timingDisabled}
          compact
        />

        {session.wfyInputSourceReady && (
          <WaitForYouInputSourceSelector
            inputSource={session.wfyInputSource}
            onInputSourceChange={session.setWfyInputSource}
            instrumentId={session.instrumentId}
            midiAvailable={isWebMidiSupported()}
            microphoneAvailable={isMicrophoneSupported()}
          />
        )}

        <WaitForYouSection
          active={session.waitForYou.active}
          status={session.waitForYou.status}
          displayStatus={session.waitForYou.displayStatus}
          displayLabel={session.waitForYou.displayLabel}
          checkpointMode={session.checkpointMode}
          noteTarget={waitForYouNoteTarget?.target ?? null}
          noteTargetWrongPage={waitForYouNoteTarget?.wrongPage ?? false}
          currentCheckpoint={session.waitForYou.enrichedCheckpoint ?? session.waitForYou.currentCheckpoint}
          checkpointIndex={session.waitForYou.checkpointIndex}
          totalCheckpoints={session.waitForYou.totalCheckpoints}
          inputSource={
            session.wfyInputSourceReady ? session.wfyInputSource : WFY_INPUT_SOURCE.MANUAL
          }
          inputMatchingActive={session.waitForYouInput.matchingEnabled}
          inputFeedback={session.waitForYouInput.inputFeedback}
          guidance={session.waitForYou.guidance}
          onMarkCorrect={session.waitForYou.markCorrectAndContinue}
          onSkip={session.waitForYou.skipCheckpoint}
          onShowHint={session.waitForYou.showHint}
          onRestart={session.waitForYou.restart}
          onPlayReference={session.referencePlayback.playCheckpointReference}
          referencePlaying={session.referencePlayback.isPlaying}
          referenceError={session.referencePlayback.error}
          micListening={session.microphone.isListening}
          micPermission={session.microphone.permission}
          micStatusLabel={session.waitForYouMic.micStatusLabel}
          micCalibrating={session.waitForYouMic.micCalibrating}
          onRequestMicAccess={session.microphone.requestAccess}
          showMatchSettings={false}
          compact
        />

        <PracticeScoreCursorSection
          scoreFollow={scoreFollow}
          disabled={session.timingDisabled}
        />
      </div>

      <PracticeLoopCompactSection session={session} />

      <PracticeStatusStrip session={session} scoreFollow={scoreFollow} />

      {practicePiece?.id && (
        <PracticeCollapsibleSection
          title="Session stats"
          summary="Saved locally"
          ariaLabel="Practice stats"
        >
          <PracticeStatsCard
            pieceId={practicePiece.id}
            liveSession={practiceStats?.liveSession ?? null}
            compact
            showHeader={false}
          />
        </PracticeCollapsibleSection>
      )}

      <div className="practice-control-panel__footer">
        <PracticeCollapsibleSection
          title="Advanced"
          summary="Files, playback, cursor"
          defaultOpen={openSetupByDefault}
          dataTourId="practice-advanced"
        >
          <div className="practice-more">
            <section className="practice-more__group" aria-label="Files">
              <h4 className="practice-more__group-title">Files</h4>
              {filesReady ? filesBlock : null}
              <PracticeImportNotices
                warnings={importWarnings}
                guidance={session.importReadiness?.guidance ?? []}
                maxGuidance={2}
              />
            </section>

            <section className="practice-more__group" aria-label="Playback options">
              <h4 className="practice-more__group-title">Playback</h4>
              <PracticeMetronomeAdvancedSettings />
              <PracticeTracksCompactSection session={session} />
              <PracticePositionTick collapsible />
            </section>

            <section className="practice-more__group" aria-label="Score cursor">
              <h4 className="practice-more__group-title">Score cursor</h4>
              <PracticeEnvironmentNotices />
              <PracticeSetupPanel
                session={session}
                scoreFollow={scoreFollow}
              />
              {midiWaitForYouActive && (
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
                      ? 'Listening for your notes'
                      : 'Enable MIDI to match notes automatically.'
                  }
                  compact
                />
              )}
              {micWaitForYouActive && (
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
                  onRetryCalibration={session.waitForYouMic.retryCalibration}
                  onExportDebugFrames={session.waitForYouMic.exportDebugFrames}
                  onExportMicTrace={session.waitForYouMic.exportMicTrace}
                  compact
                />
              )}
              {session.webMidi.isGranted && midiWaitForYouActive && (
                <MidiDiagnosticsPanel
                  statusLabel={session.webMidi.statusLabel}
                  latencyMs={session.webMidi.latencyMs}
                  noteCount={session.webMidi.noteCount}
                  sustain={session.webMidi.sustain}
                  activeNotes={session.webMidi.activeNotes}
                  lastNote={session.webMidi.lastNote}
                />
              )}
            </section>

            <section className="practice-more__group" aria-label="Help">
              <h4 className="practice-more__group-title">Help</h4>
              <details className="practice-shortcuts">
                <summary className="practice-shortcuts__summary">Keyboard shortcuts</summary>
                <p className="practice-shortcuts-hint" aria-label="Keyboard shortcuts">
                  <kbd>Space</kbd> play · <kbd>Enter</kbd> continue · <kbd>←</kbd>
                  <kbd>→</kbd> pages · <kbd>F</kbd> fullscreen
                </p>
              </details>
              <PracticeCollapsibleSection
                title="Diagnostics"
                summary={diagnosticsSummary}
                defaultOpen={false}
              >
                <PracticeDiagnosticsPanel
                  session={session}
                  scoreFollow={scoreFollow}
                  pieceName={pdfFileName}
                  pdfPageNumber={pdfPageNumber}
                />
              </PracticeCollapsibleSection>
            </section>
          </div>
        </PracticeCollapsibleSection>

        {!filesReady && filesBlock}
      </div>
    </aside>
  )
})
