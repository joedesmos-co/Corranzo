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
  /**
   * Onsets inside this window count as one strummed chord (guitar).
   * Measured 2026-10-07 on GuitarSet: SS strums span 129–208 ms, funk
   * 8–161 ms, rock comping 9–56 ms. Rapid repeats FASTER than this are
   * separated by the re-onset rule below, not by the window.
   */
  strumWindowMs: 200,
  /** A note unheard for this long counts as released. */
  releaseGapMs: 250,
  /** Blind candidates below this confidence never open an onset. */
  minConfidence: 0.3,
  /**
   * Fresh onsets require this many adjacent heard frames (attack +
   * confirmation). Single-frame spectral ghosts at attack transients never
   * anchor a group; even 100 ms notes span ~6 frames at 60 fps, so the
   * onset-latency cost is one hop (~17 ms).
   */
  minOnsetFrames: 2,
  /**
   * A tainted (never-absent) pitch re-arms only after this many
   * CONSECUTIVE absent frames. Brief destructive-interference dips in a
   * continuously ringing resonance must not re-arm it.
   */
  rearmGapFrames: 5,
  /**
   * Re-onset jump: an already-active pitch heard at ≥1.6× its recent
   * confidence (and ≥0.5 absolute) counts as RE-STRUCK, closing the group.
   * This separates funk-style repeated chords ~130 ms apart that a wide
   * strum window would otherwise merge.
   */
  reonsetRatio: 1.6,
  reonsetMinConfidence: 0.5,
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
    heardStreaks: new Map(),
    /**
     * Tainted pitches (Stage 4 P1): midis heard before ANY absence was
     * observed can never anchor an onset. A room resonance or a note
     * already ringing at take start is steady-state, not an attack —
     * onsets require a preceding absence. Clears per pitch on absence,
     * so normal playing gaps re-arm it immediately.
     */
    needsAbsence: new Set(),
    /** Take-start confidence per tainted pitch (re-attack jump basis). */
    taintLevel: new Map(),
    /**
     * Consecutive absent frames per tainted pitch. Brief interference
     * dips (1–4 frames) do NOT re-arm a resonance; only a real gap
     * (≥ rearmGapFrames) proves the sound stopped and a later hearing
     * is a new attack.
     */
    absentStreaks: new Map(),
    primed: false,
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
  const notes = [...group.onsets.values()]
    .map((onset) => ({
      ...onset,
      // Confidence aggregation (Stage 4 P1): the group's belief in a tone
      // is its strongest frame, not its first — decay and masking make
      // onset frames the noisiest. Falls back to onset confidence when the
      // active track already expired.
      maxConfidence: Math.max(
        onset.confidence ?? 0,
        state.activeNotes.get(onset.midi)?.maxConfidence ?? 0,
      ),
    }))
    .sort((left, right) => left.onsetMs - right.onsetMs)
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

  // Taint tracking: first frame primes the taint set; every frame after
  // clears pitches that are absent. A pitch anchors an onset only after
  // an absence has been observed.
  if (!state.primed) {
    for (const [midi, confidence] of heard) {
      state.needsAbsence.add(midi)
      state.taintLevel.set(midi, confidence)
    }
    state.primed = true
  } else {
    for (const midi of [...state.needsAbsence]) {
      if (!heard.has(midi)) {
        const absent = (state.absentStreaks.get(midi) ?? 0) + 1
        state.absentStreaks.set(midi, absent)
        if (absent >= config.rearmGapFrames) {
          state.needsAbsence.delete(midi)
          state.taintLevel.delete(midi)
          state.absentStreaks.delete(midi)
        }
      } else {
        state.absentStreaks.set(midi, 0)
      }
    }
  }

  // Onset streaks: a NEW pitch must be heard in `minOnsetFrames` adjacent
  // frames before it anchors an onset. Single-frame spectral ghosts at
  // attack transients die here; already-active pitches bypass the streak
  // (continuation) and re-onset through the energy-jump rule instead.
  const streaks = state.heardStreaks
  for (const [midi] of heard) {
    if (!state.activeNotes.has(midi)) {
      streaks.set(midi, (streaks.get(midi) ?? 0) + 1)
    }
  }
  for (const midi of [...streaks.keys()]) {
    if (!heard.has(midi)) {
      streaks.delete(midi)
    }
  }

  for (const [midi, confidence] of heard) {
    const active = state.activeNotes.get(midi)
    if (active) {
      const reonset =
        timeMs - active.onsetMs > config.simultaneousWindowMs &&
        confidence >= config.reonsetMinConfidence &&
        active.lastConfidence > 0 &&
        confidence >= active.lastConfidence * config.reonsetRatio
      active.lastSeenMs = timeMs
      active.maxConfidence = Math.max(active.maxConfidence, confidence)
      active.lastConfidence = confidence
      if (!reonset) {
        continue
      }
      // Re-struck pitch: close the ringing group, start the next event.
      // Partners re-struck in the SAME frame join the fresh group instead
      // of closing it again (one attack, one event).
      if (state.openGroup && state.openGroup.reonsetMs !== timeMs) {
        events.push(emitGroup(state, state.openGroup))
        state.openGroup = { startMs: timeMs, lastOnsetMs: timeMs, onsets: new Map(), reonsetMs: timeMs }
      } else if (!state.openGroup) {
        state.openGroup = { startMs: timeMs, lastOnsetMs: timeMs, onsets: new Map(), reonsetMs: timeMs }
      }
      state.openGroup.onsets.set(midi, { midi, onsetMs: timeMs, confidence })
      state.openGroup.lastOnsetMs = timeMs
      active.onsetMs = timeMs
      continue
    }
    // Fresh onset (streak-gated: transient ghosts never reach here;
    // taint-gated: steady-state resonance ringing since take start never
    // anchors — onsets require a preceding absence, unless the pitch
    // re-attacks at ≥1.6× its take-start level, which proves a new attack
    // on top of the ring and behaves as a normal onset below).
    if (state.needsAbsence.has(midi)) {
      const base = state.taintLevel.get(midi) ?? 0
      const reattacked =
        base > 0 &&
        confidence >= config.reonsetMinConfidence &&
        confidence >= base * config.reonsetRatio
      if (!reattacked) {
        continue
      }
      state.needsAbsence.delete(midi)
      state.taintLevel.delete(midi)
    }
    if ((streaks.get(midi) ?? 0) < config.minOnsetFrames) {
      continue
    }
    streaks.delete(midi)
    state.activeNotes.set(midi, { midi, onsetMs: timeMs, lastSeenMs: timeMs, maxConfidence: confidence, lastConfidence: confidence })
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
