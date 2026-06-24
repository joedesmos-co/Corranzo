/**
 * Barline training dataset schema and validation (tooling only).
 * Does not affect runtime score-follow behaviour.
 */

export const BARLINE_DATASET_VERSION = 1

/** Human labels for barline candidate crops. */
export const BARLINE_LABEL = {
  REAL_BARLINE: 'real-barline',
  FAKE_STEM: 'fake-stem',
  FAKE_NOTEHEAD_CLUSTER: 'fake-notehead-cluster',
  FAKE_BEAM: 'fake-beam',
  UNSURE: 'unsure',
  MISSING_BARLINE: 'missing-barline',
}

export const BARLINE_LABEL_VALUES = Object.values(BARLINE_LABEL)

/** Detector outcome kinds stored on exported samples. */
export const DETECTOR_DECISION = {
  ACCEPTED_HIGH: 'accepted-high',
  ACCEPTED_LOW: 'accepted-low',
  REJECTED: 'rejected',
  IGNORED_MARGIN: 'ignored-margin',
  THINNED: 'thinned',
}

export const DETECTOR_DECISION_VALUES = Object.values(DETECTOR_DECISION)

/**
 * Stable sample id: {pieceId}-p{page}-s{system}-x{xPx}
 */
export function buildBarlineSampleId({ pieceId, page, systemIndex, xPx }) {
  const safePiece = String(pieceId).replace(/[^a-zA-Z0-9_-]+/g, '_')
  return `${safePiece}-p${page}-s${systemIndex}-x${Math.round(xPx)}`
}

export function buildCropRelativePath(sampleId) {
  return `crops/${sampleId}.png`
}

/**
 * Normalize one exported sample record (manifest row).
 */
export function buildBarlineSampleRecord({
  pieceId,
  page,
  systemIndex,
  x,
  xPx,
  cropPath,
  expectedMeasuresPerSystem = null,
  features,
  detector,
  bands = null,
}) {
  const id = buildBarlineSampleId({ pieceId, page, systemIndex, xPx })
  return {
    id,
    pieceId,
    page,
    systemIndex,
    x: round6(x),
    xPx: Math.round(xPx),
    cropPath: cropPath ?? buildCropRelativePath(id),
    expectedMeasuresPerSystem:
      expectedMeasuresPerSystem == null ? null : Number(expectedMeasuresPerSystem),
    features: normalizeFeatures(features),
    detector: normalizeDetector(detector),
    bands: bands
      ? {
          y0: round6(bands.y0),
          y1: round6(bands.y1),
          trebleY0: round6(bands.trebleY0),
          trebleY1: round6(bands.trebleY1),
          bassY0: round6(bands.bassY0),
          bassY1: round6(bands.bassY1),
        }
      : null,
  }
}

function normalizeFeatures(features = {}) {
  const bands = ['treble', 'bass', 'gap', 'full']
  const out = {
    stemSignals: Number(features.stemSignals ?? 0),
    score: features.score == null ? null : round6(features.score),
    trebleStrong: Boolean(features.trebleStrong),
    bassStrong: Boolean(features.bassStrong),
    gapStrong: Boolean(features.gapStrong),
    fullStrong: Boolean(features.fullStrong),
    hasBarlineShape: Boolean(features.hasBarlineShape),
  }
  for (const band of bands) {
    const stats = features[band] ?? {}
    out[band] = {
      maxRunFrac: round6(stats.maxRunFrac ?? 0),
      inkFrac: round6(stats.inkFrac ?? 0),
      transitions: Number(stats.transitions ?? 0),
    }
  }
  return out
}

function normalizeDetector(detector = {}) {
  return {
    decision: detector.decision ?? DETECTOR_DECISION.REJECTED,
    confidence: detector.confidence ?? null,
    rejectReason: detector.rejectReason ?? null,
    finalAccepted: detector.finalAccepted === true,
  }
}

function round6(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000
}

/** Validate one manifest sample row. */
export function validateBarlineSample(sample, index = 0) {
  const errors = []
  const prefix = `samples[${index}]`

  if (!sample?.id) {
    errors.push(`${prefix}: missing id`)
  }
  if (!sample?.pieceId) {
    errors.push(`${prefix}: missing pieceId`)
  }
  if (!Number.isFinite(sample?.page)) {
    errors.push(`${prefix}: page must be a number`)
  }
  if (!Number.isFinite(sample?.systemIndex)) {
    errors.push(`${prefix}: systemIndex must be a number`)
  }
  if (!Number.isFinite(sample?.x)) {
    errors.push(`${prefix}: x must be a number`)
  }
  if (!sample?.features || typeof sample.features !== 'object') {
    errors.push(`${prefix}: missing features`)
  }
  if (!sample?.detector || typeof sample.detector !== 'object') {
    errors.push(`${prefix}: missing detector`)
  } else if (!DETECTOR_DECISION_VALUES.includes(sample.detector.decision)) {
    errors.push(`${prefix}: invalid detector.decision "${sample.detector.decision}"`)
  }
  if (sample?.cropPath != null && typeof sample.cropPath !== 'string') {
    errors.push(`${prefix}: cropPath must be a string`)
  }

  return { ok: errors.length === 0, errors }
}

/** Validate export manifest. */
export function validateBarlineDatasetManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest missing or not an object'] }
  }
  if (manifest.version !== BARLINE_DATASET_VERSION) {
    errors.push(`version must be ${BARLINE_DATASET_VERSION}`)
  }
  if (!Array.isArray(manifest.samples)) {
    errors.push('samples must be an array')
    return { ok: false, errors }
  }
  manifest.samples.forEach((sample, index) => {
    const result = validateBarlineSample(sample, index)
    errors.push(...result.errors)
  })
  const ids = new Set()
  for (const sample of manifest.samples) {
    if (sample?.id) {
      if (ids.has(sample.id)) {
        errors.push(`duplicate sample id: ${sample.id}`)
      }
      ids.add(sample.id)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** Validate labels file (sample id → label). */
export function validateBarlineLabelsFile(labelsFile) {
  const errors = []
  if (!labelsFile || typeof labelsFile !== 'object') {
    return { ok: false, errors: ['labels file missing or not an object'] }
  }
  if (labelsFile.version !== BARLINE_DATASET_VERSION) {
    errors.push(`version must be ${BARLINE_DATASET_VERSION}`)
  }
  if (!labelsFile.labels || typeof labelsFile.labels !== 'object') {
    errors.push('labels must be an object')
    return { ok: false, errors }
  }
  for (const [sampleId, label] of Object.entries(labelsFile.labels)) {
    if (!BARLINE_LABEL_VALUES.includes(label)) {
      errors.push(`invalid label for ${sampleId}: "${label}"`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** Merge partial labels into an existing labels file shape. */
export function mergeBarlineLabels(existing = {}, incoming = {}) {
  return {
    version: BARLINE_DATASET_VERSION,
    updatedAt: new Date().toISOString(),
    labels: {
      ...(existing.labels ?? {}),
      ...incoming,
    },
  }
}

/** Count labels by category. */
export function summarizeBarlineLabels(labelsFile) {
  const counts = Object.fromEntries(BARLINE_LABEL_VALUES.map((k) => [k, 0]))
  for (const label of Object.values(labelsFile?.labels ?? {})) {
    if (counts[label] != null) {
      counts[label] += 1
    }
  }
  return {
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
  }
}
