import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { usePracticeVisualSession } from '../../context/PracticeSessionContext.jsx'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import { useInstrument } from '../../context/instrumentContext.js'
import { WFY_STATUS } from '../../features/practice/waitForYouEngine.js'
import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'
import {
  buildBarlineTimes,
  buildKeyboardKeys,
  buildVisualLaneGroups,
  computeKeyboardRange,
  resolveVisualFrameTime,
  resolveVisualTarget,
  selectVisualWindow,
} from '../../features/practice/visualPracticeLane.js'
import { detectStaves } from '../../features/practice/staffLaneLayout.js'
import {
  buildFretboardDisplayFrets,
  buildFretboardTargetPositions,
} from '../../features/practice/tabLaneLayout.js'
import {
  getTabPositionsForTimingMap,
  resolveStringsForTimingMap,
} from '../../features/instruments/timingMapTabPositions.js'
import { describeTabPosition } from '../../features/instruments/fretboard.js'
import StaffVisualLane from './StaffVisualLane.jsx'
import TabVisualLane from './TabVisualLane.jsx'

/**
 * Beginner-friendly Visual practice mode: a scrolling note lane with a fixed
 * playhead, the current target called out, and a target strip underneath.
 *
 * The lane visualization is chosen by the selected instrument (staff +
 * keyboard strip for piano, tablature + fretboard strip for guitar); the
 * groups, target resolution, window, clock, and scrolling engine are shared.
 *
 * Read-only view over the existing practice session — playback, the
 * practice clock, and Wait For You all keep working unchanged.
 */
function VisualPracticeView({ timingSourceKind = null }) {
  const visual = usePracticeVisualSession()
  const tick = usePracticeTick()
  const { instrument } = useInstrument()

  const timingMap = visual.timingMap
  const timingLoading = visual.timingLoading
  const loopRegion = visual.loopRegion

  const groups = useMemo(
    () => buildVisualLaneGroups(timingMap, loopRegion, { practiceScope: visual.practiceScope }),
    [timingMap, loopRegion, visual.practiceScope],
  )
  const laneKind = instrument.visualPractice.kind
  const isFretboardLane = laneKind === 'fretboard'
  const laneStrings = useMemo(
    () => (isFretboardLane ? resolveStringsForTimingMap(timingMap, instrument) : null),
    [isFretboardLane, timingMap, instrument],
  )
  const tabPositions = useMemo(
    () => (isFretboardLane && timingMap ? getTabPositionsForTimingMap(timingMap, instrument) : null),
    [isFretboardLane, timingMap, instrument],
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
  const visualDurationSeconds = useMemo(() => {
    const candidates = [
      tick.playbackDuration,
      timingMap?.durationSeconds,
      groups[groups.length - 1]?.timeSeconds,
    ]
    return candidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0) ?? null
  }, [tick.playbackDuration, timingMap?.durationSeconds, groups])
  const isWaitForYou = visual.isWaitForYou
  const wfyStatus = visual.wfyStatus
  const wfyCheckpoint = visual.wfyCheckpoint
  const visualGuitarScoreTarget = isFretboardLane
    ? visual.guitarScoreTarget?.activeTarget ?? null
    : null
  const waitForYouWaiting = isWaitForYou && wfyStatus === WFY_STATUS.WAITING
  const visualFrameTime = resolveVisualFrameTime({
    currentTime,
    waitForYouWaiting,
    waitForYouCheckpoint: wfyCheckpoint,
  })
  const getSmoothVisualFrameTime = useSmoothWfyFrameTime({
    rawFrameTime: visualFrameTime,
    waiting: waitForYouWaiting,
    checkpointId: wfyCheckpoint?.id ?? null,
  })

  const { index: targetIndex, group: targetGroup } = useMemo(
    () => resolveVisualTarget(groups, { currentTime, waitForYouCheckpoint: wfyCheckpoint }),
    [groups, currentTime, wfyCheckpoint],
  )

  // Window slides on whole seconds: statuses are index-driven, and the
  // look-ahead margin covers the coarseness, so the note layer's props stay
  // referentially stable between beats — scrolling itself is rAF-driven.
  const timeBucket = Math.floor(visualFrameTime)
  const visibleGroups = useMemo(
    () => selectVisualWindow(groups, timeBucket, targetIndex),
    [groups, timeBucket, targetIndex],
  )

  // Per-frame time source for the lane scroll: the engine's wall-clock
  // interpolated score time while playing (same source as the score-follow
  // cursor), the practice clock otherwise (paused / Wait For You / scrub).
  const getScoreTime = visual.getScoreTime
  const frameStateRef = useRef({ isPlaying: false })
  useEffect(() => {
    frameStateRef.current = {
      isPlaying: tick.playbackIsPlaying,
    }
  }, [tick.playbackIsPlaying])
  const getFrameTime = useCallback(() => {
    const state = frameStateRef.current
    return state.isPlaying && getScoreTime ? getScoreTime() : getSmoothVisualFrameTime()
  }, [getScoreTime, getSmoothVisualFrameTime])

  const targetMidisKey = targetGroup?.midis?.join(',') ?? ''
  const keyboardKeys = useMemo(
    () => buildKeyboardKeys(keyboardRange, targetGroup?.midis ?? []),
    [keyboardRange, targetMidisKey],
  )

  if (!timingMap || !groups.length) {
    return (
      <div className="visual-practice visual-practice--empty" aria-label="Visual practice">
        <div className="visual-practice__empty">
          <h3>{timingLoading ? 'Loading notes…' : 'No notes to show yet'}</h3>
          <p>
            {timingLoading
              ? 'Reading the timing file for this piece.'
              : 'Visual mode needs a timing file (MusicXML or MXL). Add one in Library, or open the demo piece to try it now. The Score view still works for PDF-only pieces.'}
          </p>
        </div>
      </div>
    )
  }

  const isOmrTiming = timingSourceKind === 'omr'
  const laneComplete = isWaitForYou && wfyStatus === WFY_STATUS.COMPLETE

  return (
    <div
      className="visual-practice"
      aria-label="Visual practice"
      data-guitar-score-target={visualGuitarScoreTarget ?? undefined}
    >
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
        waiting={waitForYouWaiting}
        complete={laneComplete}
        micChordSequence={
          isWaitForYou &&
          visual.wfyInputSource === WFY_INPUT_SOURCE.MICROPHONE &&
          Boolean(targetGroup?.isChord)
        }
        strings={laneStrings}
        tabPositions={tabPositions}
      />

      {isFretboardLane ? (
        <TabVisualLane
          visibleGroups={visibleGroups}
          strings={laneStrings}
          tabPositions={tabPositions}
          getFrameTime={getFrameTime}
          barlineTimes={barlineTimes}
          durationSeconds={visualDurationSeconds}
          loopRegion={loopRegion}
        />
      ) : (
        <StaffVisualLane
          visibleGroups={visibleGroups}
          staves={staves}
          getFrameTime={getFrameTime}
          barlineTimes={barlineTimes}
          timeSignature={timeSignature}
          durationSeconds={visualDurationSeconds}
          loopRegion={loopRegion}
        />
      )}

      {isFretboardLane ? (
        <VisualFretboardStrip
          targetGroup={targetGroup}
          strings={laneStrings}
          tabPositions={tabPositions}
        />
      ) : (
        <VisualKeyboardStrip keys={keyboardKeys} />
      )}

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

export default memo(VisualPracticeView)

const WFY_VISUAL_MOVE_MS = 420

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

function useSmoothWfyFrameTime({ rawFrameTime, waiting, checkpointId }) {
  const animationRef = useRef({
    from: rawFrameTime,
    to: rawFrameTime,
    startedAt: 0,
    checkpointId,
  })
  const displayRef = useRef(rawFrameTime)
  const latestRef = useRef({ rawFrameTime, waiting })
  latestRef.current = { rawFrameTime, waiting }

  useEffect(() => {
    if (!waiting) {
      animationRef.current = {
        from: rawFrameTime,
        to: rawFrameTime,
        startedAt: 0,
        checkpointId,
      }
      displayRef.current = rawFrameTime
      return
    }
    if (
      checkpointId !== animationRef.current.checkpointId ||
      Math.abs(rawFrameTime - animationRef.current.to) > 0.001
    ) {
      animationRef.current = {
        from: displayRef.current,
        to: rawFrameTime,
        startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        checkpointId,
      }
    }
  }, [rawFrameTime, waiting, checkpointId])

  const getSmoothedTime = useCallback(() => {
    const latest = latestRef.current
    if (!latest.waiting) {
      displayRef.current = latest.rawFrameTime
      return latest.rawFrameTime
    }
    const animation = animationRef.current
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const elapsed = Math.max(0, now - animation.startedAt)
    const progress = Math.min(1, elapsed / WFY_VISUAL_MOVE_MS)
    const eased = easeOutCubic(progress)
    const next = animation.from + (animation.to - animation.from) * eased
    displayRef.current = next
    return next
  }, [])

  return getSmoothedTime
}

/**
 * Instrument-aware note callout: piano shows pitch labels; fretted
 * instruments append the position ("E3 · fret 2 · D string").
 */
function describeTargetNotes(targetGroup, strings, tabPositions) {
  const notes = targetGroup?.notes ?? []
  if (!strings) {
    return notes.map((note) => note.label).join(' + ')
  }
  return notes
    .map((note) => {
      const position =
        note.string != null && note.fret != null
          ? { string: note.string, fret: note.fret }
          : tabPositions?.get(note.id) ?? null
      const positionLabel = position ? describeTabPosition(position, strings) : null
      return positionLabel ? `${note.label} · ${positionLabel}` : note.label
    })
    .join(' + ')
}

const VisualTargetHeader = memo(function VisualTargetHeader({
  targetGroup,
  targetIndex,
  totalGroups,
  isWaitForYou,
  waiting,
  complete,
  micChordSequence = false,
  strings = null,
  tabPositions = null,
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
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="visual-practice__target-kicker">
        {isWaitForYou ? 'Play this' : 'Next up'}
      </span>
      <strong className="visual-practice__target-notes">
        {describeTargetNotes(targetGroup, strings, tabPositions)}
        {targetGroup.isChord ? (micChordSequence ? ' (one at a time)' : ' (together)') : ''}
      </strong>
      <span className="visual-practice__target-meta">
        {position} · {Math.min(targetIndex + 1, totalGroups)} of {totalGroups}
        {waiting ? ' · waiting for you' : ''}
      </span>
    </div>
  )
})

/**
 * Display-only fretboard segment highlighting the current target positions —
 * the guitar counterpart of the keyboard strip. Strings run top-down like
 * printed tab (string 1 highest); frets run left-to-right from fret 1.
 */
const VisualFretboardStrip = memo(function VisualFretboardStrip({
  targetGroup,
  strings,
  tabPositions,
}) {
  const stringCount = strings?.count ?? 6
  const targetKey = targetGroup?.id ?? ''
  const { fretWidthPercent, rows, displayFrets } = useMemo(() => {
    const targets = buildFretboardTargetPositions(targetGroup, tabPositions)
    const frets = buildFretboardDisplayFrets(targets)
    const widthPercent = 100 / frets.length
    const targetsByKey = new Map(
      targets.map((target) => [`${target.string}:${target.fret}`, target]),
    )
    const builtRows = []
    for (let stringNumber = 1; stringNumber <= stringCount; stringNumber += 1) {
      const cells = []
      for (const fret of frets) {
        const target = targetsByKey.get(`${stringNumber}:${fret}`)
        cells.push({ fret, target: target ?? null })
      }
      builtRows.push({ stringNumber, cells })
    }
    return { fretWidthPercent: widthPercent, rows: builtRows, displayFrets: frets }
  }, [targetGroup, tabPositions, stringCount, targetKey])

  return (
    <div className="visual-practice__fretboard-wrap" aria-hidden="true">
      <div className="visual-practice__fretboard">
        {rows.map((row) => (
          <div key={row.stringNumber} className="visual-practice__fret-string">
            {row.cells.map((cell) => (
              <div
                key={cell.fret}
                className={`visual-practice__fret-cell${
                  cell.target ? ' visual-practice__fret-cell--target' : ''
                }`}
                style={{ width: `${fretWidthPercent}%` }}
              >
                {cell.target && (
                  <span className="visual-practice__fret-dot">
                    {cell.fret}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="visual-practice__fret-numbers">
        {displayFrets.map((fret) => (
          <span
            key={fret}
            className="visual-practice__fret-number"
            style={{ width: `${fretWidthPercent}%` }}
          >
            {fret}
          </span>
        ))}
      </div>
    </div>
  )
})

/**
 * Display-only keyboard segment highlighting the current target keys, with
 * floating letter chips above each target key (Simply Piano-style).
 */
const VisualKeyboardStrip = memo(function VisualKeyboardStrip({ keys }) {
  const layout = useMemo(() => {
    const whiteKeys = keys.filter((key) => !key.black)
    if (!whiteKeys.length) {
      return null
    }
    const whiteWidthPercent = 100 / whiteKeys.length
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
          letter: key.label.replace(/-?\d+$/, ''),
        })
      }
    }
    return { whiteKeys, whiteWidthPercent, blackKeys, chips }
  }, [keys])

  if (!layout) {
    return null
  }

  const { whiteKeys, whiteWidthPercent, blackKeys, chips } = layout

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
})
