/**
 * Chord grouping layer (Stage 2, S6) — EXPERIMENTAL, offline only.
 *
 * Groups timestamped pitch candidates (e.g. blind-detector frames) into
 * chord events with per-note onsets:
 *
 *   simultaneous  — onsets within `simultaneousWindowMs` (piano block chord)
 *   strummed      — onsets spread up to `strumWindowMs` (natural guitar strum)
 *   arpeggio      — wider spread; reported as a sequence, NOT a chord
 *
 * A group closes once no NEW onset has appeared for `strumWindowMs`: late
 * strings still join a strum, but a repeated chord after a gap starts a
 * fresh group instead of merging into the previous one.
 *
 * Preserved per event: individual midis, per-note confidence, per-note
 * onset estimates, group onset, and attack spread. Release is best-effort
 * (last-seen timestamps); sustain/pedal release is out of scope.
 *
 * Pure + testable: no audio APIs.
 */

export const CHORD_GROUP_DEFAULTS = {
  /** Onsets inside this window count as struck together (piano). */
  simultaneousWindowMs: 50,
  /** Onsets inside this window count as one strummed chord (guitar). */
  strumWindowMs: 140,
  /** A note unheard for this long counts as released. */
  releaseGapMs: 250,
  /** Blind candidates below this confidence never open an onset. */
  minConfidence: 0.3,
}

export const CHORD_GROUP_TYPE = {
  SIMULTANEOUS: 'simultaneous',
  STRUMMED: 'strummed',
  ARPEGGIO: 'arpeggio',
}

export function createChordGroupingState(options = {}) {
  return {
    config: { ...CHORD_GROUP_DEFAULTS, ...options },
    openGroup: null,
    activeNotes: new Map(),
    lastFrameTimeMs: null,
  }
}

function classifyGroupSpan(spanMs, config) {
  if (spanMs <= config.simultaneousWindowMs) {
    return CHORD_GROUP_TYPE.SIMULTANEOUS
  }
  if (spanMs <= config.strumWindowMs) {
    return CHORD_GROUP_TYPE.STRUMMED
  }
  return CHORD_GROUP_TYPE.ARPEGGIO
}

function emitGroup(state, group) {
  const notes = [...group.onsets.values()].sort((left, right) => left.onsetMs - right.onsetMs)
  const spanMs = notes.length > 1 ? notes[notes.length - 1].onsetMs - notes[0].onsetMs : 0
  return {
    type: classifyGroupSpan(spanMs, state.config),
    midis: notes.map((note) => note.midi),
    groupOnsetMs: notes[0]?.onsetMs ?? group.startMs,
    spanMs,
    notes,
  }
}

/**
 * Feed one timestamped candidate frame.
 * candidates: [{ midi, confidence }] (only detected ones).
 * Returns { events: [...] } with any groups that closed on this frame.
 */
export function pushChordGroupingFrame(state, { timeMs, candidates = [] } = {}) {
  if (!state || !Number.isFinite(timeMs)) {
    throw new TypeError('pushChordGroupingFrame requires state and timeMs')
  }
  const events = []
  const { config } = state
  state.lastFrameTimeMs = timeMs

  const heard = new Map()
  for (const candidate of candidates ?? []) {
    if (!Number.isFinite(candidate?.midi)) {
      continue
    }
    if ((candidate.confidence ?? 1) < config.minConfidence) {
      continue
    }
    heard.set(Math.round(candidate.midi), candidate.confidence ?? 1)
  }

  // Close the open group once the onset window has gone quiet: a new onset
  // after the strum window belongs to the NEXT musical event (repeated
  // chord), not to this one. Notes unheard across the whole gap are
  // dropped so an identical re-struck chord re-onsets instead of merging.
  if (state.openGroup && timeMs - state.openGroup.lastOnsetMs > config.strumWindowMs) {
    events.push(emitGroup(state, state.openGroup))
    state.openGroup = null
    for (const [midi, active] of state.activeNotes) {
      if (timeMs - active.lastSeenMs > config.strumWindowMs) {
        state.activeNotes.delete(midi)
      }
    }
  }

  for (const [midi, confidence] of heard) {
    const active = state.activeNotes.get(midi)
    if (active) {
      active.lastSeenMs = timeMs
      active.maxConfidence = Math.max(active.maxConfidence, confidence)
      continue
    }
    // Fresh onset.
    state.activeNotes.set(midi, { midi, onsetMs: timeMs, lastSeenMs: timeMs, maxConfidence: confidence })
    if (!state.openGroup) {
      state.openGroup = { startMs: timeMs, lastOnsetMs: timeMs, onsets: new Map() }
    } else if (timeMs - state.openGroup.startMs > config.strumWindowMs) {
      // Previous group ran too long without closing (sustained overlap):
      // emit it as an arpeggio and start fresh.
      events.push(emitGroup(state, state.openGroup))
      state.openGroup = { startMs: timeMs, lastOnsetMs: timeMs, onsets: new Map() }
    }
    state.openGroup.onsets.set(midi, { midi, onsetMs: timeMs, confidence })
    state.openGroup.lastOnsetMs = timeMs
  }

  // Expire released notes (best-effort release tracking).
  for (const [midi, active] of state.activeNotes) {
    if (!heard.has(midi) && timeMs - active.lastSeenMs > config.releaseGapMs) {
      active.releasedMs = active.lastSeenMs
      state.activeNotes.delete(midi)
    }
  }

  return { events }
}

/** Emit any still-open group (end of clip / end of take). */
export function flushChordGrouping(state) {
  if (!state?.openGroup) {
    return { events: [] }
  }
  const events = [emitGroup(state, state.openGroup)]
  state.openGroup = null
  return { events }
}
