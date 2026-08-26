import { memo, useEffect, useMemo, useRef } from 'react'
import useElementSize from '../../hooks/useElementSize.js'
import useStableElementSize from '../../hooks/useStableElementSize.js'
import { VISUAL_LANE_DEFAULTS } from '../../features/practice/visualLaneConstants.js'
import {
  resolveVisualLaneTransform,
  resolveVisualPlayheadX,
} from '../../features/practice/visualPracticeLane.js'
import {
  resolveSourceFidelityBarlineX,
  resolveSourceFidelityLaneX,
} from '../../features/practice/sourceFidelityLayout.js'
import {
  NOTEHEAD_RX,
  NOTEHEAD_RY,
  STAFF_KIND,
  STAFF_LINE_GAP,
  buildKeySignatureMarks,
  buildStaffGeometry,
  buildStaffLaneNotes,
  buildStaffLaneNotationMarkings,
  buildStaffLaneRests,
  buildStaffLaneRhythmMarks,
  buildStaffLaneStems,
  buildSourceSystemStaffGeometry,
} from '../../features/practice/staffLaneLayout.js'
import { resolveLaneNoteClass } from '../../features/practice/visualLaneFeedback.js'

const PX_PER_SECOND = VISUAL_LANE_DEFAULTS.pixelsPerSecond
/** Staff scale bounds: large, learning-first staves. The lane fills its card
    height, which zooms the view in and naturally shows fewer measures. */
const MIN_SCALE = 0.9
const MAX_SCALE = 2.6
/** Current-target noteheads render slightly larger for instant focus. */
const CURRENT_HEAD_SCALE = 1.35
const LEDGER_HALF_WIDTH = 11
/** Extra vertical coverage for the clef-zone mask (in line gaps). */
const STAFF_MASK_OVERDRAW_GAPS = 6
const SYSTEM_PREFIX_CLEF_X = STAFF_LINE_GAP
const SYSTEM_PREFIX_KEY_X = STAFF_LINE_GAP * 3.6
const SYSTEM_PREFIX_KEY_COLUMN_WIDTH = STAFF_LINE_GAP * 0.82

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
 * Layout follows source-derived print positions when trustworthy geometry is
 * available and falls back to note time otherwise. The staff lines stay
 * static while one requestAnimationFrame loop moves the playhead and
 * translates the note layer from the same semantic frame time, keeping both
 * locked to the playback engine's wall-clock-interpolated score time.
 */
function StaffVisualLane({
  visibleGroups,
  staves,
  getFrameTime,
  barlineTimes = [],
  timeSignature = null,
  keySignature = null,
  durationSeconds = null,
  loopRegion = null,
  sourceLayout = null,
  structuralMarks = null,
}) {
  const containerRef = useRef(null)
  const scrollRef = useRef(null)
  const playheadRef = useRef(null)
  const rawSize = useElementSize(containerRef)
  const size = useStableElementSize(rawSize)
  const sourceSystems = useMemo(
    () =>
      sourceLayout?.mode === 'source-fidelity'
        ? sourceLayout.systems ?? []
        : [],
    [sourceLayout],
  )
  const maxSourceStaffDistanceGaps = Math.max(
    0,
    ...sourceSystems
      .map((system) => Number(system.staffDistances?.['2']) / 10)
      .filter((value) => Number.isFinite(value) && value > 0),
  )

  const geometry = useMemo(
    () =>
      buildStaffGeometry(staves, {
        grandStaffGapGaps: maxSourceStaffDistanceGaps || undefined,
      }),
    [staves, maxSourceStaffDistanceGaps],
  )
  const sourceSystemGeometries = useMemo(
    () =>
      new Map(
        sourceSystems.map((system) => [
          system.occurrence,
          buildSourceSystemStaffGeometry(geometry, system),
        ]),
      ),
    [sourceSystems, geometry],
  )

  const scale =
    size.height > 0
      ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, size.height / geometry.height))
      : 1
  const viewWidth = size.width > 0 ? size.width / scale : 1200
  const playheadX = resolveVisualPlayheadX({ frameTime: 0, viewWidth, durationSeconds, loopRegion })
  // Center the staff block; may go negative on short lanes, cropping only
  // the outer ledger margins symmetrically.
  const offsetY = (size.height > 0 ? size.height / scale - geometry.height : 0) / 2

  const { notes, rests, stems, beams, flags, dots, noteMarkings, spanMarkings } = useMemo(() => {
    const builtNotes = buildStaffLaneNotes(visibleGroups, geometry, {
      pixelsPerSecond: PX_PER_SECOND,
      sourceLayout,
    })
    const builtRests = buildStaffLaneRests(visibleGroups, geometry, {
      pixelsPerSecond: PX_PER_SECOND,
      sourceLayout,
    })
    const builtStems = buildStaffLaneStems(visibleGroups, geometry, {
      pixelsPerSecond: PX_PER_SECOND,
      notes: builtNotes,
      sourceLayout,
    })
    const markings = buildStaffLaneNotationMarkings(visibleGroups, geometry, {
      pixelsPerSecond: PX_PER_SECOND,
      notes: builtNotes,
      sourceLayout,
    })
    const rhythmMarks = buildStaffLaneRhythmMarks(builtNotes, builtStems)
    return {
      notes: builtNotes,
      rests: builtRests,
      stems: builtStems,
      ...rhythmMarks,
      ...markings,
    }
  }, [visibleGroups, geometry, sourceLayout])

  // Barlines within the visible groups' span (deterministic x, like notes).
  const visibleBarlines = useMemo(() => {
    if (!visibleGroups.length || !barlineTimes.length) {
      return []
    }
    const start = visibleGroups[0].timeSeconds - 1
    const end = visibleGroups[visibleGroups.length - 1].timeSeconds + 2
    return barlineTimes
      .filter((time) => time > start && time <= end)
      .map((time) => ({
        time,
        x: resolveSourceFidelityBarlineX(sourceLayout, time),
      }))
      .map((barline) => {
        const system = sourceSystems.find(
          (candidate) =>
            barline.x >= candidate.xStart && barline.x <= candidate.xEnd,
        )
        return {
          ...barline,
          geometry:
            sourceSystemGeometries.get(system?.occurrence) ?? geometry,
        }
      })
  }, [
    visibleGroups,
    barlineTimes,
    sourceLayout,
    sourceSystems,
    sourceSystemGeometries,
    geometry,
  ])

  const staffTopY = geometry.lines[0]

  // Per-frame motion: React lays out the SVG, then rAF updates only the
  // attributes that depend on time.
  const frameMetricsRef = useRef({ viewWidth, durationSeconds, loopRegion, sourceLayout })
  useEffect(() => {
    frameMetricsRef.current = { viewWidth, durationSeconds, loopRegion, sourceLayout }
  }, [viewWidth, durationSeconds, loopRegion, sourceLayout])
  useEffect(() => {
    let frame
    const step = () => {
      const el = scrollRef.current
      const playheadEl = playheadRef.current
      const t = getFrameTime()
      const metrics = frameMetricsRef.current
      const { playheadX: livePlayheadX } = resolveVisualLaneTransform({
        frameTime: t,
        ...metrics,
      })
      const scrollX =
        livePlayheadX - resolveSourceFidelityLaneX(metrics.sourceLayout, t)
      if (el) {
        el.setAttribute(
          'transform',
          `translate(${scrollX} 0)`,
        )
      }
      if (playheadEl) {
        playheadEl.setAttribute('x1', String(livePlayheadX))
        playheadEl.setAttribute('x2', String(livePlayheadX))
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [getFrameTime])

  const treble = geometry.staves[STAFF_KIND.TREBLE]
  const bass = geometry.staves[STAFF_KIND.BASS]
  const glyphClefs = supportsClefGlyphs()
  const usesSourceSystems = sourceSystems.length > 0
  const keySignatureMarks = useMemo(
    () => buildKeySignatureMarks(keySignature, geometry),
    [keySignature, geometry],
  )
  const keyColumns = Math.max(
    0,
    ...keySignatureMarks.map((mark) => mark.column + 1),
  )
  const timeSignatureX =
    STAFF_LINE_GAP * 4.6 + keyColumns * SYSTEM_PREFIX_KEY_COLUMN_WIDTH
  const staticMaskWidth =
    STAFF_LINE_GAP * 6.8 + keyColumns * SYSTEM_PREFIX_KEY_COLUMN_WIDTH
  const sourceSystemPrefixes = useMemo(() => {
    return sourceSystems.map((system, index) => {
      const systemGeometry = sourceSystemGeometries.get(system.occurrence) ?? geometry
      const systemKeyMarks = buildKeySignatureMarks(system.keySignature, systemGeometry)
      const systemKeyColumns = Math.max(
        0,
        ...systemKeyMarks.map((mark) => mark.column + 1),
      )
      const signature = system.timeSignature
      const signatureKey = signature
        ? `${signature.beats}/${signature.beatType}`
        : null
      const previousTimeSignature = sourceSystems
        .slice(0, index)
        .map((candidate) =>
          candidate.timeSignature
            ? `${candidate.timeSignature.beats}/${candidate.timeSignature.beatType}`
            : null,
        )
        .filter(Boolean)
        .at(-1) ?? null
      const showTimeSignature = Boolean(
        signatureKey && (index === 0 || signatureKey !== previousTimeSignature),
      )
      return {
        ...system,
        geometry: systemGeometry,
        treble: systemGeometry.staves[STAFF_KIND.TREBLE] ?? null,
        bass: systemGeometry.staves[STAFF_KIND.BASS] ?? null,
        staffTopY: systemGeometry.lines[0],
        staffBottomY: systemGeometry.lines[systemGeometry.lines.length - 1],
        keyMarks: systemKeyMarks,
        timeSignatureX:
          system.xStart +
          STAFF_LINE_GAP * 4.6 +
          systemKeyColumns * SYSTEM_PREFIX_KEY_COLUMN_WIDTH,
        showTimeSignature,
      }
    })
  }, [sourceSystems, sourceSystemGeometries, geometry])
  const inlineKeySignatures = useMemo(
    () =>
      (structuralMarks?.keySignatures ?? []).map((signature) => {
        const systemGeometry =
          sourceSystemGeometries.get(signature.systemOccurrence) ?? geometry
        return {
          ...signature,
          geometry: systemGeometry,
          marks: buildKeySignatureMarks(signature, systemGeometry),
        }
      }),
    [structuralMarks, sourceSystemGeometries, geometry],
  )

  return (
    <div
      ref={containerRef}
      className="staff-lane"
      aria-hidden="true"
      data-source-layout={sourceLayout?.mode ?? 'temporal-fallback'}
    >
      <svg className="staff-lane__svg" width="100%" height="100%">
        <g transform={`scale(${scale}) translate(0 ${offsetY})`}>
          {/* Scrolling notes: single transform, deterministic reconstructed x.
              Rendered first so staff lines and clefs paint over them. */}
          <g ref={scrollRef} className="staff-lane__scroll">
            {usesSourceSystems && sourceSystems.flatMap((system) =>
              (sourceSystemGeometries.get(system.occurrence) ?? geometry).lines.map((y) => (
                <line
                  key={`system-${system.occurrence}-line-${y}`}
                  className="staff-lane__line"
                  x1={system.xStart}
                  x2={system.xEnd}
                  y1={y}
                  y2={y}
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}
            {usesSourceSystems && sourceSystemPrefixes.map((system) => (
              <g
                key={`system-${system.occurrence}-prefix`}
                className="staff-lane__system-prefix"
                data-source-page={system.page}
                data-source-system={system.systemIndex}
              >
                <line
                  className="staff-lane__system-connector"
                  x1={system.xStart}
                  x2={system.xStart}
                  y1={system.staffTopY}
                  y2={system.staffBottomY}
                  vectorEffect="non-scaling-stroke"
                />
                {system.treble && (
                  <text
                    className={`staff-lane__clef${glyphClefs ? '' : ' staff-lane__clef--letter'}`}
                    x={system.xStart + SYSTEM_PREFIX_CLEF_X}
                    y={system.treble.lines[3]}
                    fontSize={glyphClefs ? STAFF_LINE_GAP * 5.6 : STAFF_LINE_GAP * 2}
                    dominantBaseline="middle"
                  >
                    {glyphClefs ? TREBLE_CLEF_GLYPH : 'G'}
                  </text>
                )}
                {system.bass && (
                  <text
                    className={`staff-lane__clef${glyphClefs ? '' : ' staff-lane__clef--letter'}`}
                    x={system.xStart + SYSTEM_PREFIX_CLEF_X}
                    y={system.bass.lines[1]}
                    fontSize={glyphClefs ? STAFF_LINE_GAP * 3.4 : STAFF_LINE_GAP * 2}
                    dominantBaseline="middle"
                  >
                    {glyphClefs ? BASS_CLEF_GLYPH : 'F'}
                  </text>
                )}
                {system.keyMarks.map((mark) => (
                  <text
                    key={`system-${system.occurrence}-${mark.id}`}
                    className={`staff-lane__key-accidental staff-lane__key-accidental--${mark.type}`}
                    data-key-accidental={mark.type}
                    x={
                      system.xStart +
                      SYSTEM_PREFIX_KEY_X +
                      mark.column * SYSTEM_PREFIX_KEY_COLUMN_WIDTH
                    }
                    y={mark.y}
                    fontSize={STAFF_LINE_GAP * 1.45}
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {mark.glyph}
                  </text>
                ))}
                {system.showTimeSignature && system.timeSignature &&
                  Object.values(system.geometry.staves).map((staff) => (
                    <g
                      key={`system-${system.occurrence}-${staff.kind}-time`}
                      className="staff-lane__timesig"
                    >
                      <text
                        x={system.timeSignatureX}
                        y={staff.lines[1]}
                        fontSize={STAFF_LINE_GAP * 2.2}
                        dominantBaseline="middle"
                        textAnchor="middle"
                      >
                        {system.timeSignature.beats}
                      </text>
                      <text
                        x={system.timeSignatureX}
                        y={staff.lines[3]}
                        fontSize={STAFF_LINE_GAP * 2.2}
                        dominantBaseline="middle"
                        textAnchor="middle"
                      >
                        {system.timeSignature.beatType}
                      </text>
                    </g>
                  ))}
              </g>
            ))}
            {(structuralMarks?.endings ?? []).map((ending) => {
              const y = staffTopY - STAFF_LINE_GAP * 1.7
              return (
                <g
                  key={ending.id}
                  className="staff-lane__ending"
                  data-structural-kind="ending"
                >
                  <line
                    x1={ending.xStart}
                    x2={ending.xEnd}
                    y1={y}
                    y2={y}
                    vectorEffect="non-scaling-stroke"
                  />
                  {!ending.continued && (
                    <line
                      x1={ending.xStart}
                      x2={ending.xStart}
                      y1={y}
                      y2={staffTopY - STAFF_LINE_GAP * 0.25}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {!ending.discontinue && (
                    <line
                      x1={ending.xEnd}
                      x2={ending.xEnd}
                      y1={y}
                      y2={staffTopY - STAFF_LINE_GAP * 0.65}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {!ending.continued && (
                    <text
                      x={ending.xStart + STAFF_LINE_GAP * 0.65}
                      y={y - STAFF_LINE_GAP * 0.32}
                      fontSize={STAFF_LINE_GAP * 1.15}
                    >
                      {ending.numbers.join(',')}.
                    </text>
                  )}
                </g>
              )
            })}
            {(structuralMarks?.repeats ?? []).map((repeat) => {
              const repeatGeometry =
                sourceSystemGeometries.get(repeat.systemOccurrence) ?? geometry
              const repeatTopY = repeatGeometry.lines[0]
              const repeatBottomY =
                repeatGeometry.lines[repeatGeometry.lines.length - 1]
              return (
                <g
                  key={repeat.id}
                  className={`staff-lane__repeat staff-lane__repeat--${repeat.direction}`}
                  data-structural-kind="repeat"
                  data-repeat-direction={repeat.direction}
                >
                  <line
                    className="staff-lane__repeat-thick"
                    x1={repeat.x + (repeat.direction === 'forward' ? 0 : -3)}
                    x2={repeat.x + (repeat.direction === 'forward' ? 0 : -3)}
                    y1={repeatTopY}
                    y2={repeatBottomY}
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={repeat.x + (repeat.direction === 'forward' ? 4 : 1)}
                    x2={repeat.x + (repeat.direction === 'forward' ? 4 : 1)}
                    y1={repeatTopY}
                    y2={repeatBottomY}
                    vectorEffect="non-scaling-stroke"
                  />
                  {Object.values(repeatGeometry.staves).flatMap((staff) => [
                    (staff.lines[1] + staff.lines[2]) / 2,
                    (staff.lines[2] + staff.lines[3]) / 2,
                  ]).map((y, index) => (
                    <circle
                      key={`${repeat.id}-dot-${index}`}
                      cx={repeat.x + (repeat.direction === 'forward' ? 10 : -9)}
                      cy={y}
                      r={STAFF_LINE_GAP * 0.16}
                    />
                  ))}
                  {repeat.times && (
                    <text
                      className="staff-lane__repeat-times"
                      x={repeat.x - STAFF_LINE_GAP * 0.8}
                      y={repeatTopY - STAFF_LINE_GAP * 0.65}
                      fontSize={STAFF_LINE_GAP}
                    >
                      ×{repeat.times}
                    </text>
                  )}
                </g>
              )
            })}
            {inlineKeySignatures.map((signature) => (
              <g
                key={signature.id}
                className="staff-lane__inline-key"
                data-structural-kind="key-signature"
              >
                {signature.marks.map((mark) => (
                  <text
                    key={`${signature.id}-${mark.id}`}
                    className={`staff-lane__key-accidental staff-lane__key-accidental--${mark.type}`}
                    data-key-accidental={mark.type}
                    data-key-cancellation={mark.cancellation || undefined}
                    x={
                      signature.x +
                      STAFF_LINE_GAP * 0.9 +
                      mark.column * SYSTEM_PREFIX_KEY_COLUMN_WIDTH
                    }
                    y={mark.y}
                    fontSize={STAFF_LINE_GAP * 1.45}
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {mark.glyph}
                  </text>
                ))}
              </g>
            ))}
            {(structuralMarks?.timeSignatures ?? []).map((signature) => {
              const signatureGeometry =
                sourceSystemGeometries.get(signature.systemOccurrence) ?? geometry
              return (
                <g
                  key={signature.id}
                  className="staff-lane__timesig staff-lane__timesig--inline"
                  data-structural-kind="time-signature"
                >
                {Object.values(signatureGeometry.staves).flatMap((staff) => [
                  <text
                    key={`${signature.id}-${staff.kind}-beats`}
                    x={signature.x + STAFF_LINE_GAP * 1.2}
                    y={staff.lines[1]}
                    fontSize={STAFF_LINE_GAP * 2.2}
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {signature.beats}
                  </text>,
                  <text
                    key={`${signature.id}-${staff.kind}-beat-type`}
                    x={signature.x + STAFF_LINE_GAP * 1.2}
                    y={staff.lines[3]}
                    fontSize={STAFF_LINE_GAP * 2.2}
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {signature.beatType}
                  </text>,
                ])}
                </g>
              )
            })}
            {visibleBarlines.map((barline) => (
              <line
                key={barline.time}
                className="staff-lane__barline"
                x1={barline.x}
                x2={barline.x}
                y1={barline.geometry.lines[0]}
                y2={barline.geometry.lines[barline.geometry.lines.length - 1]}
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
            {beams.map((beam) => (
              <line
                key={beam.id}
                className={`staff-lane__beam staff-lane__note--${beam.status ?? 'upcoming'}`}
                x1={beam.x1}
                x2={beam.x2}
                y1={beam.y1}
                y2={beam.y2}
              />
            ))}
            {flags.map((flag) => (
              <path
                key={flag.id}
                className={`staff-lane__flag staff-lane__note--${flag.status ?? 'upcoming'}`}
                d={flag.path}
              />
            ))}
            {spanMarkings.map((marking) => (
              <path
                key={marking.id}
                className={`staff-lane__span-mark staff-lane__span-mark--${marking.kind} staff-lane__note--${marking.status ?? 'upcoming'}`}
                data-span-segment={marking.segmentIndex ?? undefined}
                data-span-segment-count={marking.segmentCount ?? undefined}
                data-source-system={marking.systemOccurrence ?? undefined}
                d={marking.path}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {rests.map((rest) => (
              <g
                key={rest.id}
                className={`staff-lane__rest staff-lane__note--${resolveLaneNoteClass(
                  rest.status,
                  rest.laneOutcome,
                )}`}
                data-note-type={rest.noteType}
                data-voice={rest.voice}
              >
                <text
                  className="staff-lane__rest-glyph"
                  x={rest.x}
                  y={rest.y}
                  fontSize={STAFF_LINE_GAP * 2.55}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {rest.glyph}
                </text>
                {Array.from({ length: rest.dots }, (_, index) => (
                  <circle
                    key={`${rest.id}-dot-${index + 1}`}
                    className="staff-lane__augmentation-dot"
                    cx={rest.x + STAFF_LINE_GAP * 0.92 + index * 5}
                    cy={rest.y - STAFF_LINE_GAP * 0.18}
                    r={1.8}
                  />
                ))}
              </g>
            ))}
            {notes.map((note) => (
              <g
                key={note.id}
                className={`staff-lane__note staff-lane__note--${resolveLaneNoteClass(note.status, note.laneOutcome)}`}
                data-note-type={note.noteType ?? undefined}
                data-voice={note.voice}
                data-hollow={note.hollow || undefined}
                data-stemless={note.stemless || undefined}
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
                {note.accidentalGlyph && (
                  <text
                    className={`staff-lane__accidental staff-lane__accidental--${note.accidentalType}${note.accidentalType === 'sharp' ? ' staff-lane__sharp' : ''}`}
                    data-accidental={note.accidentalType}
                    x={
                      note.x +
                      note.xOffset -
                      NOTEHEAD_RX -
                      4 -
                      note.accidentalColumn * STAFF_LINE_GAP * 0.95
                    }
                    y={note.y}
                    dominantBaseline="middle"
                    textAnchor="end"
                    fontSize={STAFF_LINE_GAP + 2}
                  >
                    {note.accidentalDisplayGlyph ?? note.accidentalGlyph}
                  </text>
                )}
                <ellipse
                  className={`staff-lane__head${note.hollow ? ' staff-lane__head--hollow' : ''}${note.stemless ? ' staff-lane__head--whole' : ''}`}
                  cx={note.x + note.xOffset}
                  cy={note.y}
                  rx={(note.stemless ? NOTEHEAD_RX * 1.14 : NOTEHEAD_RX) * (note.status === 'current' ? CURRENT_HEAD_SCALE : 1)}
                  ry={note.status === 'current' ? NOTEHEAD_RY * CURRENT_HEAD_SCALE : NOTEHEAD_RY}
                  transform={`rotate(-14 ${note.x + note.xOffset} ${note.y})`}
                />
              </g>
            ))}
            {dots.map((dot) => (
              <circle
                key={dot.id}
                className={`staff-lane__augmentation-dot staff-lane__note--${dot.status ?? 'upcoming'}`}
                cx={dot.cx}
                cy={dot.cy}
                r={dot.r}
              />
            ))}
            {noteMarkings.map((marking) => {
              const className = `staff-lane__articulation staff-lane__articulation--${marking.kind} staff-lane__note--${marking.status ?? 'upcoming'}`
              if (marking.shape === 'dot') {
                return (
                  <circle
                    key={marking.id}
                    className={className}
                    cx={marking.x}
                    cy={marking.y}
                    r={marking.r}
                  />
                )
              }
              if (marking.shape === 'line') {
                return (
                  <line
                    key={marking.id}
                    className={className}
                    x1={marking.x1}
                    x2={marking.x2}
                    y1={marking.y1}
                    y2={marking.y2}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              }
              return (
                <text
                  key={marking.id}
                  className={className}
                  x={marking.x}
                  y={marking.y}
                  fontSize={marking.fontSize}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {marking.text}
                </text>
              )
            })}
          </g>

          {/* Static layer: staff lines + clefs (never moves). The mask hides
              already-played notes sliding under the clef/time-signature zone. */}
          <g className="staff-lane__static">
            <rect
              className="staff-lane__mask"
              x={0}
              y={-STAFF_LINE_GAP * STAFF_MASK_OVERDRAW_GAPS}
              width={staticMaskWidth}
              height={geometry.height + STAFF_LINE_GAP * STAFF_MASK_OVERDRAW_GAPS * 2}
            />
            {!usesSourceSystems && geometry.lines.map((y) => (
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
            {!usesSourceSystems && treble && (
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
            {!usesSourceSystems && bass && (
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
            {!usesSourceSystems && keySignatureMarks.map((mark) => (
              <text
                key={mark.id}
                className={`staff-lane__key-accidental staff-lane__key-accidental--${mark.type}`}
                data-key-accidental={mark.type}
                data-key-cancellation={mark.cancellation || undefined}
                x={SYSTEM_PREFIX_KEY_X + mark.column * SYSTEM_PREFIX_KEY_COLUMN_WIDTH}
                y={mark.y}
                fontSize={STAFF_LINE_GAP * 1.45}
                dominantBaseline="middle"
                textAnchor="middle"
              >
                {mark.glyph}
              </text>
            ))}
            {!usesSourceSystems && timeSignature &&
              Object.values(geometry.staves).map((staff) => (
                <g key={staff.kind} className="staff-lane__timesig">
                  <text
                    x={timeSignatureX}
                    y={staff.lines[1]}
                    fontSize={STAFF_LINE_GAP * 2.2}
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {timeSignature.beats}
                  </text>
                  <text
                    x={timeSignatureX}
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

          {/* Moving playhead: outside the scrolling group, painted on top. */}
          <line
            ref={playheadRef}
            className="staff-lane__playhead score-follow-bar__line score-follow-bar__line--svg"
            data-score-follow-bar="true"
            x1={playheadX}
            x2={playheadX}
            y1={STAFF_LINE_GAP}
            y2={geometry.height - STAFF_LINE_GAP}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </div>
  )
}

export default memo(StaffVisualLane)
