/**
 * Tie/slur recall diagnostics for OMR benchmark reports.
 * Compares voice-ordered tie pairs in truth vs generated MusicXML timing maps.
 */

function round(value, places = 4) {
  if (!Number.isFinite(value)) {
    return null
  }
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * Extract start→stop tie pairs from a parsed timing map, ordered per voice.
 */
export function extractVoiceOrderedTiePairs(timing = {}) {
  const byVoice = new Map()
  for (const note of timing.notes ?? []) {
    if (note.isRest) {
      continue
    }
    const key = `${note.partId ?? 'P1'}|${note.voice ?? 1}`
    if (!byVoice.has(key)) {
      byVoice.set(key, [])
    }
    byVoice.get(key).push(note)
  }

  const pairs = []
  for (const notes of byVoice.values()) {
    notes.sort(
      (left, right) =>
        left.quarterTime - right.quarterTime ||
        left.measureNumber - right.measureNumber,
    )
    for (let index = 0; index < notes.length - 1; index += 1) {
      const current = notes[index]
      const next = notes[index + 1]
      if (!current.tieStart || !next.tieStop || current.midi !== next.midi) {
        continue
      }
      pairs.push({
        fromMeasure: current.measureNumber,
        toMeasure: next.measureNumber,
        midi: current.midi,
        label: current.label ?? null,
        voice: current.voice ?? 1,
        partId: current.partId ?? 'P1',
      })
    }
  }

  return pairs.sort(
    (left, right) =>
      left.fromMeasure - right.fromMeasure ||
      left.toMeasure - right.toMeasure ||
      left.midi - right.midi,
  )
}

function pairKey(pair) {
  return `${pair.fromMeasure}->${pair.toMeasure}|${pair.midi}|${pair.partId ?? 'P1'}|${pair.voice ?? 1}`
}

/**
 * Compare truth vs generated tie pairs and optional applied diagnostics pairs.
 */
export function evaluateTieRecall({
  truthTiming = null,
  generatedTiming = null,
  appliedTiePairs = [],
} = {}) {
  const truthPairs = extractVoiceOrderedTiePairs(truthTiming ?? { notes: [] })
  const generatedPairs = generatedTiming
    ? extractVoiceOrderedTiePairs(generatedTiming)
    : []
  const truthKeys = new Set(truthPairs.map(pairKey))
  const generatedKeys = new Set(generatedPairs.map(pairKey))
  const appliedKeys = new Set(
    (appliedTiePairs ?? []).map((pair) =>
      pairKey({
        fromMeasure: pair.fromMeasure,
        toMeasure: pair.toMeasure,
        midi: pair.midi,
        partId: 'P1',
        voice: 1,
      }),
    ),
  )

  const recalled = truthPairs.filter((pair) => generatedKeys.has(pairKey(pair)))
  const missed = truthPairs.filter((pair) => !generatedKeys.has(pairKey(pair)))
  const extra = generatedPairs.filter((pair) => !truthKeys.has(pairKey(pair)))
  const appliedRecalled = truthPairs.filter((pair) => appliedKeys.has(pairKey(pair)))
  const appliedMissed = truthPairs.filter((pair) => !appliedKeys.has(pairKey(pair)))

  const truthCount = truthPairs.length
  const recall = truthCount > 0 ? round(recalled.length / truthCount) : null
  const appliedRecall = truthCount > 0 ? round(appliedRecalled.length / truthCount) : null

  return {
    truthCount,
    generatedCount: generatedPairs.length,
    appliedCount: appliedTiePairs?.length ?? 0,
    recalledCount: recalled.length,
    appliedRecalledCount: appliedRecalled.length,
    appliedMissedCount: appliedMissed.length,
    missedCount: missed.length,
    extraCount: extra.length,
    recall,
    appliedRecall,
    missed,
    appliedMissed,
    extra,
    recalled,
    appliedRecalled,
  }
}

/**
 * Summarize tie vs slur diagnostic counters from generated OMR diagnostics.
 */
export function summarizeTieSlurDiagnostics(tieDiagnostics = {}) {
  const detectedTieCount = Number(tieDiagnostics.detectedTieCount) || 0
  const appliedTieCount = Number(tieDiagnostics.appliedTieCount) || 0
  const uncertainSlurCount = Number(tieDiagnostics.uncertainSlurCount) || 0
  const tieControlGlyphCount = Number(tieDiagnostics.tieControlGlyphCount) || 0
  const tieGap = Math.max(0, detectedTieCount - appliedTieCount)

  return {
    detectedTieCount,
    appliedTieCount,
    tieGap,
    uncertainSlurCount,
    tieControlGlyphCount,
    slursAreDiagnosticOnly: true,
    note:
      'uncertainSlurCount counts different-pitch ink arcs and SMuFL slur glyphs; it never emits ties.',
  }
}
