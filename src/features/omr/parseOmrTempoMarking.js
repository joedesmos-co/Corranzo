/**
 * OMR tempo recognition — metronome marks, tempo words, mid-score changes.
 *
 * Corranzo policy: TEMPO_WORD_BPM in omrMusicalConstants.js is the explicit
 * word→BPM map. Always preserve printed words in MusicXML; assign BPM only
 * via that map or an explicit numeric mark.
 */

import { TEMPO_WORD_BPM, OMR_MUSICAL_CONFIDENCE } from './omrMusicalConstants.js'
import { OMR_DEFAULT_TEMPO } from './omrConstants.js'

/** Playable BPM bounds (quarter-note equivalent for sound tempo). */
export const TEMPO_BPM_BOUNDS = Object.freeze({ min: 20, max: 300 })

/** Printed metronome per-minute bounds before quarter conversion. */
const MARK_BPM_BOUNDS = Object.freeze({ min: 20, max: 400 })

const TEMPO_WORD_RE =
  /^(grave|largo|lent|lento|adagio|andante|moderato|allegretto|allegro|vivace|presto|a\s*tempo)$/i

/** Leading tempo word in a short expressive phrase ("Moderato cantabile"). */
const LEADING_TEMPO_WORD_RE =
  /^(grave|largo|lent|lento|adagio|andante|moderato|allegretto|allegro|vivace|presto)\b/i

const EMBEDDED_TEMPO_WORD_RE =
  /\b(grave|largo|lent|lento|adagio|andante|moderato|allegretto|allegro|vivace|presto)\b/i

/** SMuFL metronome note glyphs (U+ECA0–ECB6) → MusicXML beat-unit. */
export const SMUFL_METRONOME_BEAT_UNIT = Object.freeze({
  0xeca0: 'breve',
  0xeca1: 'breve',
  0xeca2: 'whole',
  0xeca3: 'half',
  0xeca4: 'half',
  0xeca5: 'quarter',
  0xeca6: 'quarter',
  0xeca7: 'eighth',
  0xeca8: 'eighth',
  0xeca9: '16th',
  0xecaa: '16th',
  0xecab: '32nd',
  0xecac: '32nd',
  0xecad: '64th',
  0xecae: '64th',
  0xecaf: '128th',
  0xecb0: '128th',
  0xecb1: '256th',
  0xecb2: '256th',
  0xecb3: '512th',
  0xecb4: '512th',
  0xecb5: '1024th',
  0xecb6: '1024th',
})

const BEAT_UNIT_QUARTERS = Object.freeze({
  maxima: 8,
  long: 4,
  breve: 2,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
  '128th': 0.03125,
  '256th': 0.015625,
  '512th': 0.0078125,
  '1024th': 0.00390625,
})

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

export function isPlayableBpm(value) {
  return Number.isFinite(value) && value >= TEMPO_BPM_BOUNDS.min && value <= TEMPO_BPM_BOUNDS.max
}

export function beatUnitQuarters(beatUnit, dots = 0) {
  const base = BEAT_UNIT_QUARTERS[beatUnit] ?? 1
  const dotCount = Math.max(0, Math.min(3, Math.round(Number(dots) || 0)))
  if (dotCount <= 0) {
    return base
  }
  return base * (2 - 1 / 2 ** dotCount)
}

export function toQuarterBpm(markBpm, beatUnit = 'quarter', dots = 0) {
  const raw = Number(markBpm) * beatUnitQuarters(beatUnit, dots)
  if (!Number.isFinite(raw) || raw <= 0) {
    return null
  }
  const rounded = Math.round(raw)
  return isPlayableBpm(rounded) ? rounded : null
}

function classifyBeatUnitToken(text) {
  const raw = String(text ?? '').trim()
  if (!raw) {
    return null
  }
  if (raw === '♩' || raw === 'q' || raw === 'Q') {
    return { beatUnit: 'quarter', dots: 0 }
  }
  if (raw === '♪' || raw === 'e' || raw === 'E') {
    return { beatUnit: 'eighth', dots: 0 }
  }
  if (raw === '𝅗' || raw === 'h' || raw === 'H') {
    return { beatUnit: 'half', dots: 0 }
  }
  if (raw.length === 1) {
    const unit = SMUFL_METRONOME_BEAT_UNIT[raw.codePointAt(0)]
    if (unit) {
      return { beatUnit: unit, dots: 0 }
    }
  }
  // Dotted forms as text "q." / "♩."
  if (/^(♩|q|Q)\.$/.test(raw)) {
    return { beatUnit: 'quarter', dots: 1 }
  }
  if (/^(♪|e|E)\.$/.test(raw)) {
    return { beatUnit: 'eighth', dots: 1 }
  }
  return null
}

function parseCombinedMetronome(text) {
  const normalized = String(text ?? '').trim()
  if (!normalized) {
    return null
  }
  // quarter note = 120 | ♩ = 120 | q. = 72 | SMuFL note = N
  const match = normalized.match(
    /^(?:\u2669|\u266a|[\ueca0-\uecb6]|q\.?|Q\.?|e\.?|E\.?|h\.?|H\.?)\s*=\s*(\d{2,3})$/,
  )
  if (!match) {
    return null
  }
  const left = normalized.slice(0, normalized.indexOf('=')).trim()
  const beat = classifyBeatUnitToken(left) ?? { beatUnit: 'quarter', dots: left.endsWith('.') ? 1 : 0 }
  if (left.includes('.') && beat.dots === 0 && /^(?:\u2669|q|Q)$/i.test(left.replace('.', ''))) {
    beat.dots = 1
  }
  const markBpm = Number(match[1])
  if (!Number.isFinite(markBpm) || markBpm < MARK_BPM_BOUNDS.min || markBpm > MARK_BPM_BOUNDS.max) {
    return { kind: 'metronome', rejected: true, markBpm, beatUnit: beat.beatUnit, dots: beat.dots }
  }
  const quarterBpm = toQuarterBpm(markBpm, beat.beatUnit, beat.dots)
  if (quarterBpm == null) {
    return { kind: 'metronome', rejected: true, markBpm, beatUnit: beat.beatUnit, dots: beat.dots }
  }
  return {
    kind: 'metronome',
    beatUnit: beat.beatUnit,
    dots: beat.dots,
    markBpm,
    bpm: quarterBpm,
    quarterBpm,
    confidence: 0.9,
    source: 'metronome-mark',
  }
}

/**
 * Group neighboring note / equals / digit glyphs into one metronome mark.
 */
function groupMetronomeComponents(items) {
  const norms = items.map((item) => ({ ...pdfItemToNorm(item), raw: item }))
  const marks = []
  const used = new Set()

  for (let index = 0; index < norms.length; index += 1) {
    if (used.has(index)) {
      continue
    }
    const beat = classifyBeatUnitToken(norms[index].text)
    if (!beat) {
      continue
    }
    // Look ahead for optional dot, equals, digits in reading order.
    let dots = beat.dots
    let equalsIndex = -1
    let bpmIndex = -1
    for (let ahead = index + 1; ahead < Math.min(norms.length, index + 8); ahead += 1) {
      if (used.has(ahead)) {
        continue
      }
      const next = norms[ahead]
      if (Math.abs(next.midY - norms[index].midY) > 0.025) {
        continue
      }
      if (next.midX < norms[index].midX - 0.005) {
        continue
      }
      if ((next.text === '.' || next.text === '·') && dots === 0) {
        dots = 1
        used.add(ahead)
        continue
      }
      if (next.text === '=' || next.text === '＝') {
        equalsIndex = ahead
        continue
      }
      if (equalsIndex >= 0 && /^\d{2,3}$/.test(next.text)) {
        bpmIndex = ahead
        break
      }
      // Combined "=120"
      if (/^=\s*\d{2,3}$/.test(next.text)) {
        equalsIndex = ahead
        bpmIndex = ahead
        break
      }
    }
    if (bpmIndex < 0) {
      continue
    }
    const bpmText = norms[bpmIndex].text.replace(/^[=\s]+/, '')
    const markBpm = Number(bpmText)
    used.add(index)
    used.add(bpmIndex)
    if (equalsIndex >= 0) {
      used.add(equalsIndex)
    }
    if (!Number.isFinite(markBpm) || markBpm < MARK_BPM_BOUNDS.min || markBpm > MARK_BPM_BOUNDS.max) {
      marks.push({
        kind: 'metronome',
        rejected: true,
        markBpm,
        beatUnit: beat.beatUnit,
        dots,
        ...norms[index],
        midX: norms[bpmIndex].midX,
        words: null,
      })
      continue
    }
    const quarterBpm = toQuarterBpm(markBpm, beat.beatUnit, dots)
    if (quarterBpm == null) {
      marks.push({
        kind: 'metronome',
        rejected: true,
        markBpm,
        beatUnit: beat.beatUnit,
        dots,
        ...norms[index],
        midX: norms[bpmIndex].midX,
      })
      continue
    }
    marks.push({
      kind: 'metronome',
      beatUnit: beat.beatUnit,
      dots,
      markBpm,
      bpm: quarterBpm,
      quarterBpm,
      confidence: 0.92,
      source: 'metronome-mark',
      midX: (norms[index].midX + norms[bpmIndex].midX) / 2,
      midY: norms[index].midY,
      x0: norms[index].x0,
      x1: norms[bpmIndex].x1,
      y0: Math.min(norms[index].y0, norms[bpmIndex].y0),
      y1: Math.max(norms[index].y1, norms[bpmIndex].y1),
    })
  }
  return marks
}

export function collectTempoCandidatesFromText(pageText = [], { pageNumber = 1 } = {}) {
  if (!Array.isArray(pageText) || !pageText.length) {
    return []
  }
  const candidates = []
  const usedIndices = new Set()

  // Combined single-item marks first.
  pageText.forEach((item, index) => {
    const norm = pdfItemToNorm(item)
    if (!norm.text || norm.text.length > 48) {
      return
    }
    const combined = parseCombinedMetronome(norm.text)
    if (combined) {
      usedIndices.add(index)
      candidates.push({ ...combined, ...norm })
      return
    }
    const bpmText = norm.text.match(/\b(\d{2,3})\s*bpm\b/i)
    if (bpmText && norm.text.length <= 40) {
      const markBpm = Number(bpmText[1])
      const quarterBpm = toQuarterBpm(markBpm, 'quarter', 0)
      usedIndices.add(index)
      if (quarterBpm == null) {
        candidates.push({ kind: 'bpm-text', rejected: true, markBpm, ...norm })
        return
      }
      candidates.push({
        kind: 'bpm-text',
        beatUnit: 'quarter',
        dots: 0,
        markBpm,
        bpm: quarterBpm,
        quarterBpm,
        confidence: 0.86,
        source: 'bpm-text',
        ...norm,
      })
      return
    }
    if (TEMPO_WORD_RE.test(norm.text) && !/\s{2,}/.test(norm.text)) {
      // Reject likely titles ("Allegro Sonata") — exact token or short phrase only.
      const word = norm.text.replace(/\s+/g, ' ').trim()
      if (word.length > 16) {
        return
      }
      usedIndices.add(index)
      const key = word.toLowerCase().replace(/\s+/g, ' ')
      const mapped =
        key === 'a tempo' || key === 'atempo'
          ? null
          : TEMPO_WORD_BPM[key] ?? TEMPO_WORD_BPM[key.replace(/\s+/g, '')]
      const entry = {
        kind: 'word',
        words: word,
        confidence: 0.78,
        source: `word:${key}`,
        beatUnit: null,
        dots: 0,
        markBpm: null,
        ...norm,
      }
      if (mapped != null && isPlayableBpm(mapped)) {
        entry.bpm = mapped
        entry.quarterBpm = mapped
      } else if (key === 'a tempo' || key === 'atempo') {
        entry.aTempo = true
      }
      // Later pages: ignore header-band noise, but keep exact mapped tempo words /
      // a tempo even near the top — system-start Presto/Allegro is common there.
      if (pageNumber > 1 && norm.midY < 0.08 && mapped == null && !entry.aTempo) {
        return
      }
      candidates.push(entry)
      return
    }
    // Short expressive phrases that begin with (or contain) a tempo word.
    // Applies on every page — "Moderato cantabile" often appears mid-score.
    if (norm.text.length <= 40) {
      const leading = norm.text.match(LEADING_TEMPO_WORD_RE)
      const embedded = leading ?? norm.text.match(EMBEDDED_TEMPO_WORD_RE)
      if (embedded) {
        const key = embedded[1].toLowerCase()
        const mapped = TEMPO_WORD_BPM[key]
        const geometryKnown = (item.pageWidth ?? 0) > 1 && (item.pageHeight ?? 0) > 1
        // Page-1 titles mid-page: require leading word or header band.
        // Later pages: allow staff-band phrases (reject only extreme footer).
        if (pageNumber === 1 && geometryKnown && !leading && norm.midY >= 0.25) {
          return
        }
        if (pageNumber > 1 && geometryKnown && norm.midY > 0.97) {
          return
        }
        if (mapped != null && isPlayableBpm(mapped)) {
          usedIndices.add(index)
          candidates.push({
            kind: 'word',
            // Preserve the printed phrase when the tempo word leads it.
            words: leading ? norm.text.replace(/\s+/g, ' ').trim() : embedded[1],
            bpm: mapped,
            quarterBpm: mapped,
            confidence: leading ? 0.76 : 0.74,
            source: `word:${key}`,
            beatUnit: null,
            dots: 0,
            markBpm: null,
            ...norm,
          })
        }
      }
    }
  })

  // Separated glyph components (skip items already consumed as combined marks).
  const remaining = pageText.filter((_, index) => !usedIndices.has(index))
  for (const mark of groupMetronomeComponents(remaining)) {
    candidates.push(mark)
  }

  // Joined-string fallback for OCR that concatenates tokens.
  if (!candidates.some((entry) => entry.kind === 'metronome' && !entry.rejected)) {
    const joined = pageText.map((item) => String(item.text ?? '').trim()).filter(Boolean).join(' ')
    const joinedMatch = joined.match(
      /(?:\u2669|\u266a|[\ueca0-\uecb6]|q\.?|Q\.?)\s*=\s*(\d{2,3})/i,
    )
    if (joinedMatch) {
      const markBpm = Number(joinedMatch[1])
      const quarterBpm = toQuarterBpm(markBpm, 'quarter', /q\./i.test(joinedMatch[0]) ? 1 : 0)
      if (quarterBpm != null) {
        candidates.push({
          kind: 'metronome',
          beatUnit: /q\./i.test(joinedMatch[0]) ? 'quarter' : 'quarter',
          dots: /\./.test(joinedMatch[0].split('=')[0]) ? 1 : 0,
          markBpm,
          bpm: quarterBpm,
          quarterBpm,
          confidence: 0.84,
          source: 'metronome-mark',
          midX: 0.15,
          midY: 0.12,
          x0: 0.1,
          x1: 0.25,
          y0: 0.1,
          y1: 0.14,
        })
      }
    }
  }

  return candidates.filter((entry) => !entry.rejected)
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

function onsetDivisionForX(measureBox, xNorm, totalDivisions = 16) {
  const left = measureBox.playableX0 ?? measureBox.x0
  const right = measureBox.x1
  const span = Math.max(1e-6, right - left)
  const t = Math.min(1, Math.max(0, (xNorm - left) / span))
  return Math.round(t * totalDivisions)
}

/**
 * Associate tempo candidates to measures. Prefer the system whose vertical band
 * contains the mark; reject attaching into a neighboring system far below.
 */
export function associateTemposToMeasures(candidates, systemMeasureBoxes, { totalDivisions = 16 } = {}) {
  const boxes = systemMeasureBoxes.flat().map(normalizeMeasureBox)
  const byMeasure = new Map()

  for (const candidate of candidates) {
    let best = null
    for (const box of boxes) {
      // Tempo marks sit above or near the top of the staff, not deep in the system.
      if (candidate.midY > box.y1 + 0.05) {
        continue
      }
      if (candidate.midY < box.y0 - 0.12) {
        continue
      }
      if (candidate.midX < box.x0 - 0.02 || candidate.midX > box.x1 + 0.02) {
        continue
      }
      const yDist = Math.abs(candidate.midY - box.y0)
      const xDist = Math.abs(candidate.midX - (box.playableX0 + box.x1) / 2)
      const score = yDist * 2 + xDist
      if (!best || score < best.score) {
        best = { box, score }
      }
    }
    // Fall back: first system first measure for page-header tempos.
    if (!best && boxes.length && candidate.midY < 0.25) {
      best = { box: boxes[0], score: 99 }
    }
    if (!best) {
      continue
    }
    const measureNumber = best.box.measureNumber
    if (!byMeasure.has(measureNumber)) {
      byMeasure.set(measureNumber, [])
    }
    byMeasure.get(measureNumber).push({
      kind: candidate.kind,
      beatUnit: candidate.beatUnit,
      dots: candidate.dots ?? 0,
      markBpm: candidate.markBpm,
      bpm: candidate.quarterBpm ?? candidate.bpm,
      quarterBpm: candidate.quarterBpm ?? candidate.bpm,
      words: candidate.words ?? null,
      aTempo: Boolean(candidate.aTempo),
      confidence: candidate.confidence,
      source: candidate.source,
      onsetDivision: onsetDivisionForX(best.box, candidate.midX, totalDivisions),
    })
  }
  return byMeasure
}

export function resolveATempo(markings, previousQuarterBpm) {
  return markings.map((mark) => {
    if (!mark.aTempo) {
      return mark
    }
    if (!isPlayableBpm(previousQuarterBpm)) {
      return { ...mark, bpm: null, quarterBpm: null }
    }
    return {
      ...mark,
      bpm: previousQuarterBpm,
      quarterBpm: previousQuarterBpm,
      source: 'a-tempo',
    }
  })
}

export function attachTemposToMeasureRecords({
  measureRecords,
  systemMeasureBoxes,
  pageText,
  pageNumber = 1,
}) {
  const candidates = collectTempoCandidatesFromText(pageText, { pageNumber })
  const byMeasure = associateTemposToMeasures(candidates, systemMeasureBoxes)

  let previousBpm = null
  const sorted = [...measureRecords].sort((a, b) => a.measureNumber - b.measureNumber)
  for (const record of sorted) {
    let markings = byMeasure.get(record.measureNumber) ?? []
    markings = resolveATempo(markings, previousBpm)
    // Deduplicate identical marks on the same measure/onset.
    const seen = new Set()
    markings = markings.filter((mark) => {
      const key = `${mark.onsetDivision}|${mark.quarterBpm ?? ''}|${mark.words ?? ''}|${mark.beatUnit ?? ''}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    if (markings.length) {
      record.tempoMarkings = markings
      for (const mark of markings) {
        if (isPlayableBpm(mark.quarterBpm)) {
          previousBpm = mark.quarterBpm
        }
      }
    }
  }
  return measureRecords
}

/**
 * Page-level helper retained for pipeline: best initial tempo for musical.tempo.
 */
export function parseTempoFromTextItems(items = [], { pageNumber = 1 } = {}) {
  const candidates = collectTempoCandidatesFromText(items, { pageNumber }).filter(
    (entry) => isPlayableBpm(entry.quarterBpm ?? entry.bpm),
  )
  if (!candidates.length) {
    return { bpm: OMR_DEFAULT_TEMPO, confidence: 0, fromDefault: true, source: 'default' }
  }
  // Prefer metronome / bpm-text over words; prefer higher confidence.
  candidates.sort((a, b) => {
    const rank = (entry) =>
      entry.kind === 'metronome' ? 3 : entry.kind === 'bpm-text' ? 2 : 1
    return rank(b) - rank(a) || (b.confidence ?? 0) - (a.confidence ?? 0)
  })
  // On page > 1, ignore word-only unless metronome/bpm-text.
  const chosen =
    pageNumber > 1
      ? candidates.find((entry) => entry.kind === 'metronome' || entry.kind === 'bpm-text')
      : candidates[0]
  if (!chosen) {
    return { bpm: OMR_DEFAULT_TEMPO, confidence: 0, fromDefault: true, source: 'default' }
  }
  return {
    bpm: chosen.quarterBpm ?? chosen.bpm,
    confidence: chosen.confidence,
    fromDefault: false,
    source: chosen.source,
    beatUnit: chosen.beatUnit,
    dots: chosen.dots ?? 0,
    markBpm: chosen.markBpm ?? chosen.quarterBpm ?? chosen.bpm,
    words: chosen.words ?? null,
  }
}

export function shouldEmitTempo(tempo) {
  return (
    tempo &&
    !tempo.fromDefault &&
    isPlayableBpm(tempo.bpm) &&
    (tempo.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.TEMPO
  )
}

export function shouldEmitTempoMarking(marking) {
  return (
    marking &&
    (marking.confidence ?? 0) >= OMR_MUSICAL_CONFIDENCE.TEMPO &&
    (Boolean(marking.words) ||
      isPlayableBpm(marking.quarterBpm ?? marking.bpm) ||
      (marking.markBpm != null && marking.beatUnit))
  )
}

/** Initial musical.tempo object from measure tempo markings (first playable). */
export function initialTempoFromMeasureRecords(measureRecords = []) {
  for (const record of [...measureRecords].sort((a, b) => a.measureNumber - b.measureNumber)) {
    for (const mark of record.tempoMarkings ?? []) {
      if (isPlayableBpm(mark.quarterBpm ?? mark.bpm)) {
        return {
          bpm: mark.quarterBpm ?? mark.bpm,
          confidence: mark.confidence,
          fromDefault: false,
          source: mark.source,
          beatUnit: mark.beatUnit,
          dots: mark.dots ?? 0,
          markBpm: mark.markBpm,
          words: mark.words,
        }
      }
    }
  }
  return { bpm: OMR_DEFAULT_TEMPO, confidence: 0, fromDefault: true, source: 'default' }
}
