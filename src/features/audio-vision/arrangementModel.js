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
    const beatQuant = Math.round(beatFloat * subdivisions) / subdivisions
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
