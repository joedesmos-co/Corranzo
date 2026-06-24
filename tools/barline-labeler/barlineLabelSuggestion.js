/**
 * Heuristic detector → human label mapping for the static barline labeler.
 * Tooling only — not used by runtime score-follow.
 *
 * Conservative: prefer "unsure" when evidence is weak or conflicting.
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
const REJECT_WEAK_RUN = 'weak-run'
const REJECT_WEAK_GAP = 'weak-gap-span'
const REJECT_STEM_LIKE = 'stem-like'
const REJECT_SINGLE_STAFF = 'single-staff'
const REJECT_INCONSISTENT = 'inconsistent-spacing'

function band(features, name) {
  return features?.[name] ?? {}
}

function result(label, confidence, confidenceLabel) {
  return { label, confidence, confidenceLabel }
}

function unsure(confidence = 0.38) {
  return result(BARLINE_LABEL.UNSURE, confidence, 'low')
}

/** Grand-staff barline shape with clean vertical span on both staves. */
export function hasStrongBarlineEvidence(features) {
  const f = features ?? {}
  return (
    f.hasBarlineShape === true &&
    f.trebleStrong === true &&
    f.bassStrong === true &&
    f.fullStrong === true &&
    (f.stemSignals ?? 0) === 0 &&
    band(f, 'full').maxRunFrac >= 0.72
  )
}

/** Barline-like but not fully clean (e.g. accepted-low). */
export function hasModerateBarlineEvidence(features) {
  const f = features ?? {}
  if (!f.hasBarlineShape) return false
  if ((f.stemSignals ?? 0) > 1) return false
  const trebleRun = band(f, 'treble').maxRunFrac ?? 0
  const bassRun = band(f, 'bass').maxRunFrac ?? 0
  return f.trebleStrong && f.bassStrong && trebleRun >= 0.5 && bassRun >= 0.5
}

/** Single-staff vertical ink or explicit stem-like asymmetry. */
export function hasStemLikeEvidence(features, rejectReason = '') {
  const f = features ?? {}
  const stems = f.stemSignals ?? 0
  if (rejectReason === REJECT_SINGLE_STAFF) return true
  if (rejectReason === REJECT_STEM_LIKE && stems >= 1) {
    return hasSingleStaffPattern(f) || !f.hasBarlineShape
  }
  if (hasSingleStaffPattern(f) && stems >= 1) return true
  if (stems === 1 && hasSingleStaffPattern(f)) return true
  return false
}

function hasSingleStaffPattern(features) {
  const f = features ?? {}
  const trebleRun = band(f, 'treble').maxRunFrac ?? 0
  const bassRun = band(f, 'bass').maxRunFrac ?? 0
  return (
    (f.trebleStrong && !f.bassStrong && bassRun < 0.42) ||
    (f.bassStrong && !f.trebleStrong && trebleRun < 0.42)
  )
}

/** Fragmented blob / many ink transitions — not merely a weak rejected run. */
export function hasNoteheadClusterEvidence(features) {
  const f = features ?? {}
  const stems = f.stemSignals ?? 0
  if (stems < 2) return false
  const full = band(f, 'full')
  const treble = band(f, 'treble')
  const bass = band(f, 'bass')
  const fragmented =
    (full.transitions ?? 0) >= 9 &&
    (full.maxRunFrac ?? 1) < 0.62 &&
    ((treble.transitions ?? 0) >= 5 || (bass.transitions ?? 0) >= 5)
  const denseInk =
    (treble.inkFrac ?? 0) >= 0.1 &&
    (full.maxRunFrac ?? 1) < 0.55 &&
    stems >= 3
  return fragmented || denseInk
}

/** Horizontal beam-like ink: many transitions, short vertical runs. */
export function hasBeamEvidence(features) {
  const f = features ?? {}
  if (f.fullStrong || f.hasBarlineShape) return false
  const full = band(f, 'full')
  const treble = band(f, 'treble')
  return (
    (full.transitions ?? 0) >= 7 &&
    (full.maxRunFrac ?? 1) < 0.42 &&
    (treble.maxRunFrac ?? 1) < 0.48 &&
    (treble.inkFrac ?? 0) >= 0.07
  )
}

/** Very little ink — likely an empty measure slot. */
export function hasMissingBarlineEvidence(features) {
  const f = features ?? {}
  const full = band(f, 'full')
  const treble = band(f, 'treble')
  const bass = band(f, 'bass')
  const inkLow =
    (full.inkFrac ?? 0) < 0.03 &&
    (treble.inkFrac ?? 0) < 0.025 &&
    (bass.inkFrac ?? 0) < 0.025
  return inkLow && !f.hasBarlineShape && !f.trebleStrong && !f.bassStrong
}

export function featuresConflict(features, detector = {}) {
  const f = features ?? {}
  const stems = f.stemSignals ?? 0
  if (f.hasBarlineShape && stems >= 2) return true
  if (detector.finalAccepted && stems >= 2) return true
  if (detector.decision === ACCEPTED_HIGH && !f.hasBarlineShape) return true
  if (detector.decision === ACCEPTED_HIGH && stems >= 1) return true
  if (detector.decision === ACCEPTED_LOW && !f.hasBarlineShape) return true
  return false
}

/**
 * @param {object} sample manifest row with detector + features
 * @returns {{ label: string, confidence: number, confidenceLabel: 'high'|'medium'|'low' }}
 */
export function suggestLabelForSample(sample) {
  const det = sample?.detector ?? {}
  const f = sample?.features ?? {}
  const decision = det.decision ?? ''
  const reject = det.rejectReason ?? ''

  if (featuresConflict(f, det)) {
    return unsure(0.34)
  }

  if (reject === 'margin' || decision === 'ignored-margin') {
    return unsure(0.32)
  }

  // Strong accepted barline — only case for high confidence real barline.
  if (decision === ACCEPTED_HIGH && hasStrongBarlineEvidence(f)) {
    return result(BARLINE_LABEL.REAL_BARLINE, 0.82, 'high')
  }

  if (decision === ACCEPTED_HIGH) {
    if (hasModerateBarlineEvidence(f)) {
      return result(BARLINE_LABEL.REAL_BARLINE, 0.58, 'medium')
    }
    return unsure(0.4)
  }

  if (decision === ACCEPTED_LOW) {
    if (hasModerateBarlineEvidence(f) && (f.stemSignals ?? 0) <= 1) {
      return result(BARLINE_LABEL.REAL_BARLINE, 0.52, 'low')
    }
    return unsure(0.42)
  }

  if (det.finalAccepted === true) {
    if (hasStrongBarlineEvidence(f)) {
      return result(BARLINE_LABEL.REAL_BARLINE, 0.68, 'medium')
    }
    if (hasModerateBarlineEvidence(f)) {
      return result(BARLINE_LABEL.REAL_BARLINE, 0.5, 'low')
    }
    return unsure(0.38)
  }

  // Weak-run reject often still looks like a barline — do not guess a fake class.
  if (reject === REJECT_WEAK_RUN) {
    if (hasModerateBarlineEvidence(f)) {
      return result(BARLINE_LABEL.REAL_BARLINE, 0.46, 'low')
    }
    return unsure(0.4)
  }

  if (reject === REJECT_WEAK_GAP || reject === REJECT_INCONSISTENT) {
    return unsure(0.36)
  }

  if (hasMissingBarlineEvidence(f)) {
    return result(BARLINE_LABEL.MISSING_BARLINE, 0.55, 'medium')
  }

  if (hasNoteheadClusterEvidence(f)) {
    return result(BARLINE_LABEL.FAKE_NOTEHEAD_CLUSTER, 0.58, 'medium')
  }

  if (hasStemLikeEvidence(f, reject)) {
    return result(BARLINE_LABEL.FAKE_STEM, 0.62, 'medium')
  }

  if (hasBeamEvidence(f)) {
    return result(BARLINE_LABEL.FAKE_BEAM, 0.5, 'low')
  }

  if (decision === 'thinned') {
    if (hasNoteheadClusterEvidence(f)) {
      return result(BARLINE_LABEL.FAKE_NOTEHEAD_CLUSTER, 0.45, 'low')
    }
    return unsure(0.36)
  }

  if (reject === REJECT_STEM_LIKE || reject === REJECT_SINGLE_STAFF) {
    return unsure(0.38)
  }

  return unsure(0.35)
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
