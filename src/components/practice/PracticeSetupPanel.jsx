import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'
import WaitForYouMatchSettingsPanel from './WaitForYouMatchSettingsPanel.jsx'
import ScoreFollowControls from '../pdf/ScoreFollowControls.jsx'
import CalibrationDebugPanel from './CalibrationDebugPanel.jsx'
import ScoreFollowApproximateHint from './ScoreFollowApproximateHint.jsx'

export default function PracticeSetupPanel({ session, scoreFollow, pdfPageNumber = 1 }) {
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
            anchorCounts={scoreFollow.anchorCounts}
            followNeedsSetup={scoreFollow.followNeedsSetup}
            experimentalOmrPlayback={scoreFollow.experimentalOmrPlayback}
            embedded
            systemStartMode={scoreFollow.systemStartMode}
            systemStartMarkCount={scoreFollow.systemStartMarks?.length ?? 0}
            onEnterSystemStartMode={scoreFollow.enterSystemStartMode}
            onConfirmSystemStartMarks={scoreFollow.confirmSystemStartMarks}
            onUndoSystemStartMark={scoreFollow.undoLastSystemStartMark}
            onExitSystemStartMode={scoreFollow.exitSystemStartMode}
          />
        )}
      </section>

      <details className="practice-diagnostics__group" open={Boolean(scoreFollow?.calibrationDebugSnapshot)}>
        <summary>Calibration debug (beta)</summary>
        <div className="practice-diagnostics__group-body">
          <CalibrationDebugPanel
            snapshot={scoreFollow?.calibrationDebugSnapshot ?? null}
            pieceName={session.sources?.playbackFileName ?? null}
            anchors={scoreFollow?.anchors ?? []}
            showOverlay={scoreFollow?.showCalibrationOverlay}
            onShowOverlayChange={scoreFollow?.setShowCalibrationOverlay}
            onRotatePage={scoreFollow?.rotatePageView}
            onApplyAutoRotations={scoreFollow?.applyAutoPageRotations}
            visiblePageNumber={pdfPageNumber}
            setupPhase={scoreFollow?.setupStatus?.phase ?? null}
          />
        </div>
      </details>

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
