const PHASE_BINS = 24
const PHASE_KERNEL_RADIUS = 0.14
const MIN_SAMPLES = 12
const MIN_CLUSTER_SAMPLES = 7
const MIN_CONCENTRATION = 0.2
const MIN_OFFSET_RATIO = 0.08
const MAX_OFFSET_RATIO = 0.34

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor
}

function signedCircularDistance(value, center) {
  return positiveModulo(value - center + 0.5, 1) - 0.5
}

function calibrationSample(note, imageHeight) {
  const lines = [...(note?.pitchMapping?.lineYs ?? [])]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (lines.length < 5 || !Number.isFinite(note?.cy) || !(imageHeight > 0)) {
    return null
  }
  const gapPx = ((lines[lines.length - 1] - lines[0]) * imageHeight) / (lines.length - 1)
  if (!(gapPx >= 3 && gapPx <= 48)) {
    return null
  }
  const evidence = note.detectionEvidence ?? {}
  const wideRows = Number(evidence.wideRows ?? 0)
  const midFill = Number(evidence.midFill ?? 0)
  const verticalRun = Number(evidence.verticalRun ?? Infinity)
  if (
    wideRows < Math.max(4, Math.round(gapPx * 0.3)) ||
    midFill < 0.28 ||
    !Number.isFinite(verticalRun) ||
    verticalRun > gapPx * 2.4
  ) {
    return null
  }
  const bottomPx = lines[lines.length - 1] * imageHeight
  const phase = positiveModulo((note.cy - bottomPx) / (gapPx / 2), 1)
  const weight = Math.max(0.1, Math.min(4, midFill * wideRows))
  return { phase, weight }
}

/**
 * Infer the optical-center offset of raster notehead bodies from staff-lattice
 * phase agreement. This uses only page pixels and detected staff geometry.
 */
export function buildRasterNoteheadPitchCalibration(notes, imageHeight) {
  const samples = (notes ?? []).map((note) => calibrationSample(note, imageHeight)).filter(Boolean)
  const rejected = (reason, extra = {}) => ({
    applied: false,
    reason,
    sampleCount: samples.length,
    offsetRatio: 0,
    confidence: 0,
    ...extra,
  })
  if (samples.length < MIN_SAMPLES) {
    return rejected('insufficient-samples')
  }

  let best = null
  for (let index = 0; index < PHASE_BINS; index += 1) {
    const center = (index + 0.5) / PHASE_BINS
    let score = 0
    for (const sample of samples) {
      const distance = Math.abs(signedCircularDistance(sample.phase, center))
      if (distance <= PHASE_KERNEL_RADIUS) {
        score += sample.weight * (1 - distance / PHASE_KERNEL_RADIUS)
      }
    }
    if (!best || score > best.score) {
      best = { center, score }
    }
  }

  const cluster = samples.filter(
    (sample) => Math.abs(signedCircularDistance(sample.phase, best.center)) <= PHASE_KERNEL_RADIUS,
  )
  if (cluster.length < MIN_CLUSTER_SAMPLES) {
    return rejected('insufficient-phase-cluster', { clusterCount: cluster.length })
  }
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0)
  const clusterWeight = cluster.reduce((sum, sample) => sum + sample.weight, 0)
  const concentration = totalWeight > 0 ? clusterWeight / totalWeight : 0
  if (concentration < MIN_CONCENTRATION) {
    return rejected('diffuse-phase-evidence', {
      clusterCount: cluster.length,
      concentration,
    })
  }

  const phase = positiveModulo(
    best.center +
      cluster.reduce(
        (sum, sample) =>
          sum + signedCircularDistance(sample.phase, best.center) * sample.weight,
        0,
      ) /
        Math.max(clusterWeight, 1e-9),
    1,
  )
  const offsetRatio = phase / 2
  if (offsetRatio < MIN_OFFSET_RATIO || offsetRatio > MAX_OFFSET_RATIO) {
    return rejected('implausible-optical-offset', {
      clusterCount: cluster.length,
      concentration,
      phase,
      offsetRatio,
    })
  }

  return {
    applied: true,
    reason: 'staff-lattice-phase-cluster',
    sampleCount: samples.length,
    clusterCount: cluster.length,
    concentration,
    phase,
    offsetRatio,
    confidence: Math.min(0.95, 0.5 + concentration * 0.45),
  }
}
