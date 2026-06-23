import { memo } from 'react'
import { usePracticeSessionContextOptional } from '../../context/PracticeSessionContext.jsx'
import { useScoreFollowCursorOptional } from '../../context/PracticeTickContext.jsx'
import { WFY_CHECKPOINT_MODE } from '../../features/practice/waitForYouCheckpointMode.js'

export function usePracticeScoreFollowOverlayProps() {
  const practiceContext = usePracticeSessionContextOptional()
  const cursorState = useScoreFollowCursorOptional()
  const scoreFollow = practiceContext?.scoreFollow ?? null
  const practiceSession = practiceContext?.session ?? null

  if (!scoreFollow || !cursorState) {
    return null
  }

  const wfyNoteMode =
    practiceSession?.isWaitForYou &&
    practiceSession?.checkpointMode === WFY_CHECKPOINT_MODE.NOTE

  return {
    enabled: scoreFollow.enabled,
    alignmentMode: scoreFollow.alignmentMode,
    semiAutoPreview: scoreFollow.semiAutoPreview,
    showAnchorMarkers: scoreFollow.showAnchorMarkers,
    showSystemBands: scoreFollow.showSystemBands,
    pagePreviewSystems: scoreFollow.pagePreviewSystems,
    displayAnchors: scoreFollow.displayAnchors,
    placementMeasureNumber: scoreFollow.placementMeasureNumber,
    cursor: cursorState.displayCursor,
    cursorVisibility: cursorState.cursorVisibility,
    noteTarget: cursorState.noteTarget,
    showNoteTarget: cursorState.showNoteTarget,
    anchors: scoreFollow.anchors,
    placeAnchorAt: scoreFollow.placeAnchorAt,
    // System-start fallback mode
    systemStartMode: scoreFollow.systemStartMode,
    systemStartMarks: scoreFollow.systemStartMarks,
    addSystemStartMark: scoreFollow.addSystemStartMark,
    showSystemStartMarkers: scoreFollow.showSystemStartMarkers,
    // Phase 4 (flag-gated, debug-only) candidate-anchor overlay. null/false
    // unless the flag is on AND the user opted into the debug overlay.
    candidateAnchors: scoreFollow.nextGenCandidateAnchors ?? null,
    showCandidateAnchors: Boolean(scoreFollow.showNextGenCandidates),
  }
}

function PracticePdfCursorLayer({ children }) {
  const scoreFollowProps = usePracticeScoreFollowOverlayProps()
  return children(scoreFollowProps)
}

export default memo(PracticePdfCursorLayer)
