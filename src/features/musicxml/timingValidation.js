/**
 * Measure-timing validation (H1/H2 integrity).
 *
 * A measure is OVERFULL when its written NOTE content cannot fit the
 * time-signature window: the parser advances the part cursor by each note's
 * duration (true MusicXML model), so a voice-flattened export — two voices
 * sequenced into one stream without `<voice>`/`<backup>` — lays measure N's
 * notes past its own barline and cumulatively drifts every later measure.
 *
 * This module is a SOURCE-FIDELITY VERDICT, not a timing change:
 * - It never re-times, truncates, overlaps, or normalizes anything.
 * - The performed timeline keeps exactly what the file says.
 * - Consumers (e.g. Wait For You checkpoint grouping) use the verdict to
 *   avoid requirements a player reading the print cannot satisfy.
 *
 * Classification (evidence available IN the file, per overfull measure):
 * - `unvoiced-flattened`: no `<voice>`, no `<backup>` in the measure — voice
 *   structure was destroyed upstream (music21 MIDI→MusicXML flattening).
 *   In-file repair is impossible; only an authoritative external source can.
 * - `voiced-without-backup`: `<voice>` tags present but no `<backup>` — the
 *   parts of two voices are sequenced; which voice owns which note is unknown
 *   from onsets alone.
 * - `backup-without-voices`: the file uses backups elsewhere but this measure
 *   lost both voice tags and backup — same defect, rarer shape.
 * - `voiced-with-backup`: voices and backups present, yet a voice itself
 *   exceeds the window — the measure's content is genuinely overlong or the
 *   voice split is wrong upstream.
 */

export const TIMING_VALIDATION_STATUS = {
  VALID: 'valid',
  INVALID: 'invalid',
}

export const OVERFULL_CLASSIFICATION = {
  UNVOICED_FLATTENED: 'unvoiced-flattened',
  VOICED_WITHOUT_BACKUP: 'voiced-without-backup',
  BACKUP_WITHOUT_VOICES: 'backup-without-voices',
  VOICED_WITH_BACKUP: 'voiced-with-backup',
}

const EPSILON_QUARTERS = 1e-6

function round3(value) {
  return Math.round(value * 1000) / 1000
}

function classifyOverfullMeasure({ voices, hasBackup }) {
  const voiced = Array.isArray(voices) && voices.length > 0
  if (voiced) {
    return hasBackup
      ? OVERFULL_CLASSIFICATION.VOICED_WITH_BACKUP
      : OVERFULL_CLASSIFICATION.VOICED_WITHOUT_BACKUP
  }
  return hasBackup
    ? OVERFULL_CLASSIFICATION.BACKUP_WITHOUT_VOICES
    : OVERFULL_CLASSIFICATION.UNVOICED_FLATTENED
}

/**
 * @param {Array} measures parsed measure boundaries (primary part window map)
 * @param {Map<string, Array>} partMeasureNoteEnds written note-content extents
 *   per part: [{ index, number, endQuarters, noteCount, voices, hasBackup }]
 * @returns {{ status: string, overfullMeasures: Array, summary: object }}
 */
export function validateMeasureTiming(measures, partMeasureNoteEnds) {
  const boundaries = Array.isArray(measures) ? measures : []
  const parts = partMeasureNoteEnds instanceof Map ? partMeasureNoteEnds : null
  if (!boundaries.length || !parts) {
    return {
      status: TIMING_VALIDATION_STATUS.VALID,
      overfullMeasures: [],
      summary: {
        assessedMeasures: boundaries.length,
        overfullMeasureCount: 0,
        totalExcessQuarters: 0,
        worstExcessQuarters: 0,
        classifications: {},
      },
    }
  }

  const boundaryByIndex = new Map(boundaries.map((boundary) => [boundary.index, boundary]))
  const overfullMeasures = []

  for (const [partId, entries] of parts) {
    for (const entry of entries) {
      const boundary = boundaryByIndex.get(entry.index)
      if (!boundary) {
        // Secondary part has more measures than the primary part — the file's
        // measure counts disagree. Not an overfull finding; repeat expansion
        // and note ownership already handle mismatches downstream.
        continue
      }
      const nominalQuarters = boundary.lengthQuarters
      if (!(entry.endQuarters > nominalQuarters + EPSILON_QUARTERS)) {
        continue
      }
      overfullMeasures.push({
        measureNumber: boundary.number,
        measureIndex: entry.index,
        partId,
        notatedNoteEndQuarters: round3(entry.endQuarters),
        nominalQuarters,
        excessQuarters: round3(entry.endQuarters - nominalQuarters),
        noteCount: entry.noteCount,
        voiceTags: entry.voices ?? [],
        hasBackup: Boolean(entry.hasBackup),
        classification: classifyOverfullMeasure(entry),
      })
    }
  }

  overfullMeasures.sort((left, right) =>
    left.measureIndex - right.measureIndex || String(left.partId).localeCompare(String(right.partId)),
  )

  const classifications = overfullMeasures.reduce((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1
    return acc
  }, {})

  return {
    status: overfullMeasures.length > 0 ? TIMING_VALIDATION_STATUS.INVALID : TIMING_VALIDATION_STATUS.VALID,
    overfullMeasures,
    summary: {
      assessedMeasures: boundaries.length,
      overfullMeasureCount: overfullMeasures.length,
      totalExcessQuarters: round3(
        overfullMeasures.reduce((sum, row) => sum + row.excessQuarters, 0),
      ),
      worstExcessQuarters: round3(
        overfullMeasures.reduce((max, row) => Math.max(max, row.excessQuarters), 0),
      ),
      classifications,
      primaryClassification:
        overfullMeasures.length > 0 ? overfullMeasures[0].classification : null,
    },
  }
}

/**
 * Validation verdict for a parsed timing map. Prefers the verdict computed at
 * parse time; recomputes from measure data for timing maps built elsewhere
 * (OMR / fixture builders) so the fallback is never silently skipped.
 */
export function getTimingValidation(timingMap) {
  if (timingMap?.timingValidation) {
    return timingMap.timingValidation
  }
  return validateMeasureTiming(
    timingMap?.measures ?? [],
    timingMap?.partMeasureNoteEnds ?? null,
  )
}

/** True when note-grouping consumers must not trust cross-measure onsets. */
export function timingIsInvalid(timingMap) {
  return getTimingValidation(timingMap).status === TIMING_VALIDATION_STATUS.INVALID
}

/**
 * Musician-facing copy for an invalidated score. Honest about what is wrong
 * (the file, not the player) and what the app does about it (plays the file's
 * timing, matches per printed measure). No invented precision.
 */
export function timingNoticeFor(timingMap) {
  const validation = getTimingValidation(timingMap)
  if (validation.status !== TIMING_VALIDATION_STATUS.INVALID) {
    return null
  }
  const count = validation.summary?.overfullMeasureCount ?? validation.overfullMeasures?.length ?? 0
  const worst = validation.summary?.worstExcessQuarters ?? 0
  const scale = worst >= 1 ? 'systematically' : 'in a few measures'
  return (
    `This score's file has ${count} measure${count === 1 ? '' : 's'} with more notes than fit ` +
    `${scale}. Playback follows the file's timing; Wait For You asks for one measure's notes at a time. ` +
    'The printed score may not line up with what you hear.'
  )
}
