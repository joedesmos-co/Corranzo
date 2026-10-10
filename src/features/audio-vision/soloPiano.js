/**
 * A6 — Solo piano arrangement: two-hand distribution with musical phrasing.
 * Right hand: melody + harmony; left hand: bass roots + accompaniment.
 * Not a mechanical high/low split: melody continuity wins, then voice leading.
 */
import { PROVENANCE } from './musicAnalysis.js'
import { resolveSimultaneous, selectTexture } from './arrangementModel.js'
import { paramsForDifficulty } from './difficulty.js'

const PIANO_MIN = 21
const PIANO_MAX = 108
// Comfortable hand centers; melody may cross — crossing is resolved by role, not pitch gate.
const LEFT_HOME = 45 // A2 region
const RIGHT_HOME = 72 // C5 region

function clampPiano(midi) {
  return Math.max(PIANO_MIN, Math.min(PIANO_MAX, midi))
}

/**
 * Arrange quantized transcription events + chords + melody into two-hand piano events.
 * Each event: { midi, startBeat, durBeats, hand: 'RH'|'LH', role, kept }
 */
export function arrangeSoloPiano({ quantizedNotes, chords, melodyByBeat, difficulty, beatsPerMeasure = 4 }) {
  const params = paramsForDifficulty(difficulty)
  const maxSpan = params.maxHandSpanSemitones
  // Group by onset beat.
  const byOnset = new Map()
  for (const n of quantizedNotes) {
    const key = Math.round((n.quantizedStartBeat ?? 0) * 4) / 4
    if (!byOnset.has(key)) byOnset.set(key, [])
    byOnset.get(key).push(n)
  }
  const melodySet = new Set((melodyByBeat ?? []).map((m) => Math.round((m.beat ?? 0) * 4) / 4 + ':' + m.midi))
  const events = []
  const warnings = []
  const sortedOnsets = [...byOnset.keys()].sort((a, b) => a - b)
  // Melody line: highest sustained pitch per onset (phrasing anchor).
  let prevMelodyMidi = null
  for (const onset of sortedOnsets) {
    const group = byOnset.get(onset)
    const measureIndex = Math.floor(Math.max(0, onset) / beatsPerMeasure)
    const chord = chordAt(chords, onset, beatsPerMeasure)
    const density = group.length
    const texture = selectTexture({
      noteDensity: density,
      chordConfidence: chord?.confidence ?? 0,
      difficulty,
    })
    // Tag roles.
    const sorted = [...group].sort((a, b) => b.midi - a.midi)
    const melodyMidi = sorted[0]?.midi ?? null
    const tagged = sorted.map((n, i) => ({
      ...n,
      isMelody: i === 0,
      isBassRoot: i === sorted.length - 1,
      isChordTone: chord ? chord.tones.includes(((n.midi % 12) + 12) % 12) : false,
      isPassingTone: chord ? !chord.tones.includes(((n.midi % 12) + 12) % 12) && i > 0 : false,
      strength: n.strength ?? 0.5,
      melodyMidi,
      texture,
      measureIndex,
    }))
    const resolved = resolveSimultaneous(tagged, {
      maxVoices: params.maxVoicesPerOnset + 1, // piano allows melody + accompaniment
      melodyMidi,
    }).filter((e) => e.kept)
    // Hand distribution: melody always RH (phrasing preserved across crossings);
    // bass root LH; inner voices by proximity to hand centers with span check.
    let lhAnchor = LEFT_HOME
    let rhAnchor = prevMelodyMidi ?? RIGHT_HOME
    const ordered = [...resolved].sort((a, b) => a.midi - b.midi)
    for (const e of ordered) {
      let hand
      if (e.isMelody) hand = 'RH'
      else if (e.isBassRoot && ordered.length > 1) hand = 'LH'
      else {
        const dL = Math.abs(e.midi - lhAnchor)
        const dR = Math.abs(e.midi - rhAnchor)
        hand = dL <= dR ? 'LH' : 'RH'
      }
      events.push({
        midi: clampPiano(Math.round(e.midi)),
        startBeat: onset,
        durBeats: Math.max(params.minNoteBeats, e.quantizedDurBeats ?? 0.5),
        hand,
        role: e.isMelody ? 'melody' : e.isBassRoot ? 'bass' : 'harmony',
        texture,
        measureIndex,
        provenance: PROVENANCE.ARRANGED,
      })
      if (hand === 'LH') lhAnchor = e.midi
      else rhAnchor = e.midi
    }
    if (melodyMidi != null) {
      if (prevMelodyMidi != null && Math.abs(melodyMidi - prevMelodyMidi) > 12) {
        warnings.push({ measureIndex, kind: 'large-melody-leap', detail: `${prevMelodyMidi}→${melodyMidi}` })
      }
      prevMelodyMidi = melodyMidi
    }
    void melodySet
  }
  // Enforce per-hand span per onset: drop farthest non-melody note when stretched.
  const finalEvents = enforceHandSpan(events, maxSpan, warnings)
  return { events: finalEvents, warnings, textureSummary: summarizeTextures(finalEvents) }
}

function chordAt(chords, onsetBeat, beatsPerMeasure) {
  if (!chords?.length) return null
  // chords carry startSeconds; map beat→seconds unknown here — match by index fallback:
  const idx = Math.floor(Math.max(0, onsetBeat) / beatsPerMeasure)
  const byMeasure = chords[Math.min(chords.length - 1, Math.max(0, idx * 1))]
  if (!byMeasure) return null
  const intervalsByQuality = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    major7: [0, 4, 7, 11],
    minor7: [0, 3, 7, 10],
    dominant7: [0, 4, 7, 10],
    diminished: [0, 3, 6],
    suspended4: [0, 5, 7],
  }
  const intervals = intervalsByQuality[byMeasure.quality] ?? [0, 4, 7]
  const tones = intervals.map((iv) => (byMeasure.root + iv) % 12)
  return { ...byMeasure, tones }
}

function enforceHandSpan(events, maxSpan, warnings) {
  const byKey = new Map()
  for (const e of events) {
    const key = `${e.hand}@${e.startBeat}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(e)
  }
  const out = []
  for (const [key, group] of byKey) {
    if (group.length < 2) {
      out.push(...group)
      continue
    }
    const midis = group.map((g) => g.midi)
    const span = Math.max(...midis) - Math.min(...midis)
    if (span <= maxSpan) {
      out.push(...group)
      continue
    }
    // Keep melody, drop farthest accompaniment note.
    const sorted = [...group].sort((a, b) => a.midi - b.midi)
    const melody = group.find((g) => g.role === 'melody')
    let drop = sorted[0]
    if (melody && drop === melody) drop = sorted[sorted.length - 1]
    if (!melody) {
      // drop the note farthest from group median
      const med = sorted[Math.floor(sorted.length / 2)].midi
      drop = sorted.reduce((a, b) => (Math.abs(b.midi - med) > Math.abs(a.midi - med) ? b : a))
    }
    warnings.push({ kind: 'hand-span-enforced', detail: `${key} span ${span}→ dropped ${drop.midi}`, measureIndex: drop.measureIndex })
    out.push(...group.filter((g) => g !== drop))
  }
  return out.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
}

function summarizeTextures(events) {
  const counts = {}
  for (const e of events) counts[e.texture] = (counts[e.texture] ?? 0) + 1
  return counts
}
