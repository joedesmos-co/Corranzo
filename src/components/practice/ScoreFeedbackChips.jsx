import { memo } from 'react'
import { SCORE_NOTE_STATE } from '../../features/practice/scoreNoteStates.js'
import { getExpectedMidis } from '../../features/practice/waitForYouNoteMatch.js'
import { midiToNoteLabel } from '../../features/midi-input/midiNoteLabel.js'
import { NOTEHEAD_FEEDBACK_COLORS } from '../../features/practice/noteheadFeedback.js'

/**
 * Practice feedback for surfaces that cannot paint the notehead itself.
 *
 * A PDF page is a raster canvas: its noteheads are printed ink, not addressable
 * glyphs. Drawing a replacement note shape there produces a marker that floats
 * near — but not on — the printed note, which reads as a bug. So the PDF
 * surface keeps the printed notation black and untouched, and the musician's
 * recognition is reported HERE, in the practice controls, where it is exact:
 * the engine already knows which note it asked for and which note was played.
 *
 * This is the same information the engraved (OSMD/MusicXML) surface paints on
 * the real notehead glyphs, so both surfaces tell the musician the same story:
 * a blue note was played correctly, a red note was wrong or missed, and the
 * outlined note is the one waiting for you.
 *
 * Chord members are separate chips, so a half-played chord reads correctly and
 * an unplayed member is never mistaken for a played one. Repeated notes are
 * separate checkpoints, so each occurrence gets its own chip in order.
 */

const CHIP_STATE_CLASS = {
  [SCORE_NOTE_STATE.COMPLETED]: 'workspace-score-feedback__chip--completed',
  [SCORE_NOTE_STATE.CURRENT]: 'workspace-score-feedback__chip--current',
  [SCORE_NOTE_STATE.CURRENT_PARTIAL]: 'workspace-score-feedback__chip--current',
  [SCORE_NOTE_STATE.WRONG]: 'workspace-score-feedback__chip--wrong',
  [SCORE_NOTE_STATE.MISSED]: 'workspace-score-feedback__chip--missed',
}

/**
 * The chip palette is the SAME palette the engraved surface paints on the real
 * notehead glyphs, so both surfaces report a note identically: blue is
 * reserved for "played correctly", red for "wrong or missed", and a note that
 * is still waiting keeps the neutral engraving colour.
 */
function chipStyle(state) {
  switch (state) {
    case SCORE_NOTE_STATE.COMPLETED:
      return {
        background: NOTEHEAD_FEEDBACK_COLORS.correct,
        borderColor: NOTEHEAD_FEEDBACK_COLORS.correct,
        color: '#f4f7ff',
      }
    case SCORE_NOTE_STATE.WRONG:
    case SCORE_NOTE_STATE.MISSED:
      return {
        background: 'transparent',
        borderColor: NOTEHEAD_FEEDBACK_COLORS.missed,
        color: '#f0a9a9',
      }
    default:
      return {
        background: 'transparent',
        borderColor: '#6d7a66',
        color: '#d7ddcd',
      }
  }
}

function describeChip(state, label) {
  switch (state) {
    case SCORE_NOTE_STATE.COMPLETED:
      return `Played ${label}`
    case SCORE_NOTE_STATE.WRONG:
      return `Try again ${label}`
    case SCORE_NOTE_STATE.MISSED:
      return `Missed ${label}`
    default:
      return `Play ${label}`
  }
}

/**
 * The notes of one practice event, split into chord members.
 *
 * `toneStates` carries the engine's per-member recognition for the current
 * chord. When it is absent the event is a single note (or a chord whose
 * members have not been separated yet) and every member is still expected.
 */
function chipsForEntry(entry) {
  const checkpoint = entry?.checkpoint ?? null
  const expected = getExpectedMidis(checkpoint)
  const toneStates = Array.isArray(entry?.toneStates) ? entry.toneStates : null
  const completedMidis = new Set(
    (toneStates ?? []).filter((tone) => tone.completed).map((tone) => Number(tone.midi)),
  )
  const hasToneDetail = toneStates != null && toneStates.length > 0
  const midis = expected.length > 0 ? expected : []
  return midis.map((midi) => {
    const done = hasToneDetail ? completedMidis.has(Number(midi)) : false
    const state = done ? SCORE_NOTE_STATE.COMPLETED : entry?.state ?? SCORE_NOTE_STATE.CURRENT
    return { midi, state, label: midiToNoteLabel(midi) }
  })
}

function ScoreFeedbackChips({ entries = [], max = 18 }) {
  const chips = []
  for (const entry of entries) {
    const entryChips = chipsForEntry(entry)
    for (const chip of entryChips) {
      chips.push({ ...chip, key: `${entry.key ?? 'entry'}:${chip.midi}` })
    }
  }
  if (chips.length === 0) {
    return null
  }
  // Keep the most recent decisions visible; the score itself holds the history.
  const visible = chips.slice(-max)
  const hidden = chips.length - visible.length
  return (
    <div
      className="workspace-score-feedback"
      role="status"
      aria-live="polite"
      data-score-feedback="true"
      data-score-feedback-count={chips.length}
    >
      <span className="workspace-score-feedback__label">Notes</span>
      <div className="workspace-score-feedback__chips">
        {hidden > 0 ? (
          <span className="workspace-score-feedback__more" aria-hidden="true">
            +{hidden}
          </span>
        ) : null}
        {visible.map((chip) => (
          <span
            key={chip.key}
            className={`workspace-score-feedback__chip ${CHIP_STATE_CLASS[chip.state] ?? ''}`}
            style={chipStyle(chip.state)}
            data-score-feedback-state={chip.state}
            data-score-feedback-midi={chip.midi}
            aria-label={describeChip(chip.state, chip.label)}
            title={describeChip(chip.state, chip.label)}
          >
            {chip.state === SCORE_NOTE_STATE.COMPLETED ? (
              <span className="workspace-score-feedback__tick" aria-hidden="true">
                ✓
              </span>
            ) : null}
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default memo(ScoreFeedbackChips)
