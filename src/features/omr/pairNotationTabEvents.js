import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'

/**
 * Notation + TAB pairing for fretted-instrument OMR.
 *
 * Rhythm, duration, ties, slurs, and articulations stay on the notation event.
 * TAB supplies string, fret, and sounding pitch only. One notation note plus one
 * TAB digit becomes one combined playback note — never two.
 */

export const NOTATION_TAB_PAIRING_LOW_CONFIDENCE_MESSAGE =
  'Some notation could not be paired with TAB.'

const DEFAULT_BEAT_CLUSTER_TOLERANCE = 0.055
const DEFAULT_ONSET_X_TOLERANCE = 24
const MIN_ONSET_PAIR_SCORE = 0.3
const MIN_NOTE_PAIR_SCORE = 0.38
const LOW_CONFIDENCE_THRESHOLD = 0.55
const DEFAULT_WRITTEN_OCTAVE_OFFSET = -1

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function average(values) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) {
    return 0
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function pitchMatches(left, right, tolerance = 1) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false
  }
  return Math.abs(left - right) <= tolerance
}

function eventCx(event) {
  const notes = event?.notes ?? []
  if (notes.length) {
    return average(notes.map((note) => note.cx).filter(Number.isFinite))
  }
  return Number.isFinite(event?.cx) ? event.cx : null
}

function notationEventPosition(event, totalDivisions) {
  if (Number.isFinite(event?.positionInMeasure)) {
    return clamp(event.positionInMeasure, 0, 1)
  }
  if (Number.isFinite(event?.startDivision) && totalDivisions > 0) {
    return clamp(event.startDivision / totalDivisions, 0, 1)
  }
  return null
}

function tabOnsetPosition(tabNotes) {
  return average(tabNotes.map((note) => note.positionInMeasure).filter(Number.isFinite))
}

function beamGroupKey(event) {
  const notes = event?.notes ?? []
  const beams = notes.map((note) => note.beams ?? note.beamStrength ?? 0)
  const maxBeam = beams.length ? Math.max(...beams) : 0
  if (maxBeam <= 0) {
    return null
  }
  const stem = notes.find((note) => note.stem)?.stem
  const stemDir = typeof stem === 'string' ? stem : stem?.direction ?? null
  return `${stemDir ?? 'any'}:${maxBeam}:${event.startDivision ?? 0}`
}

function clusterTabOnsets(tabNotes, { xTolerance = DEFAULT_ONSET_X_TOLERANCE } = {}) {
  if (!tabNotes?.length) {
    return []
  }
  const sorted = [...tabNotes].sort(
    (left, right) =>
      (left.positionInMeasure ?? 0) - (right.positionInMeasure ?? 0) || left.x - right.x,
  )
  const clusters = []
  for (const note of sorted) {
    const last = clusters[clusters.length - 1]
    const sameOnsetByX = last && Math.abs(note.x - last.x) <= xTolerance * 0.65
    const sameOnsetByPos =
      last &&
      Math.abs((note.positionInMeasure ?? 0) - (last.positionInMeasure ?? 0)) <=
        DEFAULT_BEAT_CLUSTER_TOLERANCE * 0.75
    if (last && (sameOnsetByX || sameOnsetByPos)) {
      last.notes.push(note)
      last.x = average(last.notes.map((entry) => entry.x))
      last.positionInMeasure = tabOnsetPosition(last.notes)
      continue
    }
    clusters.push({
      notes: [note],
      x: note.x,
      positionInMeasure: note.positionInMeasure ?? 0,
      used: false,
    })
  }
  return clusters
}

function scoreOnsetPair(notationEvent, tabCluster, { totalDivisions = 16, xTolerance = DEFAULT_ONSET_X_TOLERANCE } = {}) {
  const notationPos = notationEventPosition(notationEvent, totalDivisions)
  const tabPos = tabCluster.positionInMeasure ?? tabOnsetPosition(tabCluster.notes)
  if (notationPos == null || tabPos == null) {
    return 0
  }

  const posDistance = Math.abs(notationPos - tabPos)
  const positionScore = clamp(1 - posDistance / DEFAULT_BEAT_CLUSTER_TOLERANCE, 0, 1)

  const notationX = eventCx(notationEvent)
  const xDistance =
    Number.isFinite(notationX) && Number.isFinite(tabCluster.x)
      ? Math.abs(notationX - tabCluster.x)
      : null
  const xScore =
    xDistance == null ? 0.5 : clamp(1 - xDistance / Math.max(8, xTolerance), 0, 1)

  const notationCount = notationEvent.notes?.length ?? 0
  const tabCount = tabCluster.notes?.length ?? 0
  const sizeScore =
    notationCount === 0 || tabCount === 0
      ? 0
      : clamp(1 - Math.abs(notationCount - tabCount) / Math.max(notationCount, tabCount), 0, 1)

  const beamKey = beamGroupKey(notationEvent)
  const beamScore = beamKey ? 0.08 : 0

  return positionScore * 0.52 + xScore * 0.28 + sizeScore * 0.12 + beamScore
}

function notationTabMidiCandidates(notationMidi, writtenOctaveOffset = DEFAULT_WRITTEN_OCTAVE_OFFSET) {
  const semitones = writtenOctaveOffset * 12
  return [
    notationMidi,
    notationMidi + semitones,
    notationMidi - semitones,
    notationMidi + 12,
    notationMidi - 12,
  ]
}

function bestMidiAgreement(notationMidi, tabMidi, writtenOctaveOffset) {
  let best = 0
  for (const candidate of notationTabMidiCandidates(notationMidi, writtenOctaveOffset)) {
    if (pitchMatches(candidate, tabMidi, 1)) {
      best = Math.max(best, 1)
    } else if (pitchMatches(candidate, tabMidi, 2)) {
      best = Math.max(best, 0.62)
    }
  }
  return best
}

function scoreNotePair(notationNote, tabNote, { writtenOctaveOffset = DEFAULT_WRITTEN_OCTAVE_OFFSET } = {}) {
  const midiScore = bestMidiAgreement(notationNote.midi, tabNote.midi, writtenOctaveOffset)

  const notationX = notationNote.cx
  const xDistance =
    Number.isFinite(notationX) && Number.isFinite(tabNote.x)
      ? Math.abs(notationX - tabNote.x)
      : null
  const xScore =
    xDistance == null ? 0.35 : clamp(1 - xDistance / DEFAULT_ONSET_X_TOLERANCE, 0, 1)

  const stringBonus =
    notationNote.string != null && notationNote.string === tabNote.string ? 0.12 : 0

  if (midiScore >= 0.62) {
    return midiScore * 0.72 + xScore * 0.2 + stringBonus
  }

  // Strong horizontal agreement can rescue voicings when engraving uses written pitch.
  if (xScore >= 0.82) {
    return xScore * 0.68 + midiScore * 0.22 + stringBonus
  }

  return midiScore * 0.72 + xScore * 0.2 + stringBonus
}

function assignNotesInCluster(notationNotes, tabNotes, options = {}) {
  const assignments = []
  const usedTab = new Set()
  const sortedNotation = [...notationNotes].sort(
    (left, right) => (left.cx ?? 0) - (right.cx ?? 0) || (right.midi ?? 0) - (left.midi ?? 0),
  )

  for (const notationNote of sortedNotation) {
    let bestTab = null
    let bestScore = 0
    for (const tabNote of tabNotes) {
      if (usedTab.has(tabNote)) {
        continue
      }
      const score = scoreNotePair(notationNote, tabNote, options)
      if (score > bestScore) {
        bestScore = score
        bestTab = tabNote
      }
    }
    if (bestTab && bestScore >= MIN_NOTE_PAIR_SCORE) {
      usedTab.add(bestTab)
      assignments.push({
        notationNote,
        tabNote: bestTab,
        confidence: bestScore,
      })
    }
  }

  if (
    assignments.length < Math.min(sortedNotation.length, tabNotes.length) &&
    sortedNotation.length === tabNotes.length
  ) {
    const byPitchDesc = [...sortedNotation].sort((left, right) => (right.midi ?? 0) - (left.midi ?? 0))
    const byStringAsc = [...tabNotes].sort((left, right) => left.string - right.string)
    const fallback = []
    const usedFallbackTab = new Set()
    for (let index = 0; index < byPitchDesc.length; index += 1) {
      const notationNote = byPitchDesc[index]
      const tabNote = byStringAsc[index]
      if (usedFallbackTab.has(tabNote)) {
        continue
      }
      const score = scoreNotePair(notationNote, tabNote, options)
      if (score >= MIN_ONSET_PAIR_SCORE) {
        usedFallbackTab.add(tabNote)
        fallback.push({ notationNote, tabNote, confidence: score })
      }
    }
    if (fallback.length > assignments.length) {
      return {
        assignments: fallback,
        unmatchedNotation: sortedNotation.filter(
          (note) => !fallback.some((entry) => entry.notationNote === note),
        ),
        unmatchedTab: tabNotes.filter((note) => !usedFallbackTab.has(note)),
      }
    }
  }

  return {
    assignments,
    unmatchedNotation: sortedNotation.filter(
      (note) => !assignments.some((entry) => entry.notationNote === note),
    ),
    unmatchedTab: tabNotes.filter((note) => !usedTab.has(note)),
  }
}

function mergeCombinedNote(notationNote, tabNote, confidence) {
  return {
    ...notationNote,
    string: tabNote.string,
    fret: tabNote.fret,
    tabMidi: tabNote.midi,
    tabX: tabNote.x,
    soundingPitch: true,
    notationTabPairConfidence: confidence,
    tabPosition: { string: tabNote.string, fret: tabNote.fret },
  }
}

function combineEvent(notationEvent, assignments, onsetConfidence) {
  const assignmentByNote = new Map(
    assignments.map((entry) => [entry.notationNote, entry]),
  )
  const notes = (notationEvent.notes ?? []).map((note) => {
    const assignment = assignmentByNote.get(note)
    if (!assignment) {
      return { ...note, notationTabUnpaired: true }
    }
    return mergeCombinedNote(note, assignment.tabNote, assignment.confidence)
  })

  const pairedCount = assignments.length
  const totalCount = notationEvent.notes?.length ?? 0
  return {
    ...notationEvent,
    notes,
    notationTabOnsetConfidence: onsetConfidence,
    notationTabPairConfidence:
      pairedCount > 0
        ? average(assignments.map((entry) => entry.confidence))
        : 0,
    notationTabPairedCount: pairedCount,
    notationTabExpectedCount: totalCount,
  }
}

/**
 * Pair one measure of notation events with TAB digits.
 * Returns new events (never emits standalone TAB playback notes).
 */
export function pairNotationTabInMeasure(
  events,
  tabNotes,
  {
    beats = 4,
    beatType = 4,
    xTolerance = DEFAULT_ONSET_X_TOLERANCE,
    measureBox = null,
    writtenOctaveOffset = DEFAULT_WRITTEN_OCTAVE_OFFSET,
  } = {},
) {
  const pairingOptions = { writtenOctaveOffset }
  const totalDivisions = Math.round(beats * OMR_DIVISIONS_PER_QUARTER * (4 / beatType))
  const diagnostics = {
    notationEvents: 0,
    notationNotes: 0,
    tabDigits: tabNotes?.length ?? 0,
    pairedNotes: 0,
    unpairedNotationNotes: 0,
    unusedTabDigits: 0,
    lowConfidenceOnsets: 0,
    onsetPairs: 0,
    averageConfidence: 0,
    measureConfidence: 1,
  }

  if (!events?.length) {
    diagnostics.unusedTabDigits = tabNotes?.length ?? 0
    diagnostics.measureConfidence = tabNotes?.length ? 0 : 1
    return { events: [], diagnostics }
  }

  if (!tabNotes?.length) {
    diagnostics.notationEvents = events.filter((event) => event.type === 'note').length
    diagnostics.notationNotes = events.reduce(
      (sum, event) => sum + (event.type === 'note' ? event.notes?.length ?? 0 : 0),
      0,
    )
    diagnostics.measureConfidence = 0
    return {
      events: events.map((event) =>
        event.type === 'note'
          ? {
              ...event,
              notes: (event.notes ?? []).map((note) => ({ ...note, notationTabUnpaired: true })),
              notationTabOnsetConfidence: 0,
            }
          : event,
      ),
      diagnostics,
    }
  }

  const tabClusters = clusterTabOnsets(tabNotes, { xTolerance })
  const confidences = []
  let nextEvents = []

  for (const event of events) {
    if (event.type !== 'note' || !(event.notes?.length > 0)) {
      nextEvents.push(event)
      continue
    }

    diagnostics.notationEvents += 1
    diagnostics.notationNotes += event.notes.length

    let bestCluster = null
    let bestScore = 0
    for (const cluster of tabClusters) {
      if (cluster.used) {
        continue
      }
      const score = scoreOnsetPair(event, cluster, { totalDivisions, xTolerance })
      if (score > bestScore) {
        bestScore = score
        bestCluster = cluster
      }
    }

    if (!bestCluster || bestScore < MIN_ONSET_PAIR_SCORE) {
      diagnostics.unpairedNotationNotes += event.notes.length
      diagnostics.lowConfidenceOnsets += 1
      nextEvents.push({
        ...event,
        notes: event.notes.map((note) => ({ ...note, notationTabUnpaired: true })),
        notationTabOnsetConfidence: bestScore,
      })
      continue
    }

    bestCluster.used = true
    diagnostics.onsetPairs += 1
    const { assignments, unmatchedNotation, unmatchedTab } = assignNotesInCluster(
      event.notes,
      bestCluster.notes,
      pairingOptions,
    )
    diagnostics.pairedNotes += assignments.length
    diagnostics.unpairedNotationNotes += unmatchedNotation.length
    diagnostics.unusedTabDigits += unmatchedTab.length
    if (bestScore < LOW_CONFIDENCE_THRESHOLD) {
      diagnostics.lowConfidenceOnsets += 1
    }
    confidences.push(bestScore, ...assignments.map((entry) => entry.confidence))
    nextEvents.push(combineEvent(event, assignments, bestScore))
  }

  diagnostics.unusedTabDigits += tabClusters
    .filter((cluster) => !cluster.used)
    .reduce((sum, cluster) => sum + cluster.notes.length, 0)

  diagnostics.averageConfidence = confidences.length ? average(confidences) : 0
  const pairedRatio =
    diagnostics.notationNotes > 0 ? diagnostics.pairedNotes / diagnostics.notationNotes : 1
  diagnostics.measureConfidence = clamp(
    pairedRatio * 0.65 + diagnostics.averageConfidence * 0.35,
    0,
    1,
  )

  if (measureBox && diagnostics.measureConfidence < LOW_CONFIDENCE_THRESHOLD) {
    // measureBox reserved for future x-normalization diagnostics
  }

  return { events: nextEvents, diagnostics }
}

export function pairNotationTabEvents(events, tabNotes, options = {}) {
  if (!events?.length) {
    return {
      events: [],
      attachedCount: 0,
      diagnostics: pairNotationTabInMeasure([], tabNotes, options).diagnostics,
      lowConfidence: Boolean(tabNotes?.length),
    }
  }

  if (!tabNotes?.length) {
    const empty = pairNotationTabInMeasure(events, [], options)
    return {
      events: empty.events,
      attachedCount: 0,
      diagnostics: empty.diagnostics,
      lowConfidence: true,
    }
  }

  const byMeasure = new Map()
  for (const note of tabNotes) {
    const bucket = byMeasure.get(note.measureNumber) ?? []
    bucket.push(note)
    byMeasure.set(note.measureNumber, bucket)
  }

  let attachedCount = 0
  let lowConfidence = false
  const aggregate = {
    notationEvents: 0,
    notationNotes: 0,
    tabDigits: tabNotes.length,
    pairedNotes: 0,
    unpairedNotationNotes: 0,
    unusedTabDigits: 0,
    lowConfidenceOnsets: 0,
    onsetPairs: 0,
    averageConfidence: 0,
    measureConfidence: 1,
  }
  const measureConfidences = []

  const nextEvents = []
  const measureNumber = options.measureNumber ?? null
  const measureTabNotes =
    measureNumber != null ? byMeasure.get(measureNumber) ?? [] : tabNotes

  if (measureNumber != null) {
    const paired = pairNotationTabInMeasure(events, measureTabNotes, options)
    nextEvents.push(...paired.events)
    attachedCount += paired.diagnostics.pairedNotes
    lowConfidence ||= paired.diagnostics.measureConfidence < LOW_CONFIDENCE_THRESHOLD
    measureConfidences.push(paired.diagnostics.measureConfidence)
    Object.keys(aggregate).forEach((key) => {
      if (key === 'averageConfidence' || key === 'measureConfidence') {
        return
      }
      aggregate[key] += paired.diagnostics[key] ?? 0
    })
  } else {
    const eventsByMeasure = new Map()
    for (const event of events) {
      const bucket = eventsByMeasure.get(event.measureNumber) ?? []
      bucket.push(event)
      eventsByMeasure.set(event.measureNumber, bucket)
    }
    const measureNumbers = [...new Set([...eventsByMeasure.keys(), ...byMeasure.keys()])].sort(
      (left, right) => left - right,
    )
    for (const number of measureNumbers) {
      const paired = pairNotationTabInMeasure(
        eventsByMeasure.get(number) ?? [],
        byMeasure.get(number) ?? [],
        options,
      )
      nextEvents.push(...paired.events)
      attachedCount += paired.diagnostics.pairedNotes
      lowConfidence ||= paired.diagnostics.measureConfidence < LOW_CONFIDENCE_THRESHOLD
      measureConfidences.push(paired.diagnostics.measureConfidence)
      Object.keys(aggregate).forEach((key) => {
        if (key === 'averageConfidence' || key === 'measureConfidence') {
          return
        }
        aggregate[key] += paired.diagnostics[key] ?? 0
      })
    }
  }

  aggregate.averageConfidence = measureConfidences.length
    ? average(measureConfidences)
    : 0
  aggregate.measureConfidence = aggregate.averageConfidence

  return {
    events: nextEvents,
    attachedCount,
    diagnostics: aggregate,
    lowConfidence,
  }
}

/** Backward-compatible wrapper used by processOmrPage. */
export function attachTabPositionsToEvents(events, tabNotes, options = {}) {
  const paired = pairNotationTabEvents(events, tabNotes, options)
  return {
    events: paired.events,
    attachedCount: paired.attachedCount,
    pairingDiagnostics: paired.diagnostics,
    lowConfidence: paired.lowConfidence,
  }
}
