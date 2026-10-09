/**
 * Neural streaming pipeline (Stage 6, N2) — EXPERIMENTAL, offline only.
 *
 * Turns per-window neural note events into de-duplicated attack events
 * with chord grouping and canonical emission:
 *
 *   buffered audio → overlapping windows → infer(window) → note events
 *     → edge suppression → cross-window dedup → FP filters
 *     → note-level chord grouping → canonical microphone events
 *
 * The neural `infer` function is INJECTED
 * ({ samples, sampleRate, windowStartCaptureMs }) =>
 *   [{ midi, startOffsetSeconds, endOffsetSeconds }]
 * so this module is fully testable without a model, and the browser
 * adapter only supplies TF.js-backed inference + resampling.
 *
 * Capture-time discipline (N5): every timestamp is derived from
 * windowStartCaptureMs + model offset. Inference delay NEVER shifts an
 * onset — a note played on time is evaluated on time.
 *
 * Known honest limits (Stage 8 M4 audit):
 * - Model flicker (a sustained note dropped for one window, re-detected
 *   the next) emits a second attack event: the gap exceeds
 *   continuationGapMs, so the stream cannot know it is one note. The
 *   confirmation tracker (takeNewlyConfirmed) blocks re-emission to the
 *   evaluator per checkpoint, so flicker costs UI noise, never double
 *   awards. True repeats separated by >= the gap still attack cleanly.
 * - Skipped hops (previous inference still pending) drop that window;
 *   overlap covers most of it. Sustained overload means the hardware
 *   gate should have refused activation — see checkNeuralCapability.
 *
 * Pure + testable (no audio APIs, no DOM, no network).
 */

export const NEURAL_STREAM_DEFAULTS = {
  /** Model-native window; matches Basic Pitch TF.js 2 s design. */
  windowSeconds: 2.0,
  /** Hop between window starts; 1 s hop = 2x overlap. */
  hopSeconds: 1.0,
  /** Notes starting this close to a window edge are chunk artifacts. */
  edgeSuppressMs: 150,
  /** Same pitch re-heard within this gap continues the note (no double). */
  continuationGapMs: 120,
  /** Drop notes shorter than this (below the model's own tracker). */
  minNoteMs: 60,
  /**
   * Octave-ghost rule: drop an upper octave when the lower octave of the
   * same pitch class overlaps it by >= this fraction AND started first.
   * Simultaneous piano octaves (same start) are preserved.
   */
  octaveOverlapRatio: 0.7,
  /** Onsets inside this window share a chord group (strum-aware). */
  strumWindowMs: 200,
  /** Assumed confidence (Basic Pitch emits no posterior). */
  assumedConfidence: 0.85,
}

export function createNeuralStreamState(options = {}) {
  return {
    config: { ...NEURAL_STREAM_DEFAULTS, ...options },
    bufferedSamples: [],
    bufferedStartCaptureMs: null,
    nextWindowStartSeconds: 0,
    activeNotes: new Map(),
    openGroup: null,
    emitted: [],
    stats: { windows: 0, rawNotes: 0, droppedEdge: 0, droppedShort: 0, droppedOctave: 0, merged: 0 },
  }
}

/**
 * Append captured audio. samples: mono Float32Array at inputSampleRate;
 * captureStartMs: performance.now() (or equivalent capture clock) of
 * samples[0]. Returns windows ready for inference:
 * [{ samples, sampleRate: 22050, windowStartCaptureMs, windowStartSeconds }]
 * Resampling to the model rate is the CALLER's job (browser adapter uses
 * OfflineAudioContext); this module windows whatever rate it is given and
 * records times in seconds of the provided stream.
 */
export function pushNeuralStreamAudio(state, { samples, captureStartMs, infer } = {}) {
  if (!state || !samples?.length || !Number.isFinite(captureStartMs) || typeof infer !== 'function') {
    throw new TypeError('pushNeuralStreamAudio requires state, samples, captureStartMs and infer')
  }
  const { config } = state
  if (!Number.isFinite(state.streamSampleRate) || state.streamSampleRate <= 0) {
    // Fail fast: without a rate every window computation is NaN and the
    // stream would silently emit nothing. Call setNeuralStreamSampleRate.
    throw new TypeError('pushNeuralStreamAudio requires setNeuralStreamSampleRate first')
  }
  if (state.bufferedStartCaptureMs == null) {
    state.bufferedStartCaptureMs = captureStartMs
  }
  for (const value of samples) {
    state.bufferedSamples.push(value)
  }
  const ready = []
  const windowLength = Math.floor(config.windowSeconds * state.streamSampleRate)
  while (state.bufferedSamples.length - Math.floor(state.nextWindowStartSeconds * state.streamSampleRate) >= windowLength) {
    const startSample = Math.floor(state.nextWindowStartSeconds * state.streamSampleRate)
    const windowSamples = Float32Array.from(state.bufferedSamples.slice(startSample, startSample + windowLength))
    const windowStartCaptureMs = state.bufferedStartCaptureMs + (startSample / state.streamSampleRate) * 1000
    const inferred = infer({
      samples: windowSamples,
      sampleRate: state.streamSampleRate,
      windowStartCaptureMs,
    }) ?? []
    state.stats.windows += 1
    state.stats.rawNotes += inferred.length
    emitNeuralStreamNotes(state, inferred, windowStartCaptureMs)
    ready.push({ windowStartCaptureMs, noteCount: inferred.length })
    state.nextWindowStartSeconds += config.hopSeconds
  }
  // Compact consumed audio (keep one window of overlap for continuity).
  const consumedBefore = Math.floor(state.nextWindowStartSeconds * state.streamSampleRate) - windowLength
  if (consumedBefore > 0) {
    state.bufferedSamples.splice(0, consumedBefore)
    state.bufferedStartCaptureMs += (consumedBefore / state.streamSampleRate) * 1000
    state.nextWindowStartSeconds -= consumedBefore / state.streamSampleRate
  }
  return ready
}

/** Configure the stream sample rate (must be set before pushing audio). */
export function setNeuralStreamSampleRate(state, sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('setNeuralStreamSampleRate requires a positive sample rate')
  }
  state.streamSampleRate = sampleRate
  return state
}

function toCaptureMs(windowStartCaptureMs, offsetSeconds) {
  return windowStartCaptureMs + offsetSeconds * 1000
}

/**
 * Fold one window's note events into attacks: edge/short/octave filters,
 * cross-window dedup, chord grouping. Returns emitted attack events.
 */
export function emitNeuralStreamNotes(state, notes, windowStartCaptureMs) {
  const { config } = state
  const windowMs = config.windowSeconds * 1000
  const emitted = []
  const survivors = []

  for (const note of notes ?? []) {
    const midi = Math.round(note?.midi)
    if (!Number.isFinite(midi)) {
      continue
    }
    // Poison guard: explicit NaN/Infinite offsets would corrupt
    // active-note tracks and group timing. Missing offsets still default
    // below; only malformed present values are dropped.
    if ((note.startOffsetSeconds != null && !Number.isFinite(note.startOffsetSeconds)) ||
        (note.endOffsetSeconds != null && !Number.isFinite(note.endOffsetSeconds))) {
      continue
    }
    const startMs = toCaptureMs(windowStartCaptureMs, note.startOffsetSeconds ?? 0)
    const endMs = toCaptureMs(windowStartCaptureMs, note.endOffsetSeconds ?? note.startOffsetSeconds ?? 0)
    const fromStart = startMs - windowStartCaptureMs
    if (fromStart < config.edgeSuppressMs || windowMs - fromStart < config.edgeSuppressMs) {
      state.stats.droppedEdge += 1
      continue
    }
    if (endMs - startMs < config.minNoteMs) {
      state.stats.droppedShort += 1
      continue
    }
    survivors.push({ midi, startMs, endMs })
  }

  // Cross-window dedup: same pitch continuing across the overlap merges
  // (original onset kept); a gap >= continuationGapMs is a true repeat.
  const fresh = []
  for (const note of survivors) {
    const active = state.activeNotes.get(note.midi)
    if (active && note.startMs - active.lastEndMs < config.continuationGapMs) {
      active.lastEndMs = Math.max(active.lastEndMs, note.endMs)
      state.stats.merged += 1
      continue
    }
    state.activeNotes.set(note.midi, { onsetMs: note.startMs, lastEndMs: note.endMs })
    fresh.push(note)
  }
  // Expire tracks unheard for a full window (bounds memory, re-arms repeats).
  for (const [midi, active] of state.activeNotes) {
    if (windowStartCaptureMs + windowMs - active.lastEndMs > windowMs) {
      state.activeNotes.delete(midi)
    }
  }

  // Octave-ghost filter: drop an upper octave when the lower octave of
  // the same pitch class started strictly first and overlaps the
  // candidate by >= ratio. Simultaneous octave doublings (same start)
  // survive — the filter targets tracking lag, not real doublings.
  const kept = []
  for (const note of fresh) {
    const lower = state.activeNotes.get(note.midi - 12)
    if (lower && lower.onsetMs < note.startMs) {
      const overlap = Math.min(note.endMs, windowStartCaptureMs + windowMs) - note.startMs
      const span = note.endMs - note.startMs
      if (span > 0 && overlap / span >= config.octaveOverlapRatio) {
        state.stats.droppedOctave += 1
        state.activeNotes.delete(note.midi)
        continue
      }
    }
    kept.push(note)
  }

  // Note-level chord grouping: attacks within strumWindowMs share a
  // group. Events emit per attack (low latency, MIDI note-on semantics);
  // the chord emerges from the shared chordGroupId, and each event's
  // detectedMidis carries its own tone (the evaluator matches per tone).
  for (const note of kept) {
    if (state.openGroup && note.startMs - state.openGroup.lastOnsetMs > config.strumWindowMs) {
      state.openGroup = null
    }
    if (!state.openGroup) {
      state.openGroup = { id: `ngrp-${Math.round(note.startMs)}-${note.midi}`, startMs: note.startMs, lastOnsetMs: note.startMs, midis: [] }
    }
    state.openGroup.midis.push(note.midi)
    state.openGroup.lastOnsetMs = Math.max(state.openGroup.lastOnsetMs, note.startMs)
    const event = {
      midi: note.midi,
      detectedMidis: [note.midi],
      onsetCaptureMs: note.startMs,
      endCaptureMs: note.endMs,
      confidence: config.assumedConfidence,
      chordGroupId: state.openGroup.id,
      source: 'neural-microphone',
    }
    emitted.push(event)
    state.emitted.push(event)
  }
  return emitted
}

/** Drain emitted canonical-ready attack events. */
export function drainNeuralStreamEvents(state) {
  const events = state.emitted
  state.emitted = []
  return events
}

/**
 * Currently sustained tones (M1 fix): active tracks unheard just long
 * enough to have left no fresh attack, but still ringing. Confirmation
 * consults these alongside fresh attacks so a sustained chord can
 * complete even when its attack windows were skipped, partial, or
 * merged across loop seams. Emission identity still comes only from
 * fresh attacks (takeNewlyConfirmed) — sustain never double-awards.
 */
export function getNeuralStreamSustained(state) {
  if (!state) {
    return []
  }
  const sustained = []
  for (const [midi, active] of state.activeNotes) {
    sustained.push({ midi, onsetMs: active.onsetMs, confidence: 0.85 })
  }
  return sustained.sort((left, right) => left.midi - right.midi)
}
