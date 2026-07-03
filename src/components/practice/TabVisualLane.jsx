import { memo, useEffect, useMemo, useRef } from 'react'
import useElementSize from '../../hooks/useElementSize.js'
import useStableElementSize from '../../hooks/useStableElementSize.js'
import { VISUAL_LANE_DEFAULTS } from '../../features/practice/visualPracticeLane.js'
import {
  FRET_DISC_RADIUS,
  TAB_LINE_GAP,
  buildTabGeometry,
  buildTabLaneNotes,
} from '../../features/practice/tabLaneLayout.js'

const PX_PER_SECOND = VISUAL_LANE_DEFAULTS.pixelsPerSecond
const NOW_LINE_FRACTION = VISUAL_LANE_DEFAULTS.nowLineFraction
const MIN_SCALE = 0.9
const MAX_SCALE = 2.6
/** Current-target discs render slightly larger for instant focus. */
const CURRENT_DISC_SCALE = 1.28
/** Extra vertical coverage for the label-zone mask (in line gaps). */
const TAB_MASK_OVERDRAW_GAPS = 4

/**
 * Scrolling tablature renderer for Visual practice mode (guitar).
 *
 * Same architecture as StaffVisualLane: layout is a pure function of note
 * time (x = seconds × px/s); string lines and the playhead are static; the
 * scrolling group is one SVG transform written by a requestAnimationFrame
 * loop reading the engine's wall-clock-interpolated score time. Only the
 * visualization differs — fret numbers on string lines instead of noteheads
 * on staff lines.
 */
function TabVisualLane({
  visibleGroups,
  strings,
  tabPositions = null,
  getFrameTime,
  barlineTimes = [],
}) {
  const containerRef = useRef(null)
  const scrollRef = useRef(null)
  const rawSize = useElementSize(containerRef)
  const size = useStableElementSize(rawSize)

  const geometry = useMemo(() => buildTabGeometry(strings), [strings])

  const scale =
    size.height > 0
      ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, size.height / geometry.height))
      : 1
  const viewWidth = size.width > 0 ? size.width / scale : 1200
  const playheadX = viewWidth * NOW_LINE_FRACTION
  const offsetY = (size.height > 0 ? size.height / scale - geometry.height : 0) / 2

  const notes = useMemo(
    () =>
      buildTabLaneNotes(visibleGroups, geometry, {
        pixelsPerSecond: PX_PER_SECOND,
        positions: tabPositions,
      }),
    [visibleGroups, geometry, tabPositions],
  )

  const visibleBarlines = useMemo(() => {
    if (!visibleGroups.length || !barlineTimes.length) {
      return []
    }
    const start = visibleGroups[0].timeSeconds - 1
    const end = visibleGroups[visibleGroups.length - 1].timeSeconds + 2
    return barlineTimes.filter((t) => t > start && t <= end)
  }, [visibleGroups, barlineTimes])

  const topY = geometry.lines[0]
  const bottomY = geometry.lines[geometry.lines.length - 1]

  // Scroll transform: written imperatively every animation frame (see
  // StaffVisualLane) so React re-renders can't snap or rubber-band the lane.
  const playheadXRef = useRef(playheadX)
  useEffect(() => {
    playheadXRef.current = playheadX
  }, [playheadX])
  useEffect(() => {
    let frame
    const step = () => {
      const el = scrollRef.current
      if (el) {
        const t = getFrameTime()
        el.setAttribute(
          'transform',
          `translate3d(${playheadXRef.current - t * PX_PER_SECOND}px, 0, 0)`,
        )
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [getFrameTime])

  return (
    <div ref={containerRef} className="tab-lane" aria-hidden="true">
      <svg className="tab-lane__svg" width="100%" height="100%">
        <g transform={`scale(${scale}) translate(0 ${offsetY})`}>
          {/* Scrolling layer: barlines + fret numbers. */}
          <g ref={scrollRef} className="tab-lane__scroll">
            {visibleBarlines.map((time) => (
              <line
                key={time}
                className="tab-lane__barline"
                x1={time * PX_PER_SECOND}
                x2={time * PX_PER_SECOND}
                y1={topY}
                y2={bottomY}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {notes.map((note) => {
              const radius =
                note.status === 'current' ? FRET_DISC_RADIUS * CURRENT_DISC_SCALE : FRET_DISC_RADIUS
              return (
                <g
                  key={note.id}
                  className={`tab-lane__note tab-lane__note--${note.status ?? 'upcoming'}`}
                >
                  <circle className="tab-lane__disc" cx={note.x} cy={note.y} r={radius} />
                  <text
                    className="tab-lane__fret"
                    x={note.x}
                    y={note.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={note.fret >= 10 ? TAB_LINE_GAP * 0.72 : TAB_LINE_GAP * 0.86}
                  >
                    {note.fret}
                  </text>
                </g>
              )
            })}
          </g>

          {/* Static layer: string lines + open-string labels (never moves). */}
          <g className="tab-lane__static">
            <rect
              className="tab-lane__mask"
              x={0}
              y={-TAB_LINE_GAP * TAB_MASK_OVERDRAW_GAPS}
              width={TAB_LINE_GAP * 3.2}
              height={geometry.height + TAB_LINE_GAP * TAB_MASK_OVERDRAW_GAPS * 2}
            />
            {geometry.lines.map((y, index) => (
              <line
                key={y}
                className={`tab-lane__line${index === 0 || index === geometry.lines.length - 1 ? '' : ' tab-lane__line--inner'}`}
                x1={0}
                x2={viewWidth}
                y1={y}
                y2={y}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {geometry.stringLabels.map((label, index) => (
              <text
                key={`${label}-${index}`}
                className="tab-lane__string-label"
                x={TAB_LINE_GAP * 0.9}
                y={geometry.lines[index]}
                fontSize={TAB_LINE_GAP * 0.78}
                dominantBaseline="central"
                textAnchor="middle"
              >
                {label}
              </text>
            ))}
          </g>

          {/* Fixed playhead, painted on top. */}
          <line
            className="tab-lane__playhead"
            x1={playheadX}
            x2={playheadX}
            y1={topY - TAB_LINE_GAP}
            y2={bottomY + TAB_LINE_GAP}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="tab-lane__playhead-cap"
            cx={playheadX}
            cy={topY - TAB_LINE_GAP}
            r={3.5}
          />
        </g>
      </svg>
    </div>
  )
}

export default memo(TabVisualLane)
