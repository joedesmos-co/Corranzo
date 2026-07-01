import { lazy, Suspense } from 'react'
import PracticeStatusBar from './PracticeStatusBar.jsx'
import AlignmentDiagnosticsSection from './AlignmentDiagnosticsSection.jsx'
import CalibrationDebugPanel from './CalibrationDebugPanel.jsx'

const SmokeTestChecklist = import.meta.env.DEV
  ? lazy(() => import('../../dev/SmokeTestChecklist.jsx'))
  : null

export default function PracticeDiagnosticsPanel({
  session,
  scoreFollow,
  pieceName = null,
  pdfPageNumber = 1,
}) {
  const { hasMidi, hasMusicXml } = session
  const alignment = session.alignment.diagnostics

  return (
    <div className="practice-diagnostics">
      <PracticeStatusBar
        pdfFileName={null}
        hasMidi={hasMidi}
        hasMusicXml={hasMusicXml}
        playbackFileName={session.sources.playbackFileName}
        timingFileName={session.sources.timingFileName}
        alignmentDiagnostics={alignment}
        isAlignmentLoading={session.alignment.isLoading}
        showPdf={false}
        showAlignment
      />

      <details className="practice-diagnostics__group">
        <summary>Timing &amp; position</summary>
        <div className="practice-diagnostics__group-body">
          <dl className="practice-diagnostics__kv">
            <div>
              <dt>Practice time</dt>
              <dd>{session.clock.practiceTime.toFixed(2)}s</dd>
            </div>
            <div>
              <dt>Measures</dt>
              <dd>{session.timing.timingMap?.measures?.length ?? '—'}</dd>
            </div>
            <div>
              <dt>Notes in map</dt>
              <dd>{session.timing.timingMap?.notes?.length ?? '—'}</dd>
            </div>
            <div>
              <dt>Following MIDI clock</dt>
              <dd>{session.clock.isFollowingMidi ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
          {session.timing.error && (
            <p className="practice-section__error">{session.timing.error}</p>
          )}
        </div>
      </details>

      {hasMidi && hasMusicXml && (
        <details className="practice-diagnostics__group">
          <summary>Playback vs timing file</summary>
          <div className="practice-diagnostics__group-body">
            <AlignmentDiagnosticsSection
              diagnostics={alignment}
              isLoading={session.alignment.isLoading}
              error={session.alignment.error}
            />
          </div>
        </details>
      )}

      {scoreFollow?.debug && (
        <details className="practice-diagnostics__group">
          <summary>Score cursor</summary>
          <div className="practice-diagnostics__group-body">
            <dl className="practice-diagnostics__kv">
              <div>
                <dt>Measure on cursor</dt>
                <dd>{scoreFollow.debug.currentMeasureNumber ?? '—'}</dd>
              </div>
              <div>
                <dt>Cursor page</dt>
                <dd>{scoreFollow.debug.cursorPage ?? '—'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{scoreFollow.debug.hideReasonLabel || 'Visible'}</dd>
              </div>
              <div>
                <dt>Anchors</dt>
                <dd>{scoreFollow.debug.anchorCount ?? 0}</dd>
              </div>
            </dl>

            {scoreFollow.nextGenDiagnostics?.available && (
              <AlignmentDiagnosticsSection
                diagnostics={null}
                nextGen={scoreFollow.nextGenDiagnostics}
                showCandidates={scoreFollow.showNextGenCandidates}
                onToggleCandidates={scoreFollow.setShowNextGenCandidates}
                anchorSource={scoreFollow.anchorSource}
                promotion={scoreFollow.anchorPromotion}
              />
            )}
          </div>
        </details>
      )}

      <details className="practice-diagnostics__group">
        <summary>Calibration debug (beta)</summary>
        <div className="practice-diagnostics__group-body">
          <CalibrationDebugPanel
            snapshot={scoreFollow?.calibrationDebugSnapshot ?? null}
            pieceName={pieceName ?? session.sources?.playbackFileName ?? null}
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

      {import.meta.env.DEV && SmokeTestChecklist && (
        <Suspense fallback={null}>
          <SmokeTestChecklist />
        </Suspense>
      )}
    </div>
  )
}
