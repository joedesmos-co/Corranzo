/**
 * Written-measure sequence alignment for semantic evaluation.
 *
 * Tolerates pickup measures, missing/extra measures, and simple split/merge
 * by fingerprint similarity + Needleman–Wunsch with merge/split transitions.
 */

import { SEMANTIC_EVAL_TOLERANCES } from './semanticEvalTolerances.js'

function round(value, places = 4) {
  if (!Number.isFinite(value)) {
    return null
  }
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function midiHistogram(notes) {
  const hist = Object.create(null)
  for (const note of notes) {
    if (note.isRest || note.midi == null) {
      continue
    }
    const key = String(note.midi)
    hist[key] = (hist[key] ?? 0) + 1
  }
  return hist
}

function histDistance(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  let distance = 0
  let total = 0
  for (const key of keys) {
    const a = left[key] ?? 0
    const b = right[key] ?? 0
    distance += Math.abs(a - b)
    total += Math.max(a, b)
  }
  return total > 0 ? distance / total : 0
}

/**
 * Build a compact fingerprint for one written measure.
 */
export function buildMeasureFingerprint(measure, notes = []) {
  const pitched = notes.filter((note) => !note.isRest && note.midi != null)
  const rests = notes.filter((note) => note.isRest)
  const voices = new Set(notes.map((note) => note.voice ?? 1))
  const staves = new Set(notes.map((note) => note.staff ?? 1))
  const lengthQuarters = Number(measure?.lengthQuarters)
  const notatedLength = Number(measure?.notatedLengthQuarters ?? lengthQuarters)
  const onsetSignature = pitched
    .map((note) => `${round(note.onsetQuarters, 3)}:${note.midi}`)
    .sort()
    .join('|')

  return {
    measureNumber: measure?.number ?? null,
    measureIndex: measure?.index ?? null,
    lengthQuarters: Number.isFinite(lengthQuarters) ? lengthQuarters : 0,
    notatedLengthQuarters: Number.isFinite(notatedLength) ? notatedLength : 0,
    implicit: Boolean(measure?.implicit),
    isPickup:
      Boolean(measure?.implicit) ||
      (Number.isFinite(notatedLength) &&
        Number.isFinite(lengthQuarters) &&
        notatedLength + 1e-6 < lengthQuarters) ||
      (Number.isFinite(lengthQuarters) && lengthQuarters > 0 && lengthQuarters < 3.5),
    pitchedCount: pitched.length,
    restCount: rests.length,
    voiceCount: voices.size,
    staffCount: staves.size,
    midiHist: midiHistogram(pitched),
    onsetSignature,
    marking: measure?.marking ?? null,
  }
}

function fingerprintPairCost(truthFp, generatedFp, options) {
  if (!truthFp || !generatedFp) {
    return options.alignmentGapPenalty
  }

  const lengthDiff = Math.abs(truthFp.lengthQuarters - generatedFp.lengthQuarters)
  const lengthCost =
    lengthDiff <= options.measureLengthToleranceQuarters
      ? 0
      : Math.min(2.5, lengthDiff / Math.max(truthFp.lengthQuarters || 1, 1))

  const countDenom = Math.max(truthFp.pitchedCount, generatedFp.pitchedCount, 1)
  const countCost = Math.abs(truthFp.pitchedCount - generatedFp.pitchedCount) / countDenom
  const histCost = histDistance(truthFp.midiHist, generatedFp.midiHist)
  const voiceCost = truthFp.voiceCount === generatedFp.voiceCount ? 0 : 0.35
  const pickupBonus =
    truthFp.isPickup === generatedFp.isPickup || (!truthFp.isPickup && !generatedFp.isPickup)
      ? 0
      : 0.25
  const signatureCost =
    truthFp.onsetSignature &&
    generatedFp.onsetSignature &&
    truthFp.onsetSignature === generatedFp.onsetSignature
      ? -0.35
      : 0

  return Math.max(0, lengthCost + countCost * 1.2 + histCost * 1.4 + voiceCost + pickupBonus + signatureCost)
}

function mergeFingerprint(left, right) {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  const midiHist = { ...left.midiHist }
  for (const [key, count] of Object.entries(right.midiHist)) {
    midiHist[key] = (midiHist[key] ?? 0) + count
  }
  return {
    measureNumber: left.measureNumber,
    measureIndex: left.measureIndex,
    lengthQuarters: left.lengthQuarters + right.lengthQuarters,
    notatedLengthQuarters: left.notatedLengthQuarters + right.notatedLengthQuarters,
    implicit: left.implicit || right.implicit,
    isPickup: false,
    pitchedCount: left.pitchedCount + right.pitchedCount,
    restCount: left.restCount + right.restCount,
    voiceCount: Math.max(left.voiceCount, right.voiceCount),
    staffCount: Math.max(left.staffCount, right.staffCount),
    midiHist,
    onsetSignature: `${left.onsetSignature}||${right.onsetSignature}`,
    marking: left.marking,
  }
}

/**
 * Align truth written measures to generated written measures.
 *
 * @returns {{
 *   pairs: Array<{
 *     kind: 'match'|'missing'|'extra'|'split'|'merge',
 *     truthIndexes: number[],
 *     generatedIndexes: number[],
 *     cost: number,
 *     truthMeasureNumbers: number[],
 *     generatedMeasureNumbers: number[],
 *   }>,
 *   confidence: number,
 *   matchedCount: number,
 *   unmatchedTruthCount: number,
 *   unmatchedGeneratedCount: number,
 * }}
 */
export function alignMeasureSequences(truthFingerprints, generatedFingerprints, options = {}) {
  const resolved = { ...SEMANTIC_EVAL_TOLERANCES, ...options }
  const n = truthFingerprints.length
  const m = generatedFingerprints.length
  const gap = resolved.alignmentGapPenalty

  // DP: dp[i][j] = best cost aligning first i truth measures with first j generated
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity))
  const bt = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null))
  dp[0][0] = 0

  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (i === 0 && j === 0) {
        continue
      }
      // delete truth measure (missing in generated)
      if (i > 0 && dp[i - 1][j] + gap < dp[i][j]) {
        dp[i][j] = dp[i - 1][j] + gap
        bt[i][j] = { op: 'missing', di: 1, dj: 0 }
      }
      // insert generated measure (extra)
      if (j > 0 && dp[i][j - 1] + gap < dp[i][j]) {
        dp[i][j] = dp[i][j - 1] + gap
        bt[i][j] = { op: 'extra', di: 0, dj: 1 }
      }
      // 1:1 match
      if (i > 0 && j > 0) {
        const cost = fingerprintPairCost(
          truthFingerprints[i - 1],
          generatedFingerprints[j - 1],
          resolved,
        )
        if (dp[i - 1][j - 1] + cost < dp[i][j]) {
          dp[i][j] = dp[i - 1][j - 1] + cost
          bt[i][j] = { op: 'match', di: 1, dj: 1, cost }
        }
      }
      // merge: two truth → one generated
      if (i > 1 && j > 0) {
        const merged = mergeFingerprint(truthFingerprints[i - 2], truthFingerprints[i - 1])
        const cost = fingerprintPairCost(merged, generatedFingerprints[j - 1], resolved) + 0.35
        if (dp[i - 2][j - 1] + cost < dp[i][j]) {
          dp[i][j] = dp[i - 2][j - 1] + cost
          bt[i][j] = { op: 'merge', di: 2, dj: 1, cost }
        }
      }
      // split: one truth → two generated
      if (i > 0 && j > 1) {
        const merged = mergeFingerprint(generatedFingerprints[j - 2], generatedFingerprints[j - 1])
        const cost = fingerprintPairCost(truthFingerprints[i - 1], merged, resolved) + 0.35
        if (dp[i - 1][j - 2] + cost < dp[i][j]) {
          dp[i][j] = dp[i - 1][j - 2] + cost
          bt[i][j] = { op: 'split', di: 1, dj: 2, cost }
        }
      }
    }
  }

  const pairs = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const step = bt[i][j]
    if (!step) {
      break
    }
    const truthIndexes = []
    const generatedIndexes = []
    for (let t = 0; t < step.di; t += 1) {
      truthIndexes.push(i - step.di + t)
    }
    for (let g = 0; g < step.dj; g += 1) {
      generatedIndexes.push(j - step.dj + g)
    }
    pairs.push({
      kind: step.op,
      truthIndexes,
      generatedIndexes,
      cost: step.cost ?? gap,
      truthMeasureNumbers: truthIndexes.map((index) => truthFingerprints[index]?.measureNumber),
      generatedMeasureNumbers: generatedIndexes.map(
        (index) => generatedFingerprints[index]?.measureNumber,
      ),
    })
    i -= step.di
    j -= step.dj
  }
  pairs.reverse()

  // Downgrade expensive 1:1 matches to unmatched when fingerprint cost is too high
  const refined = []
  for (const pair of pairs) {
    if (pair.kind === 'match' && pair.cost > resolved.alignmentMaxPairCost) {
      for (const truthIndex of pair.truthIndexes) {
        refined.push({
          kind: 'missing',
          truthIndexes: [truthIndex],
          generatedIndexes: [],
          cost: gap,
          truthMeasureNumbers: [truthFingerprints[truthIndex]?.measureNumber],
          generatedMeasureNumbers: [],
        })
      }
      for (const generatedIndex of pair.generatedIndexes) {
        refined.push({
          kind: 'extra',
          truthIndexes: [],
          generatedIndexes: [generatedIndex],
          cost: gap,
          truthMeasureNumbers: [],
          generatedMeasureNumbers: [generatedFingerprints[generatedIndex]?.measureNumber],
        })
      }
      continue
    }
    refined.push(pair)
  }

  const matchedCount = refined.filter((pair) =>
    ['match', 'split', 'merge'].includes(pair.kind),
  ).length
  const unmatchedTruthCount = refined.filter((pair) => pair.kind === 'missing').length
  const unmatchedGeneratedCount = refined.filter((pair) => pair.kind === 'extra').length
  const maxLen = Math.max(n, m, 1)
  const avgCost = refined.reduce((sum, pair) => sum + pair.cost, 0) / Math.max(refined.length, 1)
  const confidence = Math.max(
    0,
    Math.min(
      1,
      1 -
        unmatchedTruthCount / maxLen * 0.45 -
        unmatchedGeneratedCount / maxLen * 0.35 -
        avgCost / (resolved.alignmentGapPenalty * 2) * 0.35,
    ),
  )

  return {
    pairs: refined,
    confidence: round(confidence, 4),
    matchedCount,
    unmatchedTruthCount,
    unmatchedGeneratedCount,
    totalCost: round(dp[n][m], 4),
  }
}
