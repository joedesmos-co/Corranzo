import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import WaitForYouMatchSettingsPanel from './WaitForYouMatchSettingsPanel.jsx'
import ScoreFollowControls from '../pdf/ScoreFollowControls.jsx'
import ScoreFollowApproximateHint from './ScoreFollowApproximateHint.jsx'

export default function PracticeSetupPanel({ session, scoreFollow }) {
  const measureBounds = session.measure?.bounds

  return (
    <div className="practice-setup">
      <section className="practice-section practice-section--setup" aria-label="Score follow setup">
        <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">
          Score follow
        </h3>
        <ScoreFollowApproximateHint label={scoreFollow?.followApproximateLabel} />
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
            onCancelAutoSetup={scoreFollow.cancelSemiAutoSetup}
            onResetSemiAutoSetup={scoreFollow.resetSemiAutoSetup}
            setupStatus={scoreFollow.setupStatus}
            semiAutoSetup={scoreFollow.semiAutoSetup}
            isSemiAutoAnalyzing={scoreFollow.isSemiAutoAnalyzing}
            followNeedsSetup={scoreFollow.followNeedsSetup}
            experimentalOmrPlayback={scoreFollow.experimentalOmrPlayback}
            embedded
            systemStartMode={scoreFollow.systemStartMode}
            systemStartMarkCount={scoreFollow.systemStartMarks?.length ?? 0}
            onEnterSystemStartMode={scoreFollow.enterSystemStartMode}
            onConfirmSystemStartMarks={scoreFollow.confirmSystemStartMarks}
            onUndoSystemStartMark={scoreFollow.undoLastSystemStartMark}
            onExitSystemStartMode={scoreFollow.exitSystemStartMode}
            showCursorToggle={false}
            allowSystemStartFallback
          />
        )}
      </section>

      {session.isWaitForYou && session.checkpointMode === WFY_CHECKPOINT_MODE.NOTE && (
        <section className="practice-section" aria-label="Note matching options">
          <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">
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
