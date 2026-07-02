import { useCallback, useEffect, useMemo, useRef } from 'react'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import { WFY_STATUS } from '../../features/practice/waitForYouEngine.js'
import {
  buildBarlineTimes,
  buildKeyboardKeys,
  buildVisualLaneGroups,
  computeKeyboardRange,
  resolveVisualTarget,
  selectVisualWindow,
} from '../../features/practice/visualPracticeLane.js'
import { detectStaves } from '../../features/practice/staffLaneLayout.js'
import StaffVisualLane from './StaffVisualLane.jsx'

/**
 * Beginner-friendly Visual practice mode: a scrolling staff lane (Simply
 * Piano-style) with a fixed playhead, the current target called out, and a
 * keyboard strip mirroring the target keys.
 *
 * Read-only view over the existing practice session — playback, the
 * practice clock, and Wait For You all keep working unchanged.
 */
export default function VisualPracticeView({ timingSourceKind = null }) {
  const { session } = usePracticeSessionContext()
  const tick = usePracticeTick()

  const timingMap = session.timing.timingMap
  const timingLoading = session.timing.isLoading
  // In Wait For You, use the same loop region useWaitForYou consumes so
  // group ids always match the live checkpoints. In normal playback only
  // honor the region while the loop is actually on — playback ignores a
  // set-but-disabled region, so the lane must too.
  const loopRegion =
    session.isWaitForYou || session.loop.enabled ? session.loop.region : null

  const groups = useMemo(
    () => buildVisualLaneGroups(timingMap, loopRegion),
    [timingMap, loopRegion],
  )
  const staves = useMemo(() => detectStaves(groups), [groups])
  // Keyboard shows a focused octave window (not the piece's full extremes).
  const keyboardRange = useMemo(() => computeKeyboardRange(groups), [groups])
  const barlineTimes = useMemo(() => buildBarlineTimes(timingMap), [timingMap])
  const timeSignature = useMemo(() => {
    const first = timingMap?.measures?.[0]
    return first?.beats && first?.beatType
      ? { beats: first.beats, beatType: first.beatType }
      : null
  }, [timingMap])

  const currentTime = tick.practiceTime ?? 0
  const isWaitForYou = session.isWaitForYou
  const wfyStatus = session.waitForYou.status
  const wfyCheckpoint = isWaitForYou ? session.waitForYou.currentCheckpoint : null

  const { index: targetIndex, group: targetGroup } = useMemo(
    () => resolveVisualTarget(groups, { currentTime, waitForYouCheckpoint: wfyCheckpoint }),
    [groups, currentTime, wfyCheckpoint],
  )

  // Window slides on whole seconds: statuses are index-driven, and the
  // look-ahead margin covers the coarseness, so the note layer's props stay
  // referentially stable between beats — scrolling itself is rAF-driven.
  const timeBucket = Math.floor(currentTime)
  const visibleGroups = useMemo(
    () => selectVisualWindow(groups, timeBucket, targetIndex),
    [groups, timeBucket, targetIndex],
  )

  // Per-frame time source for the lane scroll: the engine's wall-clock
  // interpolated score time while playing (same source as the score-follow
  // cursor), the practice clock otherwise (paused / Wait For You / scrub).
  const getScoreTime = session.playback.getScoreTime
  const frameStateRef = useRef({ isPlaying: false, practiceTime: 0 })
  useEffect(() => {
    frameStateRef.current = {
      isPlaying: tick.playbackIsPlaying,
      practiceTime: currentTime,
    }
  }, [tick.playbackIsPlaying, currentTime])
  const getFrameTime = useCallback(() => {
    const state = frameStateRef.current
    return state.isPlaying && getScoreTime ? getScoreTime() : state.practiceTime
  }, [getScoreTime])

  // Cheap enough to rebuild per tick (~a few octaves of keys); avoids
  // memoizing on a derived object the React Compiler cannot verify as stable.
  const keyboardKeys = buildKeyboardKeys(keyboardRange, targetGroup?.midis ?? [])

  if (!timingMap || !groups.length) {
    return (
      <div className="visual-practice visual-practice--empty" aria-label="Visual practice">
        <div className="visual-practice__empty">
          <h3>Visual mode needs note timing</h3>
          <p>
            {timingLoading
              ? 'Preparing note data…'
              : 'Add a MusicXML timing file (or open the demo piece) to see notes here. The Score view keeps working for PDF-only pieces.'}
          </p>
        </div>
      </div>
    )
  }

  const isOmrTiming = timingSourceKind === 'omr'
  const laneComplete = isWaitForYou && wfyStatus === WFY_STATUS.COMPLETE

  return (
    <div className="visual-practice" aria-label="Visual practice">
      {isOmrTiming && (
        <details className="visual-practice__omr-details">
          <summary>About this piece’s notes</summary>
          <p className="visual-practice__omr-note" role="note">
            Notes for this piece were read automatically from the PDF, so a few may be off —
            the Score view is the reliable reference.
          </p>
        </details>
      )}

      <VisualTargetHeader
        targetGroup={targetGroup}
        targetIndex={targetIndex}
        totalGroups={groups.length}
        isWaitForYou={isWaitForYou}
        waiting={isWaitForYou && wfyStatus === WFY_STATUS.WAITING}
        complete={laneComplete}
      />

      <StaffVisualLane
        visibleGroups={visibleGroups}
        staves={staves}
        getFrameTime={getFrameTime}
        barlineTimes={barlineTimes}
        timeSignature={timeSignature}
      />

      <VisualKeyboardStrip keys={keyboardKeys} />

      <div className="visual-practice__legend" aria-hidden="true">
        <span className="visual-practice__legend-item visual-practice__legend-item--played">
          Played
        </span>
        <span className="visual-practice__legend-item visual-practice__legend-item--now">
          Now
        </span>
        <span className="visual-practice__legend-item visual-practice__legend-item--upcoming">
          Upcoming
        </span>
      </div>
    </div>
  )
}

function VisualTargetHeader({
  targetGroup,
  targetIndex,
  totalGroups,
  isWaitForYou,
  waiting,
  complete,
}) {
  if (complete) {
    return (
      <div className="visual-practice__target visual-practice__target--complete">
        <span className="visual-practice__target-kicker">Wait For You</span>
        <strong className="visual-practice__target-notes">Nice — section complete</strong>
      </div>
    )
  }

  if (!targetGroup) {
    return (
      <div className="visual-practice__target">
        <span className="visual-practice__target-kicker">End of piece</span>
        <strong className="visual-practice__target-notes">All notes played</strong>
      </div>
    )
  }

  const position =
    targetGroup.beat != null
      ? `Measure ${targetGroup.measureNumber}, beat ${targetGroup.beat}`
      : `Measure ${targetGroup.measureNumber}`

  return (
    <div
      className={`visual-practice__target${
        waiting ? ' visual-practice__target--waiting' : ''
      }`}
    >
      <span className="visual-practice__target-kicker">
        {isWaitForYou ? 'Play this' : 'Next up'}
      </span>
      <strong className="visual-practice__target-notes">
        {targetGroup.notes.map((note) => note.label).join(' + ')}
        {targetGroup.isChord ? ' (together)' : ''}
      </strong>
      <span className="visual-practice__target-meta">
        {position} · {Math.min(targetIndex + 1, totalGroups)} of {totalGroups}
        {waiting ? ' · waiting for you' : ''}
      </span>
    </div>
  )
}

/**
 * Display-only keyboard segment highlighting the current target keys, with
 * floating letter chips above each target key (Simply Piano-style).
 */
function VisualKeyboardStrip({ keys }) {
  const whiteKeys = keys.filter((key) => !key.black)
  if (!whiteKeys.length) {
    return null
  }
  const whiteWidthPercent = 100 / whiteKeys.length

  // Position each black key between its neighbouring white keys, and give
  // every key a horizontal center for the target chips.
  const blackKeys = []
  const chips = []
  let whiteCount = 0
  for (const key of keys) {
    let centerPercent
    if (key.black) {
      const leftPercent = (whiteCount - 0.32) * whiteWidthPercent
      centerPercent = leftPercent + whiteWidthPercent * 0.32
      blackKeys.push({ ...key, leftPercent })
    } else {
      centerPercent = (whiteCount + 0.5) * whiteWidthPercent
      whiteCount += 1
    }
    if (key.isTarget && key.label) {
      chips.push({
        midi: key.midi,
        centerPercent,
        // Letter only (with accidental) — octave numbers crowd the chip.
        letter: key.label.replace(/-?\d+$/, ''),
      })
    }
  }

  return (
    <div className="visual-practice__keyboard-wrap" aria-hidden="true">
      <div className="visual-practice__key-chips">
        {chips.map((chip) => (
          <span
            key={chip.midi}
            className="visual-practice__key-chip"
            style={{ left: `${chip.centerPercent}%` }}
          >
            {chip.letter}
          </span>
        ))}
      </div>
      <div className="visual-practice__keyboard">
        {whiteKeys.map((key) => (
          <div
            key={key.midi}
            className={`visual-practice__key${
              key.isTarget ? ' visual-practice__key--target' : ''
            }`}
          >
            {key.label && !key.isTarget && (
              <span className="visual-practice__key-label">{key.label}</span>
            )}
          </div>
        ))}
        {blackKeys.map((key) => (
          <div
            key={key.midi}
            className={`visual-practice__key visual-practice__key--black${
              key.isTarget ? ' visual-practice__key--target' : ''
            }`}
            style={{ left: `${key.leftPercent}%`, width: `${whiteWidthPercent * 0.64}%` }}
          />
        ))}
      </div>
    </div>
  )
}
