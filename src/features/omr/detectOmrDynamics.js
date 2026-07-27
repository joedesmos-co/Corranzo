/**
 * OMR dynamic marking recognition — text, SMuFL glyphs, and simple hairpins.
 *
 * Recognition + measure/onset association only. Does not invent dynamics from
 * anonymous ink blobs. Playback velocity mapping stays in dynamicsMap.js.
 */

import { isInk } from './omrInk.js'
import { OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'

/** Sprint-1 semantic marks. */
export const DYNAMIC_MARKS = Object.freeze(['pp', 'p', 'mp', 'mf', 'f', 'ff'])

const DYNAMIC_MARK_SET = new Set(DYNAMIC_MARKS)

/** SMuFL dynamics (U+E520–E54F) → MusicXML mark or wedge type. */
export const SMUFL_DYNAMIC_BY_CODEPOINT = Object.freeze({
  0xe520: { kind: 'component', mark: 'p' },
  0xe521: { kind: 'component', mark: 'm' },
  0xe522: { kind: 'component', mark: 'f' },
  0xe52a: { kind: 'dynamics', mark: 'ppp' },
  0xe52b: { kind: 'dynamics', mark: 'pp' },
  0xe52c: { kind: 'dynamics', mark: 'mp' },
  0xe52d: { kind: 'dynamics', mark: 'mf' },
  0xe52f: { kind: 'dynamics', mark: 'ff' },
  0xe530: { kind: 'dynamics', mark: 'fff' },
  0xe53e: { kind: 'wedge', wedge: 'crescendo' },
  0xe53f: { kind: 'wedge', wedge: 'diminuendo' },
})

const TEXT_DYNAMIC_RE = /^(pp|mp|mf|ff)$/i
const TEXT_CRESC_RE = /^cresc\.?$/i
const TEXT_DIM_RE = /^(dim\.?|decresc\.?)$/i

function inkAt(imageData, x, y, threshold) {
  const { data, width, height } = imageData
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return false
  }
  return isInk(data, (py * width + px) * 4, threshold)
}

function normalizeMeasureBox(measureBox) {
  return {
    x0: measureBox.x0 ?? measureBox.xStart ?? 0,
    x1: measureBox.x1 ?? measureBox.xEnd ?? 1,
    y0: measureBox.y0 ?? measureBox.yTop ?? 0,
    y1: measureBox.y1 ?? measureBox.yBottom ?? 1,
    playableX0: measureBox.playableX0 ?? measureBox.x0 ?? measureBox.xStart ?? 0,
    measureNumber: measureBox.measureNumber,
    systemIndex: measureBox.systemIndex,
  }
}

function pdfItemToNorm(item) {
  const pageWidth = item.pageWidth || 1
  const pageHeight = item.pageHeight || 1
  const x0 = (item.x ?? 0) / pageWidth
  const x1 = ((item.x ?? 0) + (item.width ?? 0)) / pageWidth
  const yTopPdf = (item.y ?? 0) + (item.height ?? 0)
  const yBottomPdf = item.y ?? 0
  return {
    text: String(item.text ?? '').trim(),
    x0,
    x1,
    y0: 1 - yTopPdf / pageHeight,
    y1: 1 - yBottomPdf / pageHeight,
    midX: (x0 + x1) / 2,
    midY: 1 - ((item.y ?? 0) + (item.height ?? 0) / 2) / pageHeight,
  }
}

function classifyDynamicToken(rawText) {
  const text = String(rawText ?? '').trim()
  if (!text) {
    return null
  }

  if (text.length === 1) {
    const cp = text.codePointAt(0)
    const smufl = SMUFL_DYNAMIC_BY_CODEPOINT[cp]
    if (smufl?.kind === 'dynamics' && DYNAMIC_MARK_SET.has(smufl.mark)) {
      return { kind: 'dynamics', mark: smufl.mark, confidence: 0.92, source: 'smufl' }
    }
    if (smufl?.kind === 'wedge') {
      return { kind: 'wedge', wedge: smufl.wedge, confidence: 0.9, source: 'smufl' }
    }
    if (smufl?.kind === 'component') {
      return { kind: 'component', mark: smufl.mark, confidence: 0.88, source: 'smufl' }
    }
  }

  if (TEXT_DYNAMIC_RE.test(text)) {
    return {
      kind: 'dynamics',
      mark: text.toLowerCase(),
      confidence: 0.9,
      source: 'text',
    }
  }
  // Single ASCII letters that compose multi-glyph dynamics (m+p, m+f, p+p, f+f).
  if (/^[mpf]$/i.test(text)) {
    return {
      kind: 'component',
      mark: text.toLowerCase(),
      confidence: 0.86,
      source: 'text',
    }
  }
  if (TEXT_CRESC_RE.test(text)) {
    return { kind: 'words', words: 'cresc.', confidence: 0.88, source: 'text' }
  }
  if (TEXT_DIM_RE.test(text)) {
    return { kind: 'words', words: 'dim.', confidence: 0.88, source: 'text' }
  }
  return null
}

/**
 * Merge adjacent component glyphs/letters into combined marks (m+p → mp).
 */
function mergeAdjacentComponents(candidates) {
  const sorted = [...candidates].sort(
    (a, b) => a.midY - b.midY || a.midX - b.midX,
  )
  const merged = []
  let index = 0
  while (index < sorted.length) {
    const current = sorted[index]
    if (current.kind !== 'component') {
      merged.push(current)
      index += 1
      continue
    }
    const next = sorted[index + 1]
    const sameBand =
      next?.kind === 'component' &&
      Math.abs(next.midY - current.midY) < 0.02 &&
      next.midX - current.x1 < 0.055 &&
      next.midX > current.midX
    if (sameBand) {
      const combo = `${current.mark}${next.mark}`
      if (DYNAMIC_MARK_SET.has(combo)) {
        merged.push({
          kind: 'dynamics',
          mark: combo,
          confidence: Math.min(current.confidence, next.confidence),
          source: 'combined',
          midX: (current.midX + next.midX) / 2,
          midY: (current.midY + next.midY) / 2,
          x0: current.x0,
          x1: next.x1,
          y0: Math.min(current.y0, next.y0),
          y1: Math.max(current.y1, next.y1),
        })
        index += 2
        continue
      }
      if (current.mark === next.mark && DYNAMIC_MARK_SET.has(combo)) {
        merged.push({
          kind: 'dynamics',
          mark: combo,
          confidence: Math.min(current.confidence, next.confidence),
          source: 'combined',
          midX: (current.midX + next.midX) / 2,
          midY: (current.midY + next.midY) / 2,
          x0: current.x0,
          x1: next.x1,
          y0: Math.min(current.y0, next.y0),
          y1: Math.max(current.y1, next.y1),
        })
        index += 2
        continue
      }
    }
    // Lone component p/f is a valid dynamic; lone m is not.
    if (DYNAMIC_MARK_SET.has(current.mark)) {
      merged.push({
        ...current,
        kind: 'dynamics',
        source: current.source ?? 'component',
      })
    }
    index += 1
  }
  return merged
}

export function collectDynamicCandidatesFromText(pageText = []) {
  if (!Array.isArray(pageText) || !pageText.length) {
    return []
  }
  const raw = []
  for (const item of pageText) {
    const norm = pdfItemToNorm(item)
    if (!norm.text) {
      continue
    }
    // Reject long prose / titles.
    if (norm.text.length > 10) {
      continue
    }
    const classified = classifyDynamicToken(norm.text)
    if (!classified) {
      continue
    }
    raw.push({ ...classified, ...norm })
  }
  return mergeAdjacentComponents(raw)
}

function onsetDivisionForX(measureBox, xNorm, totalDivisions = 16) {
  const left = measureBox.playableX0 ?? measureBox.x0
  const right = measureBox.x1
  const span = Math.max(1e-6, right - left)
  const t = Math.min(1, Math.max(0, (xNorm - left) / span))
  return Math.round(t * totalDivisions)
}

function staffHintForY(measureBox, yNorm) {
  const mid = (measureBox.y0 + measureBox.y1) / 2
  // Below system mid → lower staff (bass/TAB); above → upper.
  if (yNorm > mid + 0.01) {
    return 2
  }
  if (yNorm < mid - 0.01) {
    return 1
  }
  return null
}

/**
 * Attach dynamic candidates to the nearest containing measure box.
 * Prefer the measure whose playable span contains midX; y must sit near or
 * below the staff (dynamics), not in the header/title band.
 */
export function associateDynamicsToMeasures(
  candidates,
  systemMeasureBoxes,
  { totalDivisions = 16 } = {},
) {
  const boxes = systemMeasureBoxes.flat().map(normalizeMeasureBox)
  const byMeasure = new Map()

  for (const candidate of candidates) {
    // Dynamics live near/below the staff — reject page-header text.
    if (candidate.midY < 0.05) {
      continue
    }
    let best = null
    for (const box of boxes) {
      if (candidate.midX < box.x0 - 0.01 || candidate.midX > box.x1 + 0.01) {
        continue
      }
      // Allow slightly below the system (common engraving) and a little inside.
      if (candidate.midY < box.y0 - 0.04 || candidate.midY > box.y1 + 0.08) {
        continue
      }
      const edgeDist = Math.abs(candidate.midX - (box.playableX0 + box.x1) / 2)
      if (!best || edgeDist < best.edgeDist) {
        best = { box, edgeDist }
      }
    }
    if (!best) {
      continue
    }
    const measureNumber = best.box.measureNumber
    if (!byMeasure.has(measureNumber)) {
      byMeasure.set(measureNumber, { dynamics: [], wedges: [], words: [] })
    }
    const bucket = byMeasure.get(measureNumber)
    const onsetDivision = onsetDivisionForX(best.box, candidate.midX, totalDivisions)
    const staff = staffHintForY(best.box, candidate.midY)
    if (candidate.kind === 'dynamics') {
      // Lone ASCII p/f must sit in the lower / inter-staff dynamics zone so
      // fingerings and note-adjacent letters are not promoted.
      const isLoneLetter = candidate.mark.length === 1 && candidate.source === 'text'
      const zoneFloor = best.box.y0 + (best.box.y1 - best.box.y0) * 0.4
      if (isLoneLetter && candidate.midY < zoneFloor) {
        continue
      }
      bucket.dynamics.push({
        mark: candidate.mark,
        confidence: candidate.confidence,
        onsetDivision,
        staff,
        source: candidate.source,
      })
    } else if (candidate.kind === 'wedge') {
      bucket.wedges.push({
        type: candidate.wedge,
        stage: 'start',
        confidence: candidate.confidence,
        onsetDivision,
        staff,
        source: candidate.source,
      })
    } else if (candidate.kind === 'words') {
      bucket.words.push({
        words: candidate.words,
        confidence: candidate.confidence,
        onsetDivision,
        staff,
        source: candidate.source,
      })
      // Map cresc./dim. words to wedge semantics for MusicXML emission.
      if (candidate.words.startsWith('cresc')) {
        bucket.wedges.push({
          type: 'crescendo',
          stage: 'start',
          confidence: candidate.confidence * 0.95,
          onsetDivision,
          staff,
          source: 'words',
        })
      } else if (candidate.words.startsWith('dim')) {
        bucket.wedges.push({
          type: 'diminuendo',
          stage: 'start',
          confidence: candidate.confidence * 0.95,
          onsetDivision,
          staff,
          source: 'words',
        })
      }
    }
  }

  return byMeasure
}

/**
 * Detect a simple hairpin (wedge) drawn as ink below a measure.
 * Looks for a pair of gently sloping runs that converge (cresc) or diverge (dim).
 */
export function detectHairpinNearMeasure(imageData, measureBox, inkThreshold) {
  const { width, height } = imageData
  const box = normalizeMeasureBox(measureBox)
  const left = Math.floor(box.x0 * width) + 4
  const right = Math.ceil(box.x1 * width) - 4
  if (right - left < 24) {
    return null
  }
  const bandTop = Math.floor(box.y1 * height) + 2
  const bandBottom = Math.min(height - 1, bandTop + 18)

  const samples = []
  const step = Math.max(2, Math.floor((right - left) / 12))
  for (let x = left; x <= right; x += step) {
    let topInk = null
    let bottomInk = null
    for (let y = bandTop; y <= bandBottom; y += 1) {
      if (inkAt(imageData, x, y, inkThreshold)) {
        if (topInk == null) {
          topInk = y
        }
        bottomInk = y
      }
    }
    if (topInk != null && bottomInk != null && bottomInk - topInk <= 10) {
      samples.push({ x, mid: (topInk + bottomInk) / 2, span: bottomInk - topInk })
    }
  }
  if (samples.length < 4) {
    return null
  }

  const first = samples.slice(0, Math.ceil(samples.length / 3))
  const last = samples.slice(-Math.ceil(samples.length / 3))
  const avg = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length
  const spanStart = avg(first, 'span')
  const spanEnd = avg(last, 'span')
  const midStart = avg(first, 'mid')
  const midEnd = avg(last, 'mid')

  // Hairpins stay roughly horizontal as a band; reject random blobs.
  if (Math.abs(midEnd - midStart) > 8) {
    return null
  }
  const delta = spanEnd - spanStart
  // Require a clear opening/closing — reject beams, lyrics, and decoration.
  if (Math.abs(delta) < 2.5 || samples.length < 5) {
    return null
  }
  if (delta > 0) {
    return {
      type: 'crescendo',
      stage: 'start',
      confidence: 0.84,
      onsetDivision: 0,
      source: 'hairpin-ink',
    }
  }
  return {
    type: 'diminuendo',
    stage: 'start',
    confidence: 0.84,
    onsetDivision: 0,
    source: 'hairpin-ink',
  }
}

/**
 * Close open wedges on later measures when a stop cue is absent.
 * Heuristic: a wedge started in measure N without an explicit stop gets a
 * discontinue/stop on the next measure that already has a dynamic mark, or
 * on the following measure (bounded).
 */
export function finalizeWedgeStops(measureRecords) {
  let open = null
  for (const record of measureRecords) {
    const wedges = record.wedges ?? []
    if (open) {
      const hasDynamic = (record.dynamics ?? record.dynamic) != null
      const hasNewWedge = wedges.some((wedge) => wedge.stage === 'start')
      if (hasDynamic || hasNewWedge || record.measureNumber > open.measureNumber + 2) {
        wedges.push({
          type: open.type,
          stage: 'stop',
          confidence: open.confidence,
          onsetDivision: 0,
          staff: open.staff ?? null,
          source: 'auto-stop',
        })
        record.wedges = wedges
        open = null
      }
    }
    for (const wedge of wedges) {
      if (wedge.stage === 'start') {
        open = {
          type: wedge.type,
          confidence: wedge.confidence,
          staff: wedge.staff,
          measureNumber: record.measureNumber,
        }
      }
      if (wedge.stage === 'stop') {
        open = null
      }
    }
  }
  if (open) {
    const last = measureRecords[measureRecords.length - 1]
    if (last) {
      last.wedges = [
        ...(last.wedges ?? []),
        {
          type: open.type,
          stage: 'stop',
          confidence: open.confidence,
          onsetDivision: 16,
          staff: open.staff ?? null,
          source: 'auto-stop',
        },
      ]
    }
  }
  return measureRecords
}

/**
 * Apply page text (+ optional hairpin ink) dynamics onto measure records.
 */
export function attachDynamicsToMeasureRecords({
  measureRecords,
  systemMeasureBoxes,
  pageText,
  imageData = null,
  inkThreshold = 170,
  detectHairpins = true,
  rejectAsciiLetterDynamics = false,
}) {
  let candidates = collectDynamicCandidatesFromText(pageText)
  if (rejectAsciiLetterDynamics) {
    // Fretted scores use ASCII "p"/"f" for techniques (e.g. pull-off). Keep
    // multi-letter marks, SMuFL, and combined glyphs; drop lone ASCII letters.
    candidates = candidates.filter((entry) => {
      if (entry.kind !== 'dynamics') {
        return true
      }
      if (entry.source === 'smufl' || entry.source === 'combined') {
        return true
      }
      return String(entry.mark ?? '').length > 1
    })
  }
  const byMeasure = associateDynamicsToMeasures(candidates, systemMeasureBoxes)

  for (const record of measureRecords) {
    const found = byMeasure.get(record.measureNumber)
    if (found?.dynamics?.length) {
      record.dynamics = found.dynamics
      // Legacy single-field used by existing emission path.
      record.dynamic = found.dynamics[0]
    }
    if (found?.wedges?.length) {
      record.wedges = found.wedges
    }
    if (found?.words?.length) {
      record.dynamicWords = found.words
    }

    if (
      detectHairpins &&
      imageData &&
      !(record.wedges?.length) &&
      systemMeasureBoxes?.length
    ) {
      const box = systemMeasureBoxes
        .flat()
        .find((entry) => entry.measureNumber === record.measureNumber)
      if (box) {
        const hairpin = detectHairpinNearMeasure(imageData, box, inkThreshold)
        if (hairpin && (hairpin.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.DYNAMIC) {
          record.wedges = [...(record.wedges ?? []), hairpin]
        }
      }
    }
  }

  finalizeWedgeStops(measureRecords)
  return measureRecords
}

export function shouldEmitDynamic(dynamic) {
  return (
    dynamic &&
    DYNAMIC_MARK_SET.has(String(dynamic.mark ?? '').toLowerCase()) &&
    (dynamic.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.DYNAMIC
  )
}

export function shouldEmitWedge(wedge) {
  return (
    wedge &&
    (wedge.type === 'crescendo' || wedge.type === 'diminuendo') &&
    (wedge.stage === 'start' || wedge.stage === 'stop' || wedge.stage === 'continue') &&
    (wedge.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.DYNAMIC
  )
}

/** @deprecated Inventing dynamics from anonymous ink — kept for API compat, always null. */
export function detectDynamicNearMeasure() {
  return null
}

/** Page-level first-hit helper retained for tests; prefer collectDynamicCandidatesFromText. */
export function detectDynamicsFromTextItems(textItems = []) {
  const candidates = collectDynamicCandidatesFromText(textItems).filter(
    (entry) => entry.kind === 'dynamics',
  )
  return candidates[0] ? { mark: candidates[0].mark, confidence: candidates[0].confidence } : null
}
