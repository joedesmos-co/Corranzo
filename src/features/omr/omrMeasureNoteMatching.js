/**
 * Per-measure truth/generated note pairing for OMR accuracy evaluation.
 * Uses global minimum-cost matching so onset gains do not swap pitch partners.
 */

export function notePairMatchCost(truth, generated, options) {
  const onsetDiff = Math.abs(truth.onsetQuarters - generated.onsetQuarters)
  if (onsetDiff > options.matchWindowQuarters) {
    return null
  }
  const pitchDelta = Math.abs(truth.midi - generated.midi)
  const durationDiff = Math.abs(truth.durationQuarters - generated.durationQuarters)
  return (
    pitchDelta * 1.25 +
    (onsetDiff / Math.max(options.onsetToleranceQuarters, 0.001)) * 0.35 +
    (durationDiff / Math.max(options.durationToleranceQuarters, 0.001)) * 0.4
  )
}

function notePairMatchCostLegacy(truth, generated, options) {
  const onsetDiff = Math.abs(truth.onsetQuarters - generated.onsetQuarters)
  if (onsetDiff > options.matchWindowQuarters) {
    return null
  }
  const durationDiff = Math.abs(truth.durationQuarters - generated.durationQuarters)
  const pitchDelta = Math.abs(truth.midi - generated.midi)
  return (
    onsetDiff / Math.max(options.onsetToleranceQuarters, 0.001) +
    Math.min(2.5, pitchDelta / 6) +
    Math.min(2, durationDiff / Math.max(options.durationToleranceQuarters, 0.001)) * 0.6
  )
}

export function buildNoteMatch(truth, generated, options) {
  const onsetDiffQuarters = Math.abs(truth.onsetQuarters - generated.onsetQuarters)
  const timeDiffSeconds = Math.abs(truth.timeSeconds - generated.timeSeconds)
  const durationDiffQuarters = Math.abs(truth.durationQuarters - generated.durationQuarters)
  return {
    truth,
    generated,
    onsetDiffQuarters,
    timeDiffSeconds,
    durationDiffQuarters,
    pitchDeltaSemitones: generated.midi - truth.midi,
    pitchCorrect: truth.midi === generated.midi,
    onsetCorrect: onsetDiffQuarters <= options.onsetToleranceQuarters,
    timeCorrect: timeDiffSeconds <= options.timeToleranceSeconds,
    durationCorrect: durationDiffQuarters <= options.durationToleranceQuarters,
  }
}

/**
 * Greedy truth-ordered matching (legacy; order-sensitive).
 */
export function matchMeasureNotesGreedy(truthNotes, generatedNotes, options) {
  const unmatchedGenerated = new Set(generatedNotes.map((_, index) => index))
  const matches = []
  const missing = []

  for (const truth of truthNotes) {
    let best = null
    for (const generatedIndex of unmatchedGenerated) {
      const generated = generatedNotes[generatedIndex]
      const cost = notePairMatchCostLegacy(truth, generated, options)
      if (cost == null) {
        continue
      }
      if (!best || cost < best.cost) {
        best = { generatedIndex, generated, cost }
      }
    }

    if (!best) {
      missing.push(truth)
      continue
    }

    unmatchedGenerated.delete(best.generatedIndex)
    matches.push(buildNoteMatch(truth, best.generated, options))
  }

  return {
    matches,
    missing,
    extra: [...unmatchedGenerated].map((index) => generatedNotes[index]),
  }
}

/**
 * Assign pairs by ascending match cost so pitch is not sacrificed for onset.
 */
export function matchMeasureNotes(truthNotes, generatedNotes, options) {
  const edges = []
  for (let truthIndex = 0; truthIndex < truthNotes.length; truthIndex += 1) {
    const truth = truthNotes[truthIndex]
    for (let generatedIndex = 0; generatedIndex < generatedNotes.length; generatedIndex += 1) {
      const generated = generatedNotes[generatedIndex]
      const cost = notePairMatchCost(truth, generated, options)
      if (cost == null) {
        continue
      }
      edges.push({ truthIndex, generatedIndex, cost })
    }
  }

  edges.sort(
    (left, right) =>
      left.cost - right.cost ||
      left.truthIndex - right.truthIndex ||
      left.generatedIndex - right.generatedIndex,
  )

  const usedTruth = new Set()
  const usedGenerated = new Set()
  const pairs = []

  for (const edge of edges) {
    if (usedTruth.has(edge.truthIndex) || usedGenerated.has(edge.generatedIndex)) {
      continue
    }
    usedTruth.add(edge.truthIndex)
    usedGenerated.add(edge.generatedIndex)
    pairs.push(edge)
  }

  const matches = pairs
    .sort((left, right) => left.truthIndex - right.truthIndex)
    .map((edge) => buildNoteMatch(truthNotes[edge.truthIndex], generatedNotes[edge.generatedIndex], options))

  const missing = truthNotes.filter((_, index) => !usedTruth.has(index))
  const extra = generatedNotes.filter((_, index) => !usedGenerated.has(index))

  return { matches, missing, extra }
}
