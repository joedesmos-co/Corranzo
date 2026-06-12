import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import WaitForYouMatchSettingsPanel from './WaitForYouMatchSettingsPanel.jsx'
import ScoreFollowControls from '../pdf/ScoreFollowControls.jsx'
import PracticeHelpTip from './PracticeHelpTip.jsx'

export default function PracticeSetupPanel({ session, scoreFollow, isDemoPiece = false }) {
  const measureBounds = session.measure?.bounds

  return (
    <div className="practice-setup">
      <section className="practice-section practice-section--setup" aria-label="Score follow setup">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--with-tip">
          Score follow
          <PracticeHelpTip label="About score follow">
            Mark where each measure starts on your PDF. A moving cursor helps your eyes stay with
            the music during playback.
          </PracticeHelpTip>
        </h3>
        {isDemoPiece ? (
          <p className="score-follow-setup-intro" role="note">
            The sample piece uses a calibrated thin cursor. Uploaded scores need manual markers or
            MusicXML layout before a follow cursor appears.
          </p>
        ) : (
          <p className="score-follow-setup-intro" role="note">
            PDF auto-setup only finds staff systems — it does not place a precise cursor. Mark a few
            measures manually for an approximate line, or rely on Wait For You without score follow.
          </p>
        )}
        {scoreFollow?.followApproximateLabel ? (
          <p className="score-follow-setup-status score-follow-setup-status--hint" role="status">
            {scoreFollow.followApproximateLabel}
          </p>
        ) : null}
        <ol className="score-follow-setup-steps">
          <li>
            Load PDF + score timing (MusicXML/MXL). Auto-setup links staff systems only.
          </li>
          <li>
            Tap each <strong>staff system</strong> start on the PDF — layout data fills in measure
            positions when MusicXML is available.
          </li>
          <li>
            Use <strong>Fix / add markers manually</strong> to correct individual measures. Manual
            markers are never overwritten.
          </li>
        </ol>
        {scoreFollow && (
          <ScoreFollowControls
            hasPdf
            hasTiming={scoreFollow.hasTiming}
            enabled={scoreFollow.enabled}
            onEnabledChange={scoreFollow.setEnabled}
            alignmentMode={scoreFollow.alignmentMode}
            onAlignmentModeChange={scoreFollow.setAlignmentMode}
            placementMeasureNumber={scoreFollow.placementMeasureNumber}
            onPlacementMeasureNumberChange={scoreFollow.setPlacementMeasureNumber}
            measureBounds={measureBounds}
            anchors={scoreFollow.anchors}
            onDeleteAnchor={scoreFollow.deleteAnchor}
            onClearAnchors={scoreFollow.clearAnchors}
            onClearManualMarkers={scoreFollow.clearManualMarkers}
            onUndoLastMarker={scoreFollow.undoLastMarker}
            onAdvancePlacementMeasure={scoreFollow.advancePlacementMeasure}
            markingProgress={scoreFollow.markingProgress}
            canFollow={scoreFollow.canFollow}
            debug={scoreFollow.debug}
            onRetryAutoSetup={scoreFollow.retryAutoSetup}
            onResetSemiAutoSetup={scoreFollow.resetSemiAutoSetup}
            setupStatus={scoreFollow.setupStatus}
            semiAutoSetup={scoreFollow.semiAutoSetup}
            isSemiAutoAnalyzing={scoreFollow.isSemiAutoAnalyzing}
            anchorCounts={scoreFollow.anchorCounts}
            followNeedsSetup={scoreFollow.followNeedsSetup}
            embedded
          />
        )}
      </section>

      {session.isWaitForYou && session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE && (
        <section className="practice-section" aria-label="Note matching options">
          <h3 className="practice-section__title practice-section__title--static">
            Note matching options
          </h3>
          <WaitForYouMatchSettingsPanel
            checkpointMode={session.checkpointMode}
            settings={session.matchSettings}
            rawSettings={session.rawMatchSettings}
            onUpdateSetting={session.updateMatchSetting}
            onResetSettings={session.resetMatchSettings}
            disabled={false}
          />
        </section>
      )}
    </div>
  )
}
