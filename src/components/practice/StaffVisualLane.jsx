import { memo, useEffect, useMemo, useRef } from 'react'
import useElementSize from '../../hooks/useElementSize.js'
import useStableElementSize from '../../hooks/useStableElementSize.js'
import { VISUAL_LANE_DEFAULTS } from '../../features/practice/visualPracticeLane.js'
import {
  NOTEHEAD_RX,
  NOTEHEAD_RY,
  STAFF_KIND,
  STAFF_LINE_GAP,
  buildStaffGeometry,
  buildStaffLaneNotes,
  buildStaffLaneStems,
} from '../../features/practice/staffLaneLayout.js'

const PX_PER_SECOND = VISUAL_LANE_DEFAULTS.pixelsPerSecond
const NOW_LINE_FRACTION = VISUAL_LANE_DEFAULTS.nowLineFraction
/** Staff scale bounds: large, learning-first staves. The lane fills its card
    height, which zooms the view in and naturally shows fewer measures. */
const MIN_SCALE = 0.9
const MAX_SCALE = 2.6
/** Current-target noteheads render slightly larger for instant focus. */
const CURRENT_HEAD_SCALE = 1.3
const LEDGER_HALF_WIDTH = 11
/** Extra vertical coverage for the clef-zone mask (in line gaps). */
const STAFF_MASK_OVERDRAW_GAPS = 6

const TREBLE_CLEF_GLYPH = '\u{1D11E}'
const BASS_CLEF_GLYPH = '\u{1D122}'

/**
 * Some platforms have no font for the Unicode musical clef glyphs and would
 * render tofu boxes. Probe once; fall back to letter clefs ("G"/"F" on their
 * lines — which is what the clefs mean) when the glyphs are unavailable.
 */
let clefGlyphSupport = null
function supportsClefGlyphs() {
  if (clefGlyphSupport != null) {
    return clefGlyphSupport
  }
  try {
    const context = document.createElement('canvas').getContext('2d')
    context.font = '32px serif'
    const clefWidth = context.measureText(TREBLE_CLEF_GLYPH).width
    const notdefWidth = context.measureText('\u{FFFF}').width
    clefGlyphSupport = clefWidth > 0 && Math.abs(clefWidth - notdefWidth) > 1
  } catch {
    clefGlyphSupport = false
  }
  return clefGlyphSupport
}

/**
 * Scrolling staff renderer for Visual practice mode.
 *
 * Layout is a pure function of note time (x = seconds × px/s). The playhead
 * and staff lines live outside the scrolling group and never move; scrolling
 * is one SVG transform written by a requestAnimationFrame loop that reads the
 * playback engine's wall-clock-interpolated score time — the same source the
 * score-follow cursor uses — so motion is smooth and the playhead cannot
 * jitter against it.
 */
function StaffVisualLane({ visibleGroups, staves, getFrameTime, barlineTimes = [], timeSignature = null }) {
  const containerRef = useRef(null)
  const scrollRef = useRef(null)
  const rawSize = useElementSize(containerRef)
  const size = useStableElementSize(rawSize)

  const geometry = useMemo(() => buildStaffGeometry(staves), [staves])

  const scale =
    size.height > 0
      ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, size.height / geometry.height))
      : 1
  const viewWidth = size.width > 0 ? size.width / scale : 1200
  const playheadX = viewWidth * NOW_LINE_FRACTION
  // Center the staff block; may go negative on short lanes, cropping only
  // the outer ledger margins symmetrically.
  const offsetY = (size.height > 0 ? size.height / scale - geometry.height : 0) / 2

  const notes = useMemo(
    () => buildStaffLaneNotes(visibleGroups, geometry, { pixelsPerSecond: PX_PER_SECOND }),
    [visibleGroups, geometry],
  )
  const stems = useMemo(
    () => buildStaffLaneStems(visibleGroups, geometry, { pixelsPerSecond: PX_PER_SECOND }),
    [visibleGroups, geometry],
  )

  // Barlines within the visible groups' span (deterministic x, like notes).
  const visibleBarlines = useMemo(() => {
    if (!visibleGroups.length || !barlineTimes.length) {
      return []
    }
    const start = visibleGroups[0].timeSeconds - 1
    const end = visibleGroups[visibleGroups.length - 1].timeSeconds + 2
    return barlineTimes.filter((t) => t > start && t <= end)
  }, [visibleGroups, barlineTimes])

  const staffTopY = geometry.lines[0]
  const staffBottomY = geometry.lines[geometry.lines.length - 1]

  // Scroll transform: written imperatively every animation frame; React never
  // renders this attribute, so re-renders can't snap or rubber-band the lane.
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
          `translate(${playheadXRef.current - t * PX_PER_SECOND} 0)`,
        )
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [getFrameTime])

  const treble = geometry.staves[STAFF_KIND.TREBLE]
  const bass = geometry.staves[STAFF_KIND.BASS]
  const glyphClefs = supportsClefGlyphs()

  return (
    <div ref={containerRef} className="staff-lane" aria-hidden="true">
      <svg className="staff-lane__svg" width="100%" height="100%">
        <g transform={`scale(${scale}) translate(0 ${offsetY})`}>
          {/* Scrolling notes: single transform, deterministic x from time.
              Rendered first so staff lines and clefs paint over them. */}
          <g ref={scrollRef} className="staff-lane__scroll">
            {visibleBarlines.map((time) => (
              <line
                key={time}
                className="staff-lane__barline"
                x1={time * PX_PER_SECOND}
                x2={time * PX_PER_SECOND}
                y1={staffTopY}
                y2={staffBottomY}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {stems.map((stem) => (
              <line
                key={stem.id}
                className={`staff-lane__stem staff-lane__note--${stem.status ?? 'upcoming'}`}
                x1={stem.x}
                x2={stem.x}
                y1={stem.y1}
                y2={stem.y2}
              />
            ))}
            {notes.map((note) => (
              <g
                key={note.id}
                className={`staff-lane__note staff-lane__note--${note.status ?? 'upcoming'}`}
              >
                {note.ledgerLines.map((ledgerY) => (
                  <line
                    key={ledgerY}
                    className="staff-lane__ledger"
                    x1={note.x + note.xOffset - LEDGER_HALF_WIDTH}
                    x2={note.x + note.xOffset + LEDGER_HALF_WIDTH}
                    y1={ledgerY}
                    y2={ledgerY}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {note.sharp && (
                  <text
                    className="staff-lane__sharp"
                    x={note.x + note.xOffset - NOTEHEAD_RX - 4}
                    y={note.y}
                    dominantBaseline="middle"
                    textAnchor="end"
                    fontSize={STAFF_LINE_GAP + 2}
                  >
                    ♯
                  </text>
                )}
                <ellipse
                  className={`staff-lane__head${note.hollow ? ' staff-lane__head--hollow' : ''}`}
                  cx={note.x + note.xOffset}
                  cy={note.y}
                  rx={note.status === 'current' ? NOTEHEAD_RX * CURRENT_HEAD_SCALE : NOTEHEAD_RX}
                  ry={note.status === 'current' ? NOTEHEAD_RY * CURRENT_HEAD_SCALE : NOTEHEAD_RY}
                  transform={`rotate(-14 ${note.x + note.xOffset} ${note.y})`}
                />
              </g>
            ))}
          </g>

          {/* Static layer: staff lines + clefs (never moves). The mask hides
              already-played notes sliding under the clef/time-signature zone. */}
          <g className="staff-lane__static">
            <rect
              className="staff-lane__mask"
              x={0}
              y={-STAFF_LINE_GAP * STAFF_MASK_OVERDRAW_GAPS}
              width={STAFF_LINE_GAP * 6.8}
              height={geometry.height + STAFF_LINE_GAP * STAFF_MASK_OVERDRAW_GAPS * 2}
            />
            {geometry.lines.map((y) => (
              <line
                key={y}
                className="staff-lane__line"
                x1={0}
                x2={viewWidth}
                y1={y}
                y2={y}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {treble && (
              <text
                className={`staff-lane__clef${glyphClefs ? '' : ' staff-lane__clef--letter'}`}
                x={STAFF_LINE_GAP}
                y={treble.lines[3]}
                fontSize={glyphClefs ? STAFF_LINE_GAP * 5.6 : STAFF_LINE_GAP * 2}
                dominantBaseline="middle"
              >
                {glyphClefs ? TREBLE_CLEF_GLYPH : 'G'}
              </text>
            )}
            {bass && (
              <text
                className={`staff-lane__clef${glyphClefs ? '' : ' staff-lane__clef--letter'}`}
                x={STAFF_LINE_GAP}
                y={bass.lines[1]}
                fontSize={glyphClefs ? STAFF_LINE_GAP * 3.4 : STAFF_LINE_GAP * 2}
                dominantBaseline="middle"
              >
                {glyphClefs ? BASS_CLEF_GLYPH : 'F'}
              </text>
            )}
            {timeSignature &&
              Object.values(geometry.staves).map((staff) => (
                <g key={staff.kind} className="staff-lane__timesig">
                  <text
                    x={STAFF_LINE_GAP * 4.6}
                    y={staff.lines[1]}
                    fontSize={STAFF_LINE_GAP * 2.2}
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {timeSignature.beats}
                  </text>
                  <text
                    x={STAFF_LINE_GAP * 4.6}
                    y={staff.lines[3]}
                    fontSize={STAFF_LINE_GAP * 2.2}
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {timeSignature.beatType}
                  </text>
                </g>
              ))}
          </g>

          {/* Fixed playhead: outside the scrolling group, painted on top. */}
          <line
            className="staff-lane__playhead"
            x1={playheadX}
            x2={playheadX}
            y1={STAFF_LINE_GAP}
            y2={geometry.height - STAFF_LINE_GAP}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="staff-lane__playhead-cap"
            cx={playheadX}
            cy={STAFF_LINE_GAP}
            r={3.5}
          />
        </g>
      </svg>
    </div>
  )
}

export default memo(StaffVisualLane)
