/**
 * Event scoring shared by the stage ledger and the model benchmark, so every
 * number in the reports is produced by the same matcher.
 *
 * A predicted event matches a reference note when the pitch is equal and the
 * onset is within the tolerance. Everything else is a false positive or a
 * missed note. Pitch, onset and duration errors are reported separately.
 */

export const ONSET_TOLERANCE = 0.12

export function round(value, digits = 3) {
  return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null
}

export function scoreEvents(predicted, reference, { tolerance = ONSET_TOLERANCE } = {}) {
  const used = new Set()
  const matches = []
  let falsePositives = 0
  for (const event of predicted) {
    let best = -1
    let bestDelta = Infinity
    for (let i = 0; i < reference.length; i += 1) {
      if (used.has(i)) continue
      const note = reference[i]
      if (note.midi !== event.midi) continue
      const delta = Math.abs((event.onset ?? 0) - note.onset)
      if (delta <= tolerance && delta < bestDelta) { best = i; bestDelta = delta }
    }
    if (best >= 0) {
      used.add(best)
      matches.push({ event, note: reference[best], delta: bestDelta })
    } else {
      falsePositives += 1
    }
  }
  const missed = reference.length - used.size
  const precision = predicted.length ? used.size / predicted.length : 0
  const recall = reference.length ? used.size / reference.length : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const onsetErrors = matches.map((m) => m.delta)
  const durationErrors = matches
    .filter((m) => Number.isFinite(m.event.duration) && Number.isFinite(m.note.offset))
    .map((m) => Math.abs(m.event.duration - (m.note.offset - m.note.onset)))
  const median = (values) => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  return {
    predicted: predicted.length,
    reference: reference.length,
    matched: used.size,
    falsePositives,
    missed,
    pitchPrecision: round(precision),
    pitchRecall: round(recall),
    eventF1: round(f1),
    onsetMaeMs: matches.length ? Math.round((onsetErrors.reduce((a, b) => a + b, 0) / onsetErrors.length) * 1000) : null,
    onsetMedianMs: matches.length ? Math.round(median(onsetErrors) * 1000) : null,
    durationMaeMs: durationErrors.length ? Math.round((durationErrors.reduce((a, b) => a + b, 0) / durationErrors.length) * 1000) : null,
  }
}

/** Melody anchors: the highest pitch of each onset cluster (the audible line). */
export function melodyAnchors(notes, clusterSeconds = 0.06) {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset)
  const anchors = []
  for (const note of sorted) {
    const last = anchors[anchors.length - 1]
    if (last && Math.abs(note.onset - last.onset) < clusterSeconds) {
      if (note.midi > last.midi) last.midi = note.midi
    } else {
      anchors.push({ onset: note.onset, midi: note.midi })
    }
  }
  return anchors
}

export function anchorRecall(events, anchors, tolerance = 0.25) {
  let hit = 0
  let errSum = 0
  for (const anchor of anchors) {
    const near = events.filter((e) => Math.abs(e.onset - anchor.onset) <= tolerance && e.midi === anchor.midi)
    if (near.length) {
      hit += 1
      errSum += Math.min(...near.map((e) => Math.abs(e.onset - anchor.onset)))
    }
  }
  return {
    recall: anchors.length ? round(hit / anchors.length) : null,
    maeMs: hit ? Math.round((errSum / hit) * 1000) : null,
    anchors: anchors.length,
  }
}

/** Share of events with no reference support nearby (invented material). */
export function inventedRate(events, reference, tolerance = 0.3) {
  if (!events.length) return null
  let invented = 0
  for (const event of events) {
    const supported = reference.some((note) =>
      Math.abs(note.onset - event.onset) <= tolerance &&
      (((note.midi - event.midi) % 12) + 12) % 12 === 0)
    if (!supported) invented += 1
  }
  return round(invented / events.length)
}
