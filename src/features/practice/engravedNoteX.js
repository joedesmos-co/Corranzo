import { clamp, lerp } from '../score-follow/scoreFollowEasing.js'

/**
 * ONE mapping from an engraved MusicXML default-x (tenths from the left edge
 * of its measure) to a horizontal position inside a measure's span.
 *
 * The painted red playback cursor and the note target MUST resolve the same
 * note through the same mapping. They used to differ — the cursor subtracted
 * the first onset's default-x and extrapolated the barline, while the note
 * target used the absolute default-x over the engraved measure width — so the
 * line ran up to ~95 px AHEAD of the notehead it was supposed to trigger, and
 * the drift reset on every new note. Sharing this function removes the second
 * geometry truth.
 */

/**
 * @param defaultX  engraved default-x in tenths (null when unavailable)
 * @param layoutExtents  from getMeasureLayoutExtents(timingMap, measureNumber)
 * @param xStart  measure span start (normalized page x)
 * @param xEnd    measure span end (normalized page x)
 * @returns normalized x, or null when the note has no engraved x
 */
export function resolveEngravedNoteXInMeasure({
  defaultX,
  layoutExtents,
  xStart,
  xEnd,
}) {
  if (defaultX == null || !layoutExtents?.hasDefaultX) {
    return null
  }
  const maxDefaultX = layoutExtents.maxDefaultX ?? defaultX
  // MusicXML <measure width> is authoritative; otherwise estimate a plausible
  // engraved width from the rightmost note.
  const engravedWidth = layoutExtents.engravedWidth
  const widthTenths =
    Number.isFinite(engravedWidth) && engravedWidth > 0
      ? engravedWidth
      : Math.max(maxDefaultX + Math.max(40, maxDefaultX * 0.15), 80)
  const ratio = clamp(defaultX / widthTenths, 0, 1)
  return lerp(xStart, xEnd, ratio)
}
