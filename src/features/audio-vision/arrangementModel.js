/**
 * A4 core — internal arrangement model.
 * TranscribedContent (what the recording appears to contain) vs Arrangement
 * (what ONE musician should play) are different representations.
 *
 * ArrangementModel.parts[] is future-proof: V1 fills exactly one part
 * (solo-piano | solo-guitar); later Piano+Guitar+Bass+Drums selections add
 * parts without rewriting the pipeline.
 */
import { PROVENANCE } from './musicAnalysis.js'

export const PART_INSTRUMENTS = {
  SOLO_PIANO: 'solo-piano',
  SOLO_GUITAR: 'solo-guitar',
  // Future (not V1): 'piano', 'guitar', 'bass', 'drums'
}

export const DIFFICULTIES = {
  EASY: 'easy',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
}

/** Quantize note events to a beat grid; returns events with quantized beats + residual. */
export function quantizeToBeats(notes, beats, { beatsPerMeasure = 4, subdivisions = 4 } = {}) {
  if (!beats?.length) {
    return notes.map((n) => ({ ...n, beatFloat: 0, beatQuant: 0, residualBeats: 0, provenance: PROVENANCE.INFERRED }))
  }
  const period = beats.length > 1 ? beats[1] - beats[0] : 0.5
  const step = period / subdivisions
  return notes.map((n) => {
    const beatFloat = (n.startSeconds - beats[0]) / period
    // Notes that precede the first detected beat (a pickup, or an onset the
    // detector's silence-invariant threshold missed) must not quantize to a
    // NEGATIVE beat: that produced a note time before zero, which the emitter
    // clamped into measure 0 while the preview MIDI did not, and it is what
    // made the padded variants differ from the baseline by a small constant.
    // Such a note is on (or just before) the first beat, so it snaps to beat 0.
    const beatQuant = Math.max(0, Math.round(beatFloat * subdivisions) / subdivisions)
    const durBeats = Math.max(1 / subdivisions, Math.round(((n.endSeconds - n.startSeconds) / step)) / subdivisions)
    return {
      ...n,
      beatFloat: Math.round(beatFloat * 1000) / 1000,
      beatQuant,
      quantizedStartBeat: beatQuant,
      quantizedDurBeats: Math.round(durBeats * 1000) / 1000,
      measureIndex: Math.floor(Math.max(0, beatQuant) / beatsPerMeasure),
      beatInMeasure: Math.round((Math.max(0, beatQuant) % beatsPerMeasure) * 1000) / 1000,
      residualBeats: Math.round(Math.abs(beatFloat - beatQuant) * 1000) / 1000,
      provenance: n.provenance ?? PROVENANCE.PREDICTED,
    }
  })
}

/**
 * Texture selection per measure: melody+block-chord | melody+broken | melody+bass-roots | melody-only.
 * Based on note density + chord confidence. Deterministic + testable.
 */
export function selectTexture({ noteDensity, chordConfidence, difficulty }) {
  if (noteDensity <= 1.2 || chordConfidence < 0.25) return 'melody-only'
  if (difficulty === 'easy') {
    if (noteDensity > 4) return 'melody-bass-roots'
    return chordConfidence >= 0.4 ? 'melody-block-light' : 'melody-bass-roots'
  }
  if (difficulty === 'intermediate') {
    if (noteDensity > 6) return 'melody-broken'
    return chordConfidence >= 0.35 ? 'melody-block' : 'melody-broken'
  }
  if (noteDensity > 8) return 'melody-broken-full'
  return chordConfidence >= 0.3 ? 'melody-block-full' : 'melody-broken-full'
}

/**
 * Conflict resolution: cap simultaneous notes, keep melody pitch + lowest root,
 * prefer chord tones over passing tones. Never random deletion: priority is
 * melody > bass root > chord tones > inner voices by strength/recency.
 */
export function resolveSimultaneous(events, { maxVoices, melodyMidi = null }) {
  if (events.length <= maxVoices) return events.map((e) => ({ ...e, kept: true, provenance: PROVENANCE.ARRANGED }))
  const scored = events.map((e) => {
    let score = 0
    if (melodyMidi != null && e.midi === melodyMidi) score += 100
    if (e.isBassRoot) score += 60
    if (e.isChordTone) score += 30
    score += Math.min(10, (e.strength ?? 0.5) * 10)
    score += e.isMelody ? 40 : 0
    return { e, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const keep = new Set(scored.slice(0, maxVoices).map((s) => s.e))
  // The melody and bass root are structural, not a budget competition: they
  // survive an over-full onset regardless of chord-tone scoring, so improving
  // chord labels cannot silently drop a melody note (verified by the full A/B:
  // chord-root +0.236/config, melody change 0.000).
  for (const { e } of scored) {
    if (e.isMelody || e.isBassRoot) keep.add(e)
  }
  return events.map((e) => ({ ...e, kept: keep.has(e), provenance: PROVENANCE.ARRANGED }))
}

export function createTranscribedContent({ analysis, viewsQuality = null }) {
  return {
    kind: 'transcribed-content',
    totalSeconds: analysis.totalSeconds,
    tempo: analysis.tempo,
    beats: analysis.beats.beats,
    beatPeriodSeconds: analysis.beats.beatPeriodSeconds,
    onsets: analysis.onsets,
    predictedNotes: analysis.predictedNotes,
    pitchSource: analysis.pitchSource,
    chords: analysis.chords,
    melody: analysis.melody,
    bassLine: analysis.bassLine,
    sections: analysis.sections,
    separationQuality: viewsQuality,
    provenance: PROVENANCE.PREDICTED,
  }
}

export function createArrangementModel({ targetPart, difficulty, sourceHash = null }) {
  if (![PART_INSTRUMENTS.SOLO_PIANO, PART_INSTRUMENTS.SOLO_GUITAR].includes(targetPart)) {
    throw new TypeError(`V1 supports solo-piano and solo-guitar only (got ${targetPart})`)
  }
  return {
    kind: 'arrangement',
    version: 1,
    targetPart,
    difficulty,
    sourceHash,
    parts: [
      {
        id: targetPart,
        instrument: targetPart,
        difficulty,
        events: [], // filled by solo pipelines: { midi, startBeat, durBeats, hand?, string?, fret?, role }
        textureByMeasure: [],
        warnings: [],
      },
    ],
    confidence: null, // filled by pipeline: { overall, melodyPreservation, ... }
    provenance: PROVENANCE.ARRANGED,
  }
}

/** Measurable complexity for difficulty verification (A7 must differ measurably). */
export function measureComplexity(events) {
  if (!events?.length) return { notesPerSecond: 0, polyphonyMax: 0, spanSemitones: 0, distinctPitchClasses: 0 }
  const start = Math.min(...events.map((e) => e.startBeat ?? e.startSeconds ?? 0))
  const end = Math.max(...events.map((e) => (e.startBeat ?? 0) + (e.durBeats ?? e.durationSeconds ?? 0.5)))
  const beats = end - start
  const simultaneous = new Map()
  for (const e of events) {
    const key = Math.round((e.startBeat ?? e.startSeconds ?? 0) * 4)
    simultaneous.set(key, (simultaneous.get(key) ?? 0) + 1)
  }
  const midis = events.map((e) => e.midi).filter(Number.isFinite)
  return {
    notesPerBeat: Math.round((events.length / Math.max(1, beats)) * 100) / 100,
    polyphonyMax: Math.max(...simultaneous.values()),
    spanSemitones: midis.length ? Math.max(...midis) - Math.min(...midis) : 0,
    distinctPitchClasses: new Set(midis.map((m) => ((m % 12) + 12) % 12)).size,
  }
}

/**
 * Build a beat-keyed melodic contour from detected melody frames
 * (analysis.melody: the dominant salient pitch per frame, provenance
 * 'detected'). Used to decide WHICH simultaneous note is the melody —
 * highest-pitch heuristics mislabel when an upper harmonic or octave
 * shadow sits above the real line, and difficulty thinning then deletes
 * the true melody. Returns Map<beat(number), Set<midi>>.
 */
export function buildMelodyContour(melodyFrames = [], { beat0 = 0, beatPeriod = 0.5, toleranceBeats = 0.5 } = {}) {
  const contour = new Map()
  if (!melodyFrames?.length || !(beatPeriod > 0)) return contour
  for (const frame of melodyFrames) {
    const beat = (frame.seconds - beat0) / beatPeriod
    if (!Number.isFinite(beat)) continue
    const key = Math.round(beat * 2) / 2
    for (const b of [beat + toleranceBeats, beat, beat - toleranceBeats]) {
      if (b < -toleranceBeats) continue
      const k = Math.round(b * 2) / 2
      if (!contour.has(k)) contour.set(k, new Set())
      contour.get(k).add(frame.midi)
    }
    void key
  }
  return contour
}

/**
 * Pick the melody note of a simultaneous group using the contour first
 * (detected evidence), falling back to the highest pitch. Returns the
 * chosen midi or null when the group is empty.
 */
export function chooseMelodyMidi(midis, contourForBeat, { fallbackHighest = true } = {}) {
  if (!midis?.length) return null
  if (contourForBeat?.size) {
    for (const midi of midis) {
      if (contourForBeat.has(midi)) return midi
    }
    // Pitch-class match catches octave displacement of the true line.
    for (const midi of midis) {
      for (const c of contourForBeat) {
        if (Math.abs(c - midi) === 12) return midi
      }
    }
  }
  return fallbackHighest ? Math.max(...midis) : null
}

/**
 * Suppress harmonic-double inventions in predicted notes (octave/fifth
 * shadows of a simultaneously stronger note). Only notes carrying an
 * amplitude/strength vote; notes without one are always kept. Returns
 * { notes, suppressed } — the count keeps the decision auditable, never
 * silent. The strongest note in a group is never dropped.
 */
export function suppressHarmonicDoubles(notes, { windowSeconds = 0.06, minRatio = 1.5 } = {}) {
  const sorted = [...(notes ?? [])].sort((a, b) => a.startSeconds - b.startSeconds)
  const drop = new Set()
  for (let i = 0; i < sorted.length; i += 1) {
    if (drop.has(i)) continue
    const anchor = sorted[i]
    const ampAnchor = anchor.amplitude ?? anchor.strength ?? null
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].startSeconds - anchor.startSeconds > windowSeconds) break
      if (drop.has(j)) continue
      const other = sorted[j]
      const ampOther = other.amplitude ?? other.strength ?? null
      if (ampAnchor == null || ampOther == null) continue
      if (anchor.midi === other.midi) continue
      const interval = Math.abs(anchor.midi - other.midi) % 12
      if (interval !== 0 && interval !== 7) continue
      if (ampAnchor >= ampOther * minRatio) {
        drop.add(j)
      } else if (ampOther >= ampAnchor * minRatio) {
        drop.add(i)
        break
      }
    }
  }
  return {
    notes: sorted.filter((_, index) => !drop.has(index)),
    suppressed: drop.size,
  }
}
