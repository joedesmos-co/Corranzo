/**
 * Phase 3 — observation-only written vs sounding duration fields for ScoreGraph IR.
 * Reads runtime events; never mutates them or MusicXML output.
 *
 * `durationDivisions` on each node remains the runtime-committed notation value.
 * `writtenDurationDivisions` / `soundingReleaseDivision` split what the page shows
 * from when the pitch stops sounding (ties, gap-to-next sustain).
 */

export const DURATION_SOURCE = {
  EVENT_NOTATION: 'event-notation',
  BEAM_LADDER: 'beam-ladder',
  GAP_TO_NEXT_ONSET: 'gap-to-next-onset',
  INFERRED_SUSTAIN: 'inferred-sustain',
}

export const RELEASE_SOURCE = {
  WRITTEN_END: 'written-end',
  TIE_SUSTAIN: 'tie-sustain',
  GAP_TO_NEXT_ONSET: 'gap-to-next-onset',
  MEASURE_BOUNDARY: 'measure-boundary',
}

export const TIE_SUSTAIN_SOURCE = {
  NONE: null,
  TIE_START: 'tie-start',
  TIE_STOP: 'tie-stop',
  TIE_MIDDLE: 'tie-middle',
}

const STANDARD_LADDER = new Set([1, 2, 3, 4, 6, 8, 12, 16])

function voiceForClef(clef) {
  return clef === 'bass' ? 2 : 1
}

function noteKey(note) {
  return `${note.midi}|${note.clef ?? 'treble'}`
}

function collectVoiceOnsets(events = [], clef) {
  const onsets = []
  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      if ((note.clef ?? 'treble') === clef) {
        onsets.push({
          onset: event.startDivision ?? 0,
          duration: event.durationDivisions ?? 0,
          note,
          event,
        })
      }
    }
  }
  onsets.sort((left, right) => left.onset - right.onset)
  return onsets
}

function nextOnsetInVoice(onsets, afterOnset) {
  for (const entry of onsets) {
    if (entry.onset > afterOnset) {
      return entry.onset
    }
  }
  return null
}

function tieChainReleaseDivision(onsets, startIndex, totalDivisions) {
  const start = onsets[startIndex]
  let release = start.onset + start.duration
  let index = startIndex
  while (index + 1 < onsets.length) {
    const current = onsets[index]
    const next = onsets[index + 1]
    if (noteKey(next.note) !== noteKey(start.note)) {
      break
    }
    if (!current.note.tieStart && !next.note.tieStop) {
      break
    }
    release = next.onset + next.duration
    index += 1
    if (!next.note.tieStart) {
      break
    }
  }
  return Math.min(release, totalDivisions)
}

function inferDurationSource(event, written, gapToNext) {
  if ((event.beams?.length ?? 0) > 0 && written <= 4) {
    return DURATION_SOURCE.BEAM_LADDER
  }
  if (
    gapToNext != null &&
    gapToNext > 0 &&
    written === gapToNext &&
    !STANDARD_LADDER.has(written)
  ) {
    return DURATION_SOURCE.GAP_TO_NEXT_ONSET
  }
  if (gapToNext != null && gapToNext > 0 && written === gapToNext && written > 4) {
    return DURATION_SOURCE.INFERRED_SUSTAIN
  }
  return DURATION_SOURCE.EVENT_NOTATION
}

function tieSustainRole(note) {
  if (note.tieStart && note.tieStop) {
    return TIE_SUSTAIN_SOURCE.TIE_MIDDLE
  }
  if (note.tieStart) {
    return TIE_SUSTAIN_SOURCE.TIE_START
  }
  if (note.tieStop) {
    return TIE_SUSTAIN_SOURCE.TIE_STOP
  }
  return TIE_SUSTAIN_SOURCE.NONE
}

/**
 * Observation-only duration split for one notehead against its parent event.
 */
export function observeNoteheadDuration({
  note,
  event,
  events = [],
  totalDivisions = 16,
}) {
  const onset = event.startDivision ?? 0
  const written = event.durationDivisions ?? 0
  const clef = note.clef ?? 'treble'
  const voiceOnsets = collectVoiceOnsets(events, clef)
  const gapToNext = nextOnsetInVoice(voiceOnsets, onset)
  const gapSpan = gapToNext != null ? gapToNext - onset : totalDivisions - onset

  const durationSource = inferDurationSource(event, written, gapToNext != null ? gapSpan : null)
  let soundingReleaseDivision = onset + written
  let releaseSource = RELEASE_SOURCE.WRITTEN_END

  const startIndex = voiceOnsets.findIndex(
    (entry) => entry.onset === onset && noteKey(entry.note) === noteKey(note),
  )
  if (note.tieStart && startIndex >= 0) {
    soundingReleaseDivision = tieChainReleaseDivision(voiceOnsets, startIndex, totalDivisions)
    releaseSource = RELEASE_SOURCE.TIE_SUSTAIN
  } else if (durationSource === DURATION_SOURCE.GAP_TO_NEXT_ONSET) {
    soundingReleaseDivision = onset + gapSpan
    releaseSource = RELEASE_SOURCE.GAP_TO_NEXT_ONSET
  } else if (gapToNext == null) {
    releaseSource = RELEASE_SOURCE.MEASURE_BOUNDARY
  }

  return {
    writtenDurationDivisions: written,
    soundingReleaseDivision,
    durationSource,
    releaseSource,
    tieSustainSource: tieSustainRole(note),
    gapToNextOnset: gapToNext,
    gapSpanDivisions: gapToNext != null ? gapSpan : totalDivisions - onset,
  }
}

export function observeRestDuration({ event, totalDivisions = 16 }) {
  const onset = event.startDivision ?? 0
  const written = event.durationDivisions ?? 0
  return {
    writtenDurationDivisions: written,
    soundingReleaseDivision: Math.min(onset + written, totalDivisions),
    durationSource: DURATION_SOURCE.EVENT_NOTATION,
    releaseSource:
      onset + written >= totalDivisions
        ? RELEASE_SOURCE.MEASURE_BOUNDARY
        : RELEASE_SOURCE.WRITTEN_END,
    tieSustainSource: TIE_SUSTAIN_SOURCE.NONE,
    gapToNextOnset: null,
    gapSpanDivisions: null,
  }
}

/**
 * Tie chains within one measure (observation for Gymnopédie / clean fixture traces).
 */
export function traceTieChainsInMeasure(events = [], { measureNumber = null } = {}) {
  const chains = []
  const byKey = new Map()

  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      if (!note.tieStart && !note.tieStop) {
        continue
      }
      const key = noteKey(note)
      if (!byKey.has(key)) {
        byKey.set(key, [])
      }
      byKey.get(key).push({
        measureNumber,
        onsetDivision: event.startDivision ?? 0,
        writtenDurationDivisions: event.durationDivisions ?? 0,
        tieStart: Boolean(note.tieStart),
        tieStop: Boolean(note.tieStop),
        midi: note.midi,
        clef: note.clef ?? 'treble',
      })
    }
  }

  for (const [key, segments] of byKey) {
    segments.sort((left, right) => left.onsetDivision - right.onsetDivision)
    if (segments.length < 2 && !segments[0]?.tieStart) {
      continue
    }
    chains.push({
      pitchKey: key,
      segmentCount: segments.length,
      segments,
      spansBar: segments.some((segment) => segment.tieStart) && segments.some((segment) => segment.tieStop),
    })
  }

  return chains.sort((left, right) => left.segments[0].onsetDivision - right.segments[0].onsetDivision)
}

export function summarizeDurationObservation(measureGraphs = []) {
  let nodesWithSplit = 0
  let tieNodes = 0
  let gapToNextNodes = 0
  let beamLadderNodes = 0
  const tieChains = []

  for (const measure of measureGraphs) {
    tieChains.push(
      ...traceTieChainsInMeasure(
        (measure.nodes ?? [])
          .filter((node) => node.kind === 'notehead' || node.kind === 'rest')
          .map((node) => {
            if (node.kind === 'rest') {
              return {
                type: 'rest',
                startDivision: node.onsetDivision,
                durationDivisions: node.durationDivisions,
              }
            }
            return {
              type: 'note',
              startDivision: node.onsetDivision,
              durationDivisions: node.durationDivisions,
              notes: [{ midi: node.midi, clef: node.clef, tieStart: node.tieStart, tieStop: node.tieStop }],
            }
          }),
        { measureNumber: measure.measureNumber },
      ),
    )

    for (const node of measure.nodes ?? []) {
      if (node.kind !== 'notehead' && node.kind !== 'rest') {
        continue
      }
      if (node.durationSource === DURATION_SOURCE.GAP_TO_NEXT_ONSET) {
        gapToNextNodes += 1
      }
      if (node.durationSource === DURATION_SOURCE.BEAM_LADDER) {
        beamLadderNodes += 1
      }
      if (node.tieSustainSource) {
        tieNodes += 1
      }
      if (
        node.writtenDurationDivisions != null &&
        node.soundingReleaseDivision != null &&
        node.soundingReleaseDivision !== (node.onsetDivision ?? 0) + node.writtenDurationDivisions
      ) {
        nodesWithSplit += 1
      }
    }
  }

  return {
    nodesWithWrittenSoundingSplit: nodesWithSplit,
    tieNodes,
    gapToNextNodes,
    beamLadderNodes,
    tieChainCount: tieChains.length,
    tieChains: tieChains.slice(0, 24),
  }
}
