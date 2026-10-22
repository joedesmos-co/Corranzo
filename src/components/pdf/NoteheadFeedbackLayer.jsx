/**
 * Accessible practice feedback for a PDF page.
 *
 * A PDF page is a raster canvas: the noteheads are printed ink, not
 * addressable glyphs, and their geometry in the score pipeline is an
 * ESTIMATE. Drawing a replacement note shape at that estimate produces a
 * marker that floats near — but not on — the printed note, which reads as a
 * bug (measured: tens of pixels away, over blank paper and over the time
 * signature). So the PDF surface never fabricates noteheads.
 *
 * The printed notation stays black and untouched, the red playback cursor
 * keeps marking the musical position, and the recognition result is reported
 * in the practice controls (ScoreFeedbackChips) — where it is exact, because
 * the engine already knows which note it asked for and which note was played.
 *
 * The engraved (OSMD/MusicXML) surface is different: there the noteheads ARE
 * addressable glyphs, so the real glyph is painted with the real state.
 */
import { describeScoreNoteEntry } from '../../features/practice/noteheadFeedback.js'
import { getExpectedMidis } from '../../features/practice/waitForYouNoteMatch.js'

export default function NoteheadFeedbackLayer({ entries = [] }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null
  }
  return (
    <div className="sr-only" data-pdf-feedback="text-only">
      {entries.map((entry, index) => {
        const expected = getExpectedMidis(entry?.checkpoint)
        const toneStates = Array.isArray(entry?.toneStates) ? entry.toneStates : null
        const completedTones = toneStates
          ? toneStates.filter((tone) => tone.completed).length
          : null
        return (
          <span
            key={entry.key ?? entry?.target?.targetKey ?? index}
            data-score-note-state={entry.state ?? undefined}
            data-score-expected={expected.join(',')}
            data-score-tone-completed={completedTones ?? undefined}
            data-practice-note-target-key={entry?.target?.targetKey}
            data-practice-note-mode={entry?.target?.mode}
          >
            {describeScoreNoteEntry(entry)}
          </span>
        )
      })}
    </div>
  )
}
