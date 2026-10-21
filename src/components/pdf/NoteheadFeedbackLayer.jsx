import { Fragment, memo } from 'react'
import {
  NOTEHEAD_FEEDBACK_COLORS,
  feedbackColorForState,
  noteheadBoxesForEntry,
  noteheadGeometryForShape,
} from '../../features/practice/noteheadFeedback.js'

/**
 * One engraved notehead, painted with the musician's own feedback.
 *
 * The shape is the notehead's own (filled / half / whole) and it is drawn
 * exactly over the printed head, so the score itself reports what was played.
 * Nothing floats above the staff.
 */
export const NoteheadFeedback = memo(function NoteheadFeedback({
  rect,
  shape,
  color,
  focus = false,
}) {
  if (!rect) {
    return null
  }
  const geometry = noteheadGeometryForShape(shape)
  const width = (rect.x1 - rect.x0) * 100
  const height = (rect.y1 - rect.y0) * 100
  if (!(width > 0) || !(height > 0)) {
    return null
  }
  return (
    <div
      className="cz-notehead"
      style={{
        left: `${rect.x0 * 100}%`,
        top: `${rect.y0 * 100}%`,
        width: `${width}%`,
        height: `${height}%`,
      }}
      data-cz-notehead-shape={shape}
      data-cz-notehead-state={color ? 'feedback' : focus ? 'focus' : 'plain'}
      aria-hidden="true"
    >
      <svg
        className="cz-notehead__svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {focus ? (
          <ellipse
            className="cz-notehead__focus"
            cx={geometry.cx}
            cy={geometry.cy}
            rx={geometry.rx}
            ry={geometry.ry}
          />
        ) : null}
        {color ? (
          <ellipse
            className="cz-notehead__glyph"
            cx={geometry.cx}
            cy={geometry.cy}
            rx={geometry.rx}
            ry={geometry.ry}
            fill={geometry.filled ? color : 'none'}
            stroke={geometry.filled ? 'none' : color}
            strokeWidth={geometry.filled ? 0 : 9}
          />
        ) : null}
      </svg>
    </div>
  )
})

/** A short, human description of the event's state for assistive tooling. */
function describeEvent(entry, state) {
  const checkpoint = entry?.checkpoint
  const measure = checkpoint?.measureNumber ?? ''
  const label = checkpoint?.displayLabel ?? checkpoint?.detailsLabel ?? checkpoint?.label ?? ''
  switch (state) {
    case 'completed':
      return `Played${label ? ` ${label}` : ''} at measure ${measure}`
    case 'wrong':
      return `Try again${label ? `: ${label}` : ''} at measure ${measure}`
    case 'missed':
      return `Missed${label ? ` ${label}` : ''} at measure ${measure}`
    default:
      return `Play${label ? ` ${label}` : ''} at measure ${measure}`
  }
}

/** The union of a set of notehead rects — the event's own column. */
function unionRect(rects) {
  const valid = rects.filter((rect) => rect && Number.isFinite(rect.x0))
  if (valid.length === 0) {
    return null
  }
  return {
    x0: Math.min(...valid.map((rect) => rect.x0)),
    y0: Math.min(...valid.map((rect) => rect.y0)),
    x1: Math.max(...valid.map((rect) => rect.x1)),
    y1: Math.max(...valid.map((rect) => rect.y1)),
  }
}

/**
 * The feedback layer for one page.
 *
 * For every practice event the engine has decided something about, the
 * layer paints each of that event's noteheads in its own state colour. The
 * note keeps its engraved shape and its place on the staff: nothing floats
 * above the staff, and no box is drawn around a note.
 *
 * A note the musician played is blue. A note that is still expected keeps
 * its black engraving and gains only a soft focus ring. A wrong attempt
 * flashes the required notehead red — it never lights a correct note and
 * never advances the score.
 */
export default function NoteheadFeedbackLayer({ entries = [] }) {
  const groups = []
  for (const entry of entries) {
    const target = entry?.target
    if (!target?.visible) {
      continue
    }
    const state = entry?.state ?? null
    const boxes = noteheadBoxesForEntry(entry)
    if (boxes.length === 0) {
      continue
    }
    const toneStates = Array.isArray(entry?.toneStates) ? entry.toneStates : null
    const completedMidis = new Set(
      (toneStates ?? []).filter((tone) => tone.completed).map((tone) => Number(tone.midi)),
    )
    const heads = []
    for (const box of boxes) {
      let color = toneStates ? null : feedbackColorForState(state)
      if (toneStates) {
        // A chord's members light up individually as they are recognized.
        color = completedMidis.has(Number(box.midi)) ? NOTEHEAD_FEEDBACK_COLORS.correct : null
      }
      const focus = !color && (state === 'current' || state === 'current-partial')
      if (!color && !focus) {
        continue
      }
      heads.push({ box, color, focus })
    }
    if (heads.length === 0) {
      continue
    }
    const expect = Array.isArray(entry?.checkpoint?.expectedMidis)
      ? entry.checkpoint.expectedMidis
      : entry?.checkpoint?.expectedMidi != null
        ? [entry.checkpoint.expectedMidi]
        : []
    groups.push({
      key: entry.key ?? entry.target.targetKey ?? 'note',
      state,
      expected: expect.filter((midi) => Number.isFinite(midi)).join(','),
      mode: target.mode ?? undefined,
      targetKey: target.targetKey ?? undefined,
      union: unionRect(heads.map((head) => head.box.rect)),
      label: describeEvent(entry, state),
      heads,
    })
  }
  if (groups.length === 0) {
    return null
  }
  return (
    <div className="cz-notehead-layer">
      {groups.map((group) => (
        <Fragment key={group.key}>
          {/* The event's own marker: it carries the event's geometry and its
              state for assistive tooling and tests, and draws NOTHING. The
              visible feedback is the notehead itself. */}
          <div
            className="cz-notehead-event"
            data-score-note-state={group.state ?? undefined}
            data-score-expected={group.expected}
            data-practice-note-mode={group.mode}
            data-practice-note-target-key={group.targetKey}
            role="img"
            aria-label={group.label}
            style={
              group.union
                ? {
                    left: `${group.union.x0 * 100}%`,
                    top: `${group.union.y0 * 100}%`,
                    width: `${(group.union.x1 - group.union.x0) * 100}%`,
                    height: `${(group.union.y1 - group.union.y0) * 100}%`,
                  }
                : undefined
            }
          />
          {group.heads.map((head, index) => (
            <NoteheadFeedback
              key={`${group.key}:${index}`}
              rect={head.box.rect}
              shape={head.box.shape}
              color={head.color}
              focus={head.focus}
            />
          ))}
        </Fragment>
      ))}
    </div>
  )
}
