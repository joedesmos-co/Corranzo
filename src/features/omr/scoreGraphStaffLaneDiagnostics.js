/**
 * OMR Engine V2 Phase 6 — observation-only staff-lane / voiceId diagnostics.
 * Reads runtime events; never mutates them or MusicXML output.
 *
 * @see docs/OMR_V2_ROLLOUT_GATE.md
 */

export const STAFF_LANE = {
  MELODY: 'melody',
  ACCOMPANIMENT: 'accompaniment',
  BASS_LINE: 'bass-line',
  DEFAULT: 'default',
}

export const VOICE_ID = {
  TREBLE_MELODY: 'treble-melody',
  BASS_ACCOMPANIMENT: 'bass-accompaniment',
  BASS_PRIMARY: 'bass-primary',
  TREBLE_DEFAULT: 'treble-default',
  BASS_DEFAULT: 'bass-default',
}

export function measureClefContext(events = []) {
  let hasTreble = false
  let hasBass = false
  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      if ((note.clef ?? 'treble') === 'bass') {
        hasBass = true
      } else {
        hasTreble = true
      }
    }
  }
  return { hasTreble, hasBass, isGrandStaff: hasTreble && hasBass }
}

function isBeatAnchoredLong(event) {
  const onset = event.startDivision ?? 0
  const duration = event.durationDivisions ?? 0
  return onset % 4 === 0 && duration >= 8
}

/**
 * Classify one note's staff lane from event context (no measure numbers).
 */
export function classifyStaffLaneForNote(note, event, measureContext = {}) {
  const clef = note.clef ?? 'treble'
  const staff = clef === 'bass' ? 'bass' : 'treble'
  const onset = event.startDivision ?? 0
  const duration = event.durationDivisions ?? 0
  const isGrandStaff = Boolean(measureContext.isGrandStaff)

  if (clef === 'bass' && isGrandStaff) {
    const rhythmicFigure = duration > 0 && duration <= 8
    const offbeat = onset % 4 !== 0
    const notSustainedAnchor = !isBeatAnchoredLong(event)

    if (rhythmicFigure && (offbeat || notSustainedAnchor)) {
      return {
        staff,
        voiceId: VOICE_ID.BASS_ACCOMPANIMENT,
        staffLane: STAFF_LANE.ACCOMPANIMENT,
        accompanimentLane: true,
        latePhaseEligible: offbeat || onset % 4 === 2 || onset % 4 === 3,
      }
    }

    return {
      staff,
      voiceId: VOICE_ID.BASS_PRIMARY,
      staffLane: STAFF_LANE.BASS_LINE,
      accompanimentLane: false,
      latePhaseEligible: false,
    }
  }

  if (clef === 'treble') {
    const latePhaseEligible =
      isGrandStaff && !isBeatAnchoredLong(event) && (onset % 4 !== 0 || duration <= 4)
    return {
      staff,
      voiceId: VOICE_ID.TREBLE_MELODY,
      staffLane: STAFF_LANE.MELODY,
      accompanimentLane: false,
      latePhaseEligible,
    }
  }

  return {
    staff,
    voiceId: clef === 'bass' ? VOICE_ID.BASS_DEFAULT : VOICE_ID.TREBLE_DEFAULT,
    staffLane: STAFF_LANE.DEFAULT,
    accompanimentLane: false,
    latePhaseEligible: false,
  }
}

/**
 * Cross-staff pairing hints: treble melody note with bass accompaniment at nearby offset.
 */
export function deriveCrossStaffPairHints(events = [], laneByNoteKey = new Map()) {
  const hints = []
  const trebleOnsets = []
  const bassAccomp = []

  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      const key = `${note.midi}|${note.clef ?? 'treble'}|${event.startDivision ?? 0}`
      const lane = laneByNoteKey.get(key)
      const onset = event.startDivision ?? 0
      if (lane?.staffLane === STAFF_LANE.MELODY) {
        trebleOnsets.push({ onset, midi: note.midi, key })
      }
      if (lane?.staffLane === STAFF_LANE.ACCOMPANIMENT) {
        bassAccomp.push({ onset, midi: note.midi, key })
      }
    }
  }

  for (const bass of bassAccomp) {
    const paired = trebleOnsets.find(
      (treble) => Math.abs(treble.onset - bass.onset) <= 3 && treble.onset <= bass.onset,
    )
    if (paired) {
      hints.push({
        bassKey: bass.key,
        trebleKey: paired.key,
        onsetGap: bass.onset - paired.onset,
      })
    }
  }

  return hints
}

export function buildMeasureStaffLaneDiagnostics(events = []) {
  const context = measureClefContext(events)
  const laneByNoteKey = new Map()
  const nodes = []

  for (const event of events) {
    if (event.type !== 'note') {
      continue
    }
    for (const note of event.notes ?? []) {
      const lane = classifyStaffLaneForNote(note, event, context)
      const key = `${note.midi}|${note.clef ?? 'treble'}|${event.startDivision ?? 0}`
      laneByNoteKey.set(key, lane)
      nodes.push({
        midi: note.midi,
        clef: note.clef ?? 'treble',
        onsetDivision: event.startDivision ?? 0,
        durationDivisions: event.durationDivisions ?? 0,
        ...lane,
      })
    }
  }

  const crossStaffPairHints = deriveCrossStaffPairHints(events, laneByNoteKey)
  const accompanimentCount = nodes.filter((node) => node.accompanimentLane).length
  const latePhaseCount = nodes.filter((node) => node.latePhaseEligible).length

  return {
    ...context,
    nodeCount: nodes.length,
    accompanimentCount,
    latePhaseCount,
    crossStaffPairHints,
    nodes,
  }
}

export function summarizeStaffLaneDiagnostics(measureGraphs = []) {
  let grandStaffMeasures = 0
  let accompanimentNodes = 0
  let latePhaseNodes = 0
  let crossStaffPairs = 0

  for (const measure of measureGraphs) {
    const events = (measure.nodes ?? [])
      .filter((node) => node.kind === 'notehead')
      .reduce((list, node) => {
        const existing = list.find(
          (event) =>
            event.type === 'note' && (event.startDivision ?? 0) === (node.onsetDivision ?? 0),
        )
        if (existing) {
          existing.notes.push({ midi: node.midi, clef: node.clef })
          return list
        }
        list.push({
          type: 'note',
          startDivision: node.onsetDivision ?? 0,
          durationDivisions: node.durationDivisions ?? 0,
          notes: [{ midi: node.midi, clef: node.clef }],
        })
        return list
      }, [])

    const diag = buildMeasureStaffLaneDiagnostics(events)
    if (diag.isGrandStaff) {
      grandStaffMeasures += 1
    }
    accompanimentNodes += diag.accompanimentCount
    latePhaseNodes += diag.latePhaseCount
    crossStaffPairs += diag.crossStaffPairHints.length
  }

  return {
    grandStaffMeasures,
    accompanimentNodes,
    latePhaseNodes,
    crossStaffPairs,
  }
}
