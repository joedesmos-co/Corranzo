/**
 * Voice- and staff-aware event matching for semantic evaluation.
 *
 * Matching is structural first (staff, canonical voice, onset), then pitch.
 * Attribute comparisons (duration / tie / articulation) happen only on pairs.
 */

import { SEMANTIC_EVAL_TOLERANCES } from './semanticEvalTolerances.js'

function nearlyEqual(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon
}

/**
 * Remap voice numbers within a measure to canonical ranks by content.
 * Equivalent numbering (1/2 vs 5/6) collapses when staff+onset+pitch shapes match.
 */
export function canonicalizeVoices(notes) {
  const byVoice = new Map()
  for (const note of notes) {
    const voice = note.voice ?? 1
    if (!byVoice.has(voice)) {
      byVoice.set(voice, [])
    }
    byVoice.get(voice).push(note)
  }

  const ranked = [...byVoice.entries()]
    .map(([voice, voiceNotes]) => {
      const pitched = voiceNotes.filter((note) => !note.isRest && note.midi != null)
      const meanMidi =
        pitched.reduce((sum, note) => sum + note.midi, 0) / Math.max(pitched.length, 1)
      const firstOnset = Math.min(...voiceNotes.map((note) => note.onsetQuarters))
      const staff = voiceNotes[0]?.staff ?? 1
      return { voice, staff, firstOnset, meanMidi, count: voiceNotes.length }
    })
    .sort(
      (left, right) =>
        left.staff - right.staff ||
        left.firstOnset - right.firstOnset ||
        left.meanMidi - right.meanMidi ||
        left.voice - right.voice,
    )

  const remap = new Map()
  ranked.forEach((entry, index) => {
    remap.set(entry.voice, index + 1)
  })

  return notes.map((note) => ({
    ...note,
    rawVoice: note.voice ?? 1,
    voice: remap.get(note.voice ?? 1) ?? 1,
  }))
}

function pairCost(truth, generated, options) {
  if ((truth.staff ?? 1) !== (generated.staff ?? 1)) {
    return null
  }
  if ((truth.voice ?? 1) !== (generated.voice ?? 1)) {
    return null
  }
  if (Boolean(truth.isRest) !== Boolean(generated.isRest)) {
    return null
  }

  const onsetDiff = Math.abs(truth.onsetQuarters - generated.onsetQuarters)
  const window = truth.isRest ? options.restMatchWindowQuarters : options.matchWindowQuarters
  if (onsetDiff > window) {
    return null
  }

  const durationDiff = Math.abs(truth.durationQuarters - generated.durationQuarters)
  if (truth.isRest) {
    return onsetDiff + durationDiff * 0.5
  }

  const pitchDelta = Math.abs((truth.midi ?? 0) - (generated.midi ?? 0))
  return (
    pitchDelta * 1.1 +
    (onsetDiff / Math.max(options.onsetToleranceQuarters, options.quarterEpsilon)) * 0.25 +
    (durationDiff / Math.max(options.durationToleranceQuarters, options.quarterEpsilon)) * 0.2
  )
}

function buildPair(truth, generated, options) {
  const onsetDiffQuarters = Math.abs(truth.onsetQuarters - generated.onsetQuarters)
  const durationDiffQuarters = Math.abs(truth.durationQuarters - generated.durationQuarters)
  const pitchCorrect =
    truth.isRest || generated.isRest
      ? true
      : truth.midi === generated.midi
  return {
    truth,
    generated,
    onsetDiffQuarters,
    durationDiffQuarters,
    pitchDeltaSemitones:
      truth.isRest || generated.isRest ? 0 : (generated.midi ?? 0) - (truth.midi ?? 0),
    pitchCorrect,
    onsetCorrect: onsetDiffQuarters <= options.onsetToleranceQuarters,
    durationCorrect:
      durationDiffQuarters <= options.durationToleranceQuarters ||
      nearlyEqual(truth.durationQuarters, generated.durationQuarters, options.quarterEpsilon),
    voiceCorrect: (truth.rawVoice ?? truth.voice) === (generated.rawVoice ?? generated.voice),
    staffCorrect: (truth.staff ?? 1) === (generated.staff ?? 1),
  }
}

/**
 * Global min-cost matching within a measure after voice canonicalization.
 */
export function matchSemanticEvents(truthNotes, generatedNotes, options = {}) {
  const resolved = { ...SEMANTIC_EVAL_TOLERANCES, ...options }
  const truth = canonicalizeVoices(truthNotes)
  const generated = canonicalizeVoices(generatedNotes)

  const edges = []
  for (let ti = 0; ti < truth.length; ti += 1) {
    for (let gi = 0; gi < generated.length; gi += 1) {
      const cost = pairCost(truth[ti], generated[gi], resolved)
      if (cost == null) {
        continue
      }
      edges.push({ ti, gi, cost })
    }
  }

  edges.sort((a, b) => a.cost - b.cost || a.ti - b.ti || a.gi - b.gi)
  const usedT = new Set()
  const usedG = new Set()
  const matches = []
  for (const edge of edges) {
    if (usedT.has(edge.ti) || usedG.has(edge.gi)) {
      continue
    }
    usedT.add(edge.ti)
    usedG.add(edge.gi)
    matches.push(buildPair(truth[edge.ti], generated[edge.gi], resolved))
  }

  return {
    matches,
    missing: truth.filter((_, index) => !usedT.has(index)),
    extra: generated.filter((_, index) => !usedG.has(index)),
  }
}

/**
 * Chord comparison on already-matched structural groups — does not invent
 * extra/missing beyond per-note matching results.
 */
export function summarizeChordIntegrity(matches, missing, extra, options = {}) {
  const resolved = { ...SEMANTIC_EVAL_TOLERANCES, ...options }
  const bucket = (note) => {
    const onset = Math.round(
      note.onsetQuarters / Math.max(resolved.chordOnsetToleranceQuarters, 0.01),
    )
    return `${note.staff ?? 1}|${note.voice}|${onset}`
  }

  const truthChords = new Map()
  const generatedChords = new Map()
  for (const pair of matches) {
    if (pair.truth.isRest) {
      continue
    }
    const key = bucket(pair.truth)
    if (!truthChords.has(key)) {
      truthChords.set(key, { truth: [], generated: [] })
    }
    truthChords.get(key).truth.push(pair.truth.midi)
    truthChords.get(key).generated.push(pair.generated.midi)
  }
  for (const note of missing) {
    if (note.isRest) {
      continue
    }
    const key = bucket(note)
    if (!truthChords.has(key)) {
      truthChords.set(key, { truth: [], generated: [] })
    }
    truthChords.get(key).truth.push(note.midi)
  }
  for (const note of extra) {
    if (note.isRest) {
      continue
    }
    const key = bucket(note)
    if (!generatedChords.has(key)) {
      generatedChords.set(key, [])
    }
    generatedChords.get(key).push(note.midi)
    if (!truthChords.has(key)) {
      truthChords.set(key, { truth: [], generated: [] })
    }
  }

  let comparable = 0
  let mismatches = 0
  const examples = []
  for (const [key, group] of truthChords) {
    const extras = generatedChords.get(key) ?? []
    const truthMidis = [...group.truth].sort((a, b) => a - b)
    const generatedMidis = [...group.generated, ...extras].sort((a, b) => a - b)
    if (truthMidis.length < 2 && generatedMidis.length < 2) {
      continue
    }
    comparable += 1
    if (
      truthMidis.length !== generatedMidis.length ||
      truthMidis.some((midi, index) => midi !== generatedMidis[index])
    ) {
      mismatches += 1
      examples.push({ key, truth: truthMidis, generated: generatedMidis })
    }
  }

  return { comparableCount: comparable, mismatchCount: mismatches, examples }
}
