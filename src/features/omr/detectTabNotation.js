import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'

/**
 * Tablature detection for the vector OMR engine (guitar foundation).
 *
 * Pure functions over the primitives the engine already produces — detected
 * staves (line counts + line y positions), measure boxes, and positioned text
 * glyphs — so nothing here renders, rasterizes, or touches the piano paths.
 *
 * Supported inputs:
 *   - TAB staves: 6-line staves (per string-count hint), confirmed by a SMuFL
 *     TAB clef glyph or a vertical "T A B" letter stack when present.
 *   - Fret digits: plain text digits placed on string lines; adjacent digits
 *     on the same string cluster into multi-digit frets (10–24).
 *
 * Rhythm for TAB-only sources is positional (beat-slot) inference — honest
 * MVP behavior, flagged uncertain — because tablature carries no reliable
 * duration information without stems/flags analysis (future polish).
 */

/** SMuFL tablature clefs: 6-string and 4-string. */
export const TAB_CLEF_GLYPHS = new Set(['\uE06D', '\uE06E'])
export const TAB_APPROXIMATE_RHYTHM_WARNING =
  'TAB notes detected — rhythm is approximate. Playback uses even spacing within each measure.'
export const TAB_REPEAT_CODA_WARNING =
  'Repeat/coda markings were detected but not fully expanded. Playback follows the written measure order.'
export const TAB_CAPO_UNSUPPORTED_WARNING =
  'Capo marking detected — generated playback does not transpose for capo.'
export const TAB_TEMPO_TEXT_WARNING =
  'Tempo change text was detected but not interpreted. Playback keeps one steady tempo.'

const DIGIT_RE = /^[0-9]$/
const STAFF_LINE_COLLAPSE_EPSILON = 0.003
const TAB_SOURCE_TEXT_RE = /^[\d\s\-–—|/\\]+$/

/**
 * Split a detected system's staves into notation vs tablature staves.
 *
 * A staff is tablature when its detected line count matches the instrument's
 * string count (6) — 5-line staves are standard notation. Systems detected as
 * one merged band (no per-staff breakdown) stay notation-only.
 */
export function classifySystemStaves(system, { stringCount = 6 } = {}) {
  // Multi-stave systems carry a `staves` array; single-stave systems ARE the
  // stave (lineCount/lineYs at the top level).
  const staves =
    system?.staves ?? (system?.lineCount != null ? [system] : [])
  const notationStaves = []
  const tabStaves = []
  for (const stave of staves) {
    const tabLineYs = resolveTabLineYs(stave, stringCount)
    if (tabLineYs) {
      tabStaves.push({ ...stave, lineYs: tabLineYs })
    } else {
      notationStaves.push(stave)
    }
  }
  return { notationStaves, tabStaves }
}

function resolveTabLineYs(stave, stringCount) {
  const detectedLineYs = Array.isArray(stave?.detectedLineYs) ? stave.detectedLineYs : null
  if (detectedLineYs?.length === stringCount) {
    return detectedLineYs
  }
  const collapsedDetectedLineYs = collapseNearbyStaffLineYs(detectedLineYs)
  if (collapsedDetectedLineYs?.length === stringCount) {
    return collapsedDetectedLineYs
  }

  const lineYs = Array.isArray(stave?.lineYs) ? stave.lineYs : null
  return lineYs?.length === stringCount ? lineYs : null
}

function collapseNearbyStaffLineYs(lineYs) {
  if (!Array.isArray(lineYs) || lineYs.length === 0) {
    return null
  }
  const sorted = lineYs
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (!sorted.length) {
    return null
  }

  const collapsed = []
  let group = [sorted[0]]
  for (let index = 1; index < sorted.length; index += 1) {
    const y = sorted[index]
    const previous = group[group.length - 1]
    if (y - previous <= STAFF_LINE_COLLAPSE_EPSILON) {
      group.push(y)
      continue
    }
    collapsed.push(average(group))
    group = [y]
  }
  collapsed.push(average(group))
  return collapsed
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** True when any detected system contains a tablature staff. */
export function systemsContainTablature(systems, options = {}) {
  return (systems ?? []).some(
    (system) => classifySystemStaves(system, options).tabStaves.length > 0,
  )
}

/**
 * Assign a role to each detected system band on a fretted-instrument page:
 *   - 'notation'  standard staff (or anything that isn't tablature),
 *   - 'mixed'     one band containing both a notation and a TAB staff,
 *   - 'tab'       a TAB band; `pairedWithIndex` points at the notation band
 *                 directly above when they engrave the same measures (the
 *                 common notation-over-tab layout), else null (TAB-only).
 *
 * Pairing keeps measure numbering honest: a paired TAB band re-reads its
 * partner's measures instead of counting new ones.
 */
export function resolveGuitarSystemRoles(systems, { stringCount = 6 } = {}) {
  const list = systems ?? []
  return list.map((system, index) => {
    const { tabStaves, notationStaves } = classifySystemStaves(system, { stringCount })
    if (tabStaves.length > 0 && notationStaves.length > 0) {
      return { kind: 'mixed', pairedWithIndex: null, tabStave: tabStaves[0] }
    }
    if (tabStaves.length === 0) {
      return { kind: 'notation', pairedWithIndex: null, tabStave: null }
    }

    const previous = list[index - 1]
    if (previous) {
      const previousRoles = classifySystemStaves(previous, { stringCount })
      const previousIsNotation = previousRoles.tabStaves.length === 0
      const previousHeight = Math.max(0.01, (previous.y1 ?? 0) - (previous.y0 ?? 0))
      const gap = (system.y0 ?? 0) - (previous.y1 ?? 0)
      const proximityPairs = gap >= 0 && gap <= previousHeight * 2.4
      // Paired bands engrave the same measures, so their barline structure
      // matches. Count agreement rescues pairing on spacious layouts (section
      // text between bands pushes the gap past the proximity bound) — a missed
      // pair is worse than a false one because both bands then emit measures,
      // double-counting the system.
      const structurePairs =
        (system.barlineCount ?? 0) >= 2 &&
        system.barlineCount === previous.barlineCount
      if (previousIsNotation && (proximityPairs || structurePairs)) {
        return { kind: 'tab', pairedWithIndex: index - 1, tabStave: tabStaves[0] }
      }
    }
    return { kind: 'tab', pairedWithIndex: null, tabStave: tabStaves[0] }
  })
}

/** Group tab notes by measure number for quick per-measure attachment. */
export function groupTabNotesByMeasure(tabNotes) {
  const byMeasure = new Map()
  for (const note of tabNotes ?? []) {
    const bucket = byMeasure.get(note.measureNumber)
    if (bucket) {
      bucket.push(note)
    } else {
      byMeasure.set(note.measureNumber, [note])
    }
  }
  return byMeasure
}

/**
 * Confirmation signal: a SMuFL TAB clef glyph (or vertical T/A/B letter stack)
 * within the staff's vertical band near the system start. Absence does not
 * veto a 6-line staff — some engravers omit the clef on continuation systems.
 */
export function hasTabClefNearStaff(glyphs, tabStave, imageData, { maxXNorm = 0.2 } = {}) {
  if (!glyphs?.length || !tabStave?.lineYs?.length || !imageData) {
    return false
  }
  const top = tabStave.lineYs[0]
  const bottom = tabStave.lineYs[tabStave.lineYs.length - 1]
  const gap = (bottom - top) / Math.max(1, tabStave.lineYs.length - 1)
  const inBand = (glyph) => {
    const yNorm = glyph.y / imageData.height
    return yNorm >= top - gap && yNorm <= bottom + gap
  }
  const nearStart = (glyph) => glyph.x / imageData.width <= maxXNorm

  const letters = { t: false, a: false, b: false }
  for (const glyph of glyphs) {
    if (!nearStart(glyph) || !inBand(glyph)) {
      continue
    }
    const char = (glyph.text ?? '').toLowerCase()
    if (TAB_CLEF_GLYPHS.has(glyph.text)) {
      return true
    }
    if (char === 't') letters.t = true
    if (char === 'a') letters.a = true
    if (char === 'b') letters.b = true
  }
  return letters.t && letters.a && letters.b
}

/** Nearest string line (1-based, top line = string 1) for a y position. */
export function stringForY(yNorm, lineYs, { maxDistanceFactor = 0.75 } = {}) {
  if (!lineYs?.length) {
    return null
  }
  const gap =
    lineYs.length > 1 ? (lineYs[lineYs.length - 1] - lineYs[0]) / (lineYs.length - 1) : 0.01
  let best = null
  let bestDistance = Infinity
  for (let index = 0; index < lineYs.length; index += 1) {
    const distance = Math.abs(yNorm - lineYs[index])
    if (distance < bestDistance) {
      bestDistance = distance
      best = index + 1
    }
  }
  if (gap > 0 && bestDistance > gap * maxDistanceFactor) {
    return null // too far from any string line to be a fret digit
  }
  return best
}

function tabLineGap(lineYs) {
  if (!lineYs?.length || lineYs.length < 2) {
    return 0.01
  }
  return (lineYs[lineYs.length - 1] - lineYs[0]) / (lineYs.length - 1)
}

function sourceTextLooksLikeTabDigits(glyph) {
  const sourceText = glyph.sourceText
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    return true
  }
  return TAB_SOURCE_TEXT_RE.test(sourceText)
}

function glyphSizeLooksLikeFretDigit(glyph, tabStave, imageData) {
  const gapPx = tabLineGap(tabStave?.lineYs) * imageData.height
  if (!Number.isFinite(gapPx) || gapPx <= 0) {
    return true
  }
  const height = Number(glyph.height ?? gapPx)
  const width = Number(glyph.width ?? gapPx * 0.6)
  // Large page watermarks can cross a string line and contain digits; fret
  // digits are roughly staff-gap sized, not several string gaps tall.
  return height <= gapPx * 2.2 && width <= gapPx * 1.8
}

function isLikelyTabFretGlyph(glyph, tabStave, imageData) {
  return (
    DIGIT_RE.test(glyph.text ?? '') &&
    sourceTextLooksLikeTabDigits(glyph) &&
    glyphSizeLooksLikeFretDigit(glyph, tabStave, imageData)
  )
}

/**
 * Extract fret digits on one TAB staff into tab notes.
 *
 * @param {Array} glyphs      Positioned page glyphs (textGlyphsToImage output,
 *                            pixel coordinates).
 * @param {object} tabStave   Detected staff with normalized lineYs.
 * @param {Array} measureBoxes Measure boxes for the staff's system.
 * @param {object} imageData  Page dimensions ({ width, height }).
 * @param {object} options    { tuning, fretCount } — string 1 first.
 * @returns notes: { string, fret, midi, x, xNorm, measureNumber, positionInMeasure }
 */
export function extractTabDigitNotes(glyphs, tabStave, measureBoxes, imageData, options = {}) {
  const { tuning = [64, 59, 55, 50, 45, 40], fretCount = 24 } = options
  if (!glyphs?.length || !tabStave?.lineYs?.length || !imageData) {
    return []
  }

  // Digit glyphs inside the staff band, tagged with their string line.
  const digits = []
  for (const glyph of glyphs) {
    if (!isLikelyTabFretGlyph(glyph, tabStave, imageData)) {
      continue
    }
    const string = stringForY(glyph.y / imageData.height, tabStave.lineYs)
    if (string == null) {
      continue
    }
    digits.push({ ...glyph, string })
  }
  digits.sort((left, right) => left.string - right.string || left.x - right.x)

  // Cluster horizontally-adjacent digits on the same string into one fret
  // number ("1" "2" → 12). Real engraving keeps digit pairs tight (< 1 glyph
  // width apart) while distinct notes sit at least a notehead apart.
  const clusters = []
  for (const digit of digits) {
    const last = clusters[clusters.length - 1]
    const width = Math.max(2, digit.width || 4)
    if (
      last &&
      last.string === digit.string &&
      digit.x - last.lastX <= width * 1.1
    ) {
      last.text += digit.text
      last.lastX = digit.x
      last.xSum += digit.x
      last.count += 1
      continue
    }
    clusters.push({
      string: digit.string,
      text: digit.text,
      firstX: digit.x,
      lastX: digit.x,
      xSum: digit.x,
      count: 1,
    })
  }

  const notes = []
  for (const cluster of clusters) {
    const fret = Number(cluster.text)
    if (!Number.isFinite(fret) || fret > fretCount) {
      continue
    }
    const open = tuning[cluster.string - 1]
    if (open == null) {
      continue
    }
    const x = cluster.xSum / cluster.count
    const xNorm = x / imageData.width
    const box = findMeasureBoxForX(measureBoxes, xNorm)
    if (!box) {
      continue // clef-zone / margin digits (time signatures, fingering keys)
    }
    notes.push({
      string: cluster.string,
      fret,
      midi: open + fret,
      // Tab-derived pitch is already sounding pitch — emission must not apply
      // the written-octave shift used for staff-position pitches.
      soundingPitch: true,
      x,
      xNorm,
      measureNumber: box.measureNumber,
      positionInMeasure: positionWithinBox(box, xNorm),
    })
  }
  notes.sort(
    (left, right) => left.measureNumber - right.measureNumber || left.x - right.x,
  )
  return notes
}

function findMeasureBoxForX(measureBoxes, xNorm) {
  for (const box of measureBoxes ?? []) {
    // TAB digits are musical content, so measure assignment must use the raw
    // barline boundary. `playableX0` is cursor metadata and can skip beat 1.
    const start = box.x0
    if (xNorm >= start && xNorm <= box.x1) {
      return box
    }
  }
  return null
}

function positionWithinBox(box, xNorm) {
  const start = box.x0
  const span = box.x1 - start
  if (span <= 0) {
    return 0
  }
  return Math.min(1, Math.max(0, (xNorm - start) / span))
}

/** Same-onset grouping tolerance as a fraction of the measure width. */
const CHORD_X_EPSILON = 0.045
const TAB_MAX_ONSETS_PER_4_4 = 8

function durationTypeForTabDuration(durationDivisions) {
  if (durationDivisions >= OMR_DIVISIONS_PER_QUARTER) {
    return 'quarter'
  }
  if (durationDivisions >= OMR_DIVISIONS_PER_QUARTER / 2) {
    return 'eighth'
  }
  return '16th'
}

function buildTabTimingBuckets(groups, { beats = 4 } = {}) {
  const totalDivisions = beats * OMR_DIVISIONS_PER_QUARTER
  if (!groups.length) {
    return {
      buckets: [],
      timingModel: {
        kind: 'tab-approximate-even',
        approximate: true,
        maxOnsets: 0,
        coalesced: false,
      },
    }
  }

  const maxOnsets = Math.max(
    1,
    Math.min(beats * 2, TAB_MAX_ONSETS_PER_4_4, totalDivisions),
  )
  const slotCount = groups.length <= beats ? beats : maxOnsets
  const buckets = Array.from({ length: slotCount }, (_, slot) => ({
    slot,
    positionInMeasure: slotCount > 1 ? slot / (slotCount - 1) : 0,
    notes: [],
    x: null,
  }))

  for (const group of groups) {
    const slot = Math.min(
      slotCount - 1,
      Math.max(0, Math.round(group.positionInMeasure * (slotCount - 1))),
    )
    const bucket = buckets[slot]
    bucket.notes.push(...group.notes)
    bucket.x = bucket.x == null ? group.notes[0]?.x ?? null : bucket.x
    bucket.positionInMeasure = Math.min(bucket.positionInMeasure, group.positionInMeasure)
  }

  const usedBuckets = buckets.filter((bucket) => bucket.notes.length > 0)
  const durationDivisions = Math.max(1, Math.round(totalDivisions / slotCount))
  return {
    buckets: usedBuckets.map((bucket) => ({
      ...bucket,
      startDivision: Math.min(
        totalDivisions - durationDivisions,
        Math.round(bucket.slot * durationDivisions),
      ),
      durationDivisions,
    })),
    timingModel: {
      kind: 'tab-approximate-even',
      approximate: true,
      maxOnsets,
      slotCount,
      coalesced: groups.length > usedBuckets.length,
    },
  }
}

/**
 * Assemble tab notes for one measure into positional note events (chords share
 * an onset). Durations are quarter-note placeholders on the beat-slot grid —
 * rhythm from tablature alone is inherently approximate, so measures built
 * this way are flagged `uncertain`.
 */
export function buildTabMeasureEvents(measureNotes, { beats = 4 } = {}) {
  if (!measureNotes?.length) {
    return {
      events: [],
      uncertain: true,
      rhythmApproximate: true,
      timingModel: {
        kind: 'tab-approximate-even',
        approximate: true,
        maxOnsets: 0,
        coalesced: false,
      },
    }
  }

  const sorted = [...measureNotes].sort((left, right) => left.positionInMeasure - right.positionInMeasure)
  const groups = []
  for (const note of sorted) {
    const last = groups[groups.length - 1]
    if (last && note.positionInMeasure - last.positionInMeasure <= CHORD_X_EPSILON) {
      last.notes.push(note)
      continue
    }
    groups.push({ positionInMeasure: note.positionInMeasure, notes: [note] })
  }

  const { buckets, timingModel } = buildTabTimingBuckets(groups, { beats })
  const events = []
  for (const bucket of buckets) {
    events.push({
      type: 'note',
      startDivision: bucket.startDivision,
      durationDivisions: bucket.durationDivisions,
      durationType: durationTypeForTabDuration(bucket.durationDivisions),
      dotted: false,
      rhythmApproximate: true,
      timingModel,
      cx: bucket.x ?? bucket.notes[0]?.x ?? 0,
      notes: bucket.notes.map((note) => ({
        midi: note.midi,
        string: note.string,
        fret: note.fret,
        soundingPitch: true,
        clef: 'treble',
        cx: note.x,
      })),
    })
  }

  return {
    events: mergeTabEventsWithSameStart(events),
    uncertain: true,
    rhythmApproximate: true,
    timingModel,
  }
}

function mergeTabEventsWithSameStart(events) {
  const merged = []
  for (const event of events) {
    const previous = merged[merged.length - 1]
    if (previous && previous.startDivision === event.startDivision) {
      previous.notes.push(...(event.notes ?? []))
      continue
    }
    merged.push({ ...event, notes: [...(event.notes ?? [])] })
  }
  return merged
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function compactWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function detectTabTextAnnotations(pageText = []) {
  const text = compactWhitespace(
    pageText
      .map((item) => item?.text ?? '')
      .filter(Boolean)
      .join(' '),
  )
  const lower = text.toLowerCase()
  const markers = []
  const warnings = []

  const capoMatch = text.match(/\bcapo\b(?:\s*(?:on|at|fret))?\s*([0-9ivx]+)?/i)
  const capoText = capoMatch ? compactWhitespace(capoMatch[0]) : null
  if (capoText) {
    markers.push('capo')
    warnings.push(capoText ? `${TAB_CAPO_UNSUPPORTED_WARNING} (${capoText})` : TAB_CAPO_UNSUPPORTED_WARNING)
  }

  const hasDsCoda =
    /\bd\.?\s*s\.?(?:\s+al)?\s+coda\b/i.test(text) ||
    /\bd\.?\s*s\.?\b/i.test(text)
  const hasCoda = /\bcoda\b/i.test(text)
  const hasVoltaText =
    /(?:\b(?:1st|2nd|3rd)\b|\b[123]\.)\s*(?:time|ending)?/i.test(text)
  if (hasDsCoda || hasCoda || hasVoltaText) {
    if (hasDsCoda) markers.push('d-s-coda')
    if (hasCoda) markers.push('coda')
    if (hasVoltaText) markers.push('repeat-ending')
    warnings.push(TAB_REPEAT_CODA_WARNING)
  }

  if (/\brit\.|\britard|\brall\./i.test(lower)) {
    markers.push('tempo-text')
    warnings.push(TAB_TEMPO_TEXT_WARNING)
  }

  return {
    capoText,
    unsupportedMarkers: unique(markers),
    warnings: unique(warnings),
  }
}

/**
 * Attach TAB positions to measure events produced by the notation-staff path
 * (mixed notation+TAB systems). Events pair with tab onsets by x proximity;
 * within a pair, notes map high-to-high (string 1 = highest pitch).
 * Mutates nothing — returns a new events array; unmatched events pass through.
 */
export function attachTabPositionsToEvents(events, tabNotes, { xTolerance = 18 } = {}) {
  if (!events?.length || !tabNotes?.length) {
    return { events: events ?? [], attachedCount: 0 }
  }

  // Group tab notes into onsets by x.
  const onsets = []
  const sorted = [...tabNotes].sort((left, right) => left.x - right.x)
  for (const note of sorted) {
    const last = onsets[onsets.length - 1]
    if (last && Math.abs(note.x - last.x) <= xTolerance * 0.6) {
      last.notes.push(note)
      continue
    }
    onsets.push({ x: note.x, notes: [note], used: false })
  }

  let attachedCount = 0
  const nextEvents = events.map((event) => {
    if (event.type !== 'note' || !event.notes?.length) {
      return event
    }
    const eventX = event.cx ?? event.notes[0]?.cx ?? null
    if (eventX == null) {
      return event
    }
    let best = null
    for (const onset of onsets) {
      if (onset.used) {
        continue
      }
      const distance = Math.abs(onset.x - eventX)
      if (distance <= xTolerance && (!best || distance < Math.abs(best.x - eventX))) {
        best = onset
      }
    }
    if (!best) {
      return event
    }
    best.used = true

    // Highest pitch ↔ string 1 (lowest string number).
    const byPitchDesc = [...event.notes].sort((left, right) => (right.midi ?? 0) - (left.midi ?? 0))
    const byStringAsc = [...best.notes].sort((left, right) => left.string - right.string)
    const positionByNote = new Map()
    for (let index = 0; index < byPitchDesc.length && index < byStringAsc.length; index += 1) {
      positionByNote.set(byPitchDesc[index], byStringAsc[index])
      attachedCount += 1
    }

    return {
      ...event,
      notes: event.notes.map((note) => {
        const position = positionByNote.get(note)
        return position ? { ...note, string: position.string, fret: position.fret } : note
      }),
    }
  })

  return { events: nextEvents, attachedCount }
}
