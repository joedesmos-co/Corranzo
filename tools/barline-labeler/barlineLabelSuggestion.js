/**
 * Heuristic detector → human label mapping for the static barline labeler.
 * Tooling only — not used by runtime score-follow.
 */

export const BARLINE_LABEL = {
  REAL_BARLINE: 'real-barline',
  FAKE_STEM: 'fake-stem',
  FAKE_NOTEHEAD_CLUSTER: 'fake-notehead-cluster',
  FAKE_BEAM: 'fake-beam',
  UNSURE: 'unsure',
  MISSING_BARLINE: 'missing-barline',
}

const ACCEPTED_HIGH = 'accepted-high'
const ACCEPTED_LOW = 'accepted-low'

/**
 * @param {object} sample manifest row with detector + features
 * @returns {{ label: string, confidence: number, confidenceLabel: 'high'|'medium'|'low' }}
 */
export function suggestLabelForSample(sample) {
  const det = sample?.detector ?? {}
  const f = sample?.features ?? {}
  const decision = det.decision ?? ''
  const reject = det.rejectReason ?? ''

  if (
    decision === ACCEPTED_HIGH ||
    decision === ACCEPTED_LOW ||
    det.finalAccepted === true
  ) {
    const confidenceLabel = det.confidence === 'high' ? 'high' : det.confidence === 'low' ? 'low' : 'medium'
    const confidence = confidenceLabel === 'high' ? 0.91 : confidenceLabel === 'low' ? 0.62 : 0.78
    return { label: BARLINE_LABEL.REAL_BARLINE, confidence, confidenceLabel }
  }

  if (reject === 'margin' || decision === 'ignored-margin') {
    return { label: BARLINE_LABEL.UNSURE, confidence: 0.38, confidenceLabel: 'low' }
  }

  if (reject === 'single-staff' || (f.trebleStrong && !f.bassStrong) || (f.bassStrong && !f.trebleStrong)) {
    if (f.stemSignals >= 1 || reject === 'single-staff') {
      return { label: BARLINE_LABEL.FAKE_STEM, confidence: 0.71, confidenceLabel: 'medium' }
    }
  }

  if (f.stemSignals >= 2 || reject === 'stem-like') {
    return { label: BARLINE_LABEL.FAKE_NOTEHEAD_CLUSTER, confidence: 0.56, confidenceLabel: 'low' }
  }

  if (f.stemSignals === 1) {
    return { label: BARLINE_LABEL.FAKE_STEM, confidence: 0.64, confidenceLabel: 'medium' }
  }

  const full = f.full ?? {}
  const treble = f.treble ?? {}
  const bass = f.bass ?? {}

  if (
    (full.transitions ?? 0) >= 5 &&
    (full.maxRunFrac ?? 1) < 0.45 &&
    (treble.maxRunFrac ?? 0) < 0.55
  ) {
    return { label: BARLINE_LABEL.FAKE_BEAM, confidence: 0.52, confidenceLabel: 'low' }
  }

  const inkLow =
    (full.inkFrac ?? 0) < 0.045 &&
    (treble.inkFrac ?? 0) < 0.04 &&
    (bass.inkFrac ?? 0) < 0.04

  if (inkLow || reject === 'weak-run') {
    return { label: BARLINE_LABEL.MISSING_BARLINE, confidence: 0.58, confidenceLabel: 'medium' }
  }

  if (reject === 'weak-gap-span' || reject === 'inconsistent-spacing') {
    return { label: BARLINE_LABEL.UNSURE, confidence: 0.44, confidenceLabel: 'low' }
  }

  if (decision === 'thinned') {
    return { label: BARLINE_LABEL.FAKE_NOTEHEAD_CLUSTER, confidence: 0.48, confidenceLabel: 'low' }
  }

  return { label: BARLINE_LABEL.UNSURE, confidence: 0.42, confidenceLabel: 'low' }
}

export function isLowConfidenceSuggestion(suggestion) {
  if (!suggestion) return true
  return suggestion.confidenceLabel === 'low' || suggestion.confidence < 0.65
}

export function summarizeAssistStats(labelMeta = {}) {
  let accepted = 0
  let corrected = 0
  for (const meta of Object.values(labelMeta)) {
    if (meta?.source === 'accepted') accepted += 1
    else if (meta?.source === 'corrected') corrected += 1
  }
  return { accepted, corrected, total: accepted + corrected }
}
