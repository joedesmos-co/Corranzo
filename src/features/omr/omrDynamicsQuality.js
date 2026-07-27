/**
 * Independent Dynamics recognition quality metrics.
 * The frozen semantic evaluator does not score Dynamics — use this harness only.
 */

import { DYNAMIC_MARKS } from './detectOmrDynamics.js'

const EMPTY_COUNTS = () => ({ tp: 0, fp: 0, fn: 0 })

function keyFor(entry) {
  if (entry.kind === 'wedge' || entry.type === 'crescendo' || entry.type === 'diminuendo') {
    const type = entry.type ?? entry.wedge
    return `wedge:${type}`
  }
  return `dyn:${String(entry.mark ?? '').toLowerCase()}`
}

function onsetClose(a, b, tolerance = 4) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return true
  }
  return Math.abs(a - b) <= tolerance
}

function staffMatch(expected, predicted) {
  if (expected == null || predicted == null) {
    return true
  }
  return Number(expected) === Number(predicted)
}

/**
 * Score predicted dynamics/wedges against expected annotations.
 * @param {Array} expected - { mark?, type?, measureNumber, onsetDivision?, staff? }
 * @param {Array} predicted - same shape from OMR measure records / MusicXML parse
 */
export function scoreDynamicsRecognition(expected = [], predicted = []) {
  const bySymbol = Object.fromEntries([
    ...DYNAMIC_MARKS.map((mark) => [mark, EMPTY_COUNTS()]),
    ['crescendo', EMPTY_COUNTS()],
    ['diminuendo', EMPTY_COUNTS()],
  ])

  let staffAssociationErrors = 0
  let onsetAssociationErrors = 0
  const used = new Set()

  for (const exp of expected) {
    const symbol =
      exp.mark ??
      (exp.type === 'crescendo' || exp.type === 'diminuendo' ? exp.type : null)
    if (!symbol || !bySymbol[symbol]) {
      continue
    }
    const expKey = keyFor(exp)
    let matchIndex = -1
    for (let index = 0; index < predicted.length; index += 1) {
      if (used.has(index)) {
        continue
      }
      const pred = predicted[index]
      if (keyFor(pred) !== expKey) {
        continue
      }
      if (
        Number.isFinite(exp.measureNumber) &&
        Number.isFinite(pred.measureNumber) &&
        exp.measureNumber !== pred.measureNumber
      ) {
        continue
      }
      matchIndex = index
      break
    }
    if (matchIndex < 0) {
      bySymbol[symbol].fn += 1
      continue
    }
    used.add(matchIndex)
    bySymbol[symbol].tp += 1
    const pred = predicted[matchIndex]
    if (!staffMatch(exp.staff, pred.staff)) {
      staffAssociationErrors += 1
    }
    if (!onsetClose(exp.onsetDivision, pred.onsetDivision)) {
      onsetAssociationErrors += 1
    }
  }

  for (let index = 0; index < predicted.length; index += 1) {
    if (used.has(index)) {
      continue
    }
    const pred = predicted[index]
    const symbol =
      pred.mark ??
      (pred.type === 'crescendo' || pred.type === 'diminuendo' ? pred.type : null)
    if (symbol && bySymbol[symbol]) {
      bySymbol[symbol].fp += 1
    }
  }

  const totals = Object.values(bySymbol).reduce(
    (acc, row) => {
      acc.tp += row.tp
      acc.fp += row.fp
      acc.fn += row.fn
      return acc
    },
    EMPTY_COUNTS(),
  )
  const precision = totals.tp + totals.fp > 0 ? totals.tp / (totals.tp + totals.fp) : 1
  const recall = totals.tp + totals.fn > 0 ? totals.tp / (totals.tp + totals.fn) : 1
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  return {
    bySymbol,
    totals,
    precision,
    recall,
    f1,
    staffAssociationErrors,
    onsetAssociationErrors,
  }
}

/** Flatten measure records into predicted annotation list. */
export function predictionsFromMeasureRecords(measureRecords = []) {
  const out = []
  for (const record of measureRecords) {
    const dynamics = Array.isArray(record.dynamics)
      ? record.dynamics
      : record.dynamic
        ? [record.dynamic]
        : []
    for (const dynamic of dynamics) {
      out.push({
        mark: dynamic.mark,
        measureNumber: record.measureNumber,
        onsetDivision: dynamic.onsetDivision,
        staff: dynamic.staff,
      })
    }
    for (const wedge of record.wedges ?? []) {
      if (wedge.stage === 'stop') {
        continue
      }
      out.push({
        type: wedge.type,
        measureNumber: record.measureNumber,
        onsetDivision: wedge.onsetDivision,
        staff: wedge.staff,
      })
    }
  }
  return out
}

/** Extract dynamics/wedges from emitted MusicXML for round-trip checks. */
export function predictionsFromMusicXml(xml = '') {
  const out = []
  const measureRe = /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/gi
  let measureMatch
  while ((measureMatch = measureRe.exec(xml))) {
    const measureNumber = Number(measureMatch[1])
    const body = measureMatch[2]
    const dynRe = /<dynamics>\s*<([a-z]+)\s*\/>\s*<\/dynamics>(?:\s*<offset>(\d+)<\/offset>)?(?:\s*<staff>(\d+)<\/staff>)?/gi
    let dynMatch
    while ((dynMatch = dynRe.exec(body))) {
      out.push({
        mark: dynMatch[1],
        measureNumber,
        onsetDivision: dynMatch[2] != null ? Number(dynMatch[2]) : 0,
        staff: dynMatch[3] != null ? Number(dynMatch[3]) : null,
      })
    }
    const wedgeRe =
      /<wedge\s+type="(crescendo|diminuendo|stop)"\s*\/>(?:\s*<offset>(\d+)<\/offset>)?(?:\s*<staff>(\d+)<\/staff>)?/gi
    let wedgeMatch
    while ((wedgeMatch = wedgeRe.exec(body))) {
      if (wedgeMatch[1] === 'stop') {
        continue
      }
      out.push({
        type: wedgeMatch[1],
        measureNumber,
        onsetDivision: wedgeMatch[2] != null ? Number(wedgeMatch[2]) : 0,
        staff: wedgeMatch[3] != null ? Number(wedgeMatch[3]) : null,
      })
    }
  }
  return out
}
