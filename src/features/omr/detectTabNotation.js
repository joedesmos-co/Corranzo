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
export const TAB_COMPRESSED_TIMING_WARNING =
  'Dense TAB notes were compressed to a safe timing grid. Rhythm remains approximate.'
export const TAB_REPEAT_CODA_WARNING =
  'Repeat/coda markings were detected but not fully expanded. Playback follows the written measure order.'
export const TAB_CAPO_UNSUPPORTED_WARNING =
  'Capo marking detected — playback sounds at written TAB pitch; capo transposition is not applied.'
export const TAB_TEMPO_TEXT_WARNING =
  'Tempo change text was detected but not interpreted. Playback keeps one steady tempo.'
export const TAB_NO_USABLE_NOTES_MESSAGE =
  'TAB staff lines were detected, but Corranzo could not read enough fret digits or barlines for playback. Try a cleaner digital TAB PDF or upload MusicXML/MXL for accurate timing.'

const DIGIT_RE = /^[0-9]$/
const STAFF_LINE_COLLAPSE_EPSILON = 0.003
const TAB_SOURCE_TEXT_RE = /^[\d\s\-–—|/\\]+$/
const NOTEHEAD_GLYPH_RE = /^[\uE0A2-\uE0A4]$/
const TAB_TEXT_EVIDENCE_Y_PAD = 0.03

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
function inferTabLineYs(system, stringCount) {
  const exact = resolveTabLineYs(system, stringCount)
  if (exact) {
    return exact
  }
  const collapsed = collapseNearbyStaffLineYs(system?.detectedLineYs)
  if (!collapsed?.length) {
    return null
  }
  if (collapsed.length >= stringCount) {
    // Staff detection can admit an isolated volta/ledger line above TAB.
    // The bottom staff boundary is more reliable, so keep the final complete
    // six-line run instead of treating the extra line as string 1.
    return collapsed.slice(-stringCount)
  }
  if (collapsed.length < 2) {
    return null
  }
  const gaps = collapsed
    .slice(1)
    .map((value, index) => value - collapsed[index])
    .filter((value) => value > STAFF_LINE_COLLAPSE_EPSILON)
    .sort((left, right) => left - right)
  const gap = gaps[Math.floor(gaps.length / 2)]
  if (!Number.isFinite(gap) || gap <= 0) {
    return null
  }
  const missing = stringCount - collapsed.length
  const first = collapsed[0] - missing * gap
  return Array.from({ length: stringCount }, (_value, index) => first + index * gap)
}

function textEvidenceForSystem(system, glyphs, imageData) {
  if (!glyphs?.length || !imageData) {
    return { explicitTab: false, noteheadCount: 0, digitCount: 0 }
  }
  const letters = { t: false, a: false, b: false }
  let noteheadCount = 0
  let digitCount = 0
  for (const glyph of glyphs) {
    const yNorm = glyph.y / imageData.height
    if (
      yNorm < (system?.y0 ?? 0) - TAB_TEXT_EVIDENCE_Y_PAD ||
      yNorm > (system?.y1 ?? 1) + TAB_TEXT_EVIDENCE_Y_PAD
    ) {
      continue
    }
    const char = glyph.text ?? ''
    if (NOTEHEAD_GLYPH_RE.test(char)) {
      noteheadCount += 1
    }
    if (DIGIT_RE.test(char) && sourceTextLooksLikeTabDigits(glyph)) {
      digitCount += 1
    }
    if (glyph.x / imageData.width > 0.2) {
      continue
    }
    if (TAB_CLEF_GLYPHS.has(char)) {
      return { explicitTab: true, noteheadCount, digitCount }
    }
    const lower = char.toLowerCase()
    if (lower === 't') letters.t = true
    if (lower === 'a') letters.a = true
    if (lower === 'b') letters.b = true
  }
  return {
    explicitTab: letters.t && letters.a && letters.b,
    noteheadCount,
    digitCount,
  }
}

/**
 * Resolve guitar system roles using both staff geometry and vector glyph
 * evidence. Text evidence corrects two generic detector ambiguities:
 * ledger lines can make five-line notation look six-line, while fret-digit
 * knockouts can hide one or two TAB lines.
 */
export function resolveGuitarSystemRoles(
  systems,
  { stringCount = 6, glyphs = null, imageData = null } = {},
) {
  const list = systems ?? []
  const classified = list.map((system) => {
    const { tabStaves, notationStaves } = classifySystemStaves(system, { stringCount })
    const textEvidence = textEvidenceForSystem(system, glyphs, imageData)
    const inferredTabLineYs = textEvidence.explicitTab
      ? inferTabLineYs(system, stringCount)
      : null
    const inferredTabStave = inferredTabLineYs
      ? { ...system, lineYs: inferredTabLineYs }
      : null

    // Preserve already-trustworthy multi-stave geometry. Glyph padding is
    // deliberately wide enough to rescue broken TAB lines, so noteheads from
    // the paired notation band may also fall inside it and must not turn a
    // known TAB-only band into a mixed system.
    if (tabStaves.length > 0 && notationStaves.length > 0) {
      return {
        kind: 'mixed',
        tabStave: tabStaves[0],
        source: 'staff-geometry',
      }
    }
    if (textEvidence.explicitTab && inferredTabStave) {
      return { kind: 'tab', tabStave: inferredTabStave, source: 'tab-clef-text' }
    }
    if (tabStaves.length > 0) {
      // Geometry-only 6-line bands need page text before we commit to TAB when
      // the caller actually searched for glyphs (empty array). Pure raster piano
      // scans often look six-line from ledger noise; with no glyphs there is no
      // fret/clef evidence, and a TAB-only early return would skip the raster
      // notehead path entirely (Guitar + piano PDF fail).
      // Undefined glyphs keep legacy geometry trust for unit helpers / pairing.
      if (Array.isArray(glyphs) && glyphs.length === 0) {
        return {
          kind: 'notation',
          tabStave: null,
          source: 'staff-geometry-unconfirmed',
        }
      }
      // Ledger lines can make five-line notation look six-line. Strong notehead
      // evidence with scarce fret digits keeps those bands as notation.
      // Continuation TAB systems omit the TAB clef and often admit a few
      // leaked noteheads in the evidence pad — fret digits must win so pairing
      // (and the notation+TAB repeat structure band) stays intact.
      const ledgerInflatedNotation =
        textEvidence.noteheadCount >= 3 &&
        textEvidence.digitCount < Math.max(3, Math.ceil(textEvidence.noteheadCount * 0.5))
      if (ledgerInflatedNotation) {
        return { kind: 'notation', tabStave: null, source: 'notehead-glyphs' }
      }
      return { kind: 'tab', tabStave: tabStaves[0], source: 'staff-geometry' }
    }
    if (textEvidence.noteheadCount >= 3) {
      return { kind: 'notation', tabStave: null, source: 'notehead-glyphs' }
    }
    return { kind: 'notation', tabStave: null, source: 'staff-geometry' }
  })

  return classified.map((classification, index) => {
    const system = list[index]
    if (classification.kind === 'mixed') {
      return { ...classification, pairedWithIndex: null }
    }
    if (classification.kind === 'notation') {
      return { ...classification, pairedWithIndex: null }
    }

    const previous = list[index - 1]
    if (previous && classified[index - 1]?.kind === 'notation') {
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
      if (proximityPairs || structurePairs) {
        return { ...classification, pairedWithIndex: index - 1 }
      }
    }
    return { ...classification, pairedWithIndex: null }
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
 * Printed measure numbers sit above the TAB staff. Fret digits sit on string
 * lines. Reject glyphs clearly above the top string before they become frets.
 */
function glyphIsAboveTabStaff(yNorm, lineYs) {
  if (!lineYs?.length) {
    return false
  }
  const top = lineYs[0]
  const gap = tabLineGap(lineYs)
  return yNorm < top - gap * 0.08
}

/**
 * Engraved bar numbers often land near the top string after text baseline
 * conversion. Drop the leftmost digit in a measure when it equals that
 * measure's number and sits on string 1 while other frets exist further right.
 */
function rejectPrintedMeasureNumberDigits(notes) {
  if (!notes?.length) {
    return notes
  }
  const byMeasure = groupTabNotesByMeasure(notes)
  const rejected = new Set()
  for (const [measureNumber, measureNotes] of byMeasure) {
    if (measureNotes.length < 2) {
      continue
    }
    const sorted = [...measureNotes].sort((left, right) => left.x - right.x)
    const leftmost = sorted[0]
    if (
      leftmost.string === 1 &&
      leftmost.fret === measureNumber &&
      leftmost.positionInMeasure <= 0.15 &&
      sorted.some((note) => note.x > leftmost.x + 1e-6)
    ) {
      rejected.add(leftmost)
    }
  }
  return rejected.size ? notes.filter((note) => !rejected.has(note)) : notes
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
    const yNorm = glyph.y / imageData.height
    if (glyphIsAboveTabStaff(yNorm, tabStave.lineYs)) {
      continue
    }
    const string = stringForY(yNorm, tabStave.lineYs, { maxDistanceFactor: 0.55 })
    if (string == null) {
      continue
    }
    digits.push({ ...glyph, string, yNorm })
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
      last.ySum += digit.y
      last.count += 1
      continue
    }
    clusters.push({
      string: digit.string,
      text: digit.text,
      firstX: digit.x,
      lastX: digit.x,
      xSum: digit.x,
      ySum: digit.y,
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
  return rejectPrintedMeasureNumberDigits(notes)
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
const DUPLICATE_TAB_NOTE_EPSILON = 0.012
const TAB_MAX_SUBDIVISIONS_PER_BEAT = 4
const TAB_MAX_ONSETS_PER_4_4 = 16

function durationTypeForTabDuration(durationDivisions) {
  if (durationDivisions >= OMR_DIVISIONS_PER_QUARTER * 4) {
    return 'whole'
  }
  if (durationDivisions >= OMR_DIVISIONS_PER_QUARTER * 2) {
    return 'half'
  }
  if (durationDivisions >= OMR_DIVISIONS_PER_QUARTER) {
    return 'quarter'
  }
  if (durationDivisions >= OMR_DIVISIONS_PER_QUARTER / 2) {
    return 'eighth'
  }
  return '16th'
}

function tabMaxOnsetsForMeasure(beats, totalDivisions) {
  return Math.max(
    1,
    Math.min(
      Math.round(beats * TAB_MAX_SUBDIVISIONS_PER_BEAT),
      TAB_MAX_ONSETS_PER_4_4,
      totalDivisions,
    ),
  )
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function assignMonotonicSlots(groups, slotCount) {
  let previousSlot = -1
  return groups.map((group, index) => {
    const remainingAfter = groups.length - index - 1
    const desired = Math.round(group.positionInMeasure * (slotCount - 1))
    const minSlot = previousSlot + 1
    const maxSlot = Math.max(minSlot, slotCount - 1 - remainingAfter)
    const slot = clamp(desired, minSlot, maxSlot)
    previousSlot = slot
    return slot
  })
}

function buildTabTimingBuckets(groups, { beats = 4 } = {}) {
  const totalDivisions = beats * OMR_DIVISIONS_PER_QUARTER
  if (!groups.length) {
    return {
      buckets: [],
      timingModel: {
        kind: 'tab-approximate-even',
        approximate: true,
        groupCount: 0,
        eventCount: 0,
        maxOnsets: 0,
        coalesced: false,
        compressed: false,
      },
    }
  }

  const maxOnsets = tabMaxOnsetsForMeasure(beats, totalDivisions)
  const compressed = groups.length > maxOnsets
  // Even measure packing: use beat slots when sparse, one slot per onset when
  // denser (up to the sixteenth grid), and only compress beyond maxOnsets.
  // Jumping straight to maxOnsets for beats+1 ghosts used to smear quarters
  // across a sixteenth grid.
  const slotCount = compressed
    ? maxOnsets
    : groups.length <= beats
      ? beats
      : groups.length
  const buckets = Array.from({ length: slotCount }, (_, slot) => ({
    slot,
    positionInMeasure: slotCount > 1 ? slot / (slotCount - 1) : 0,
    notes: [],
    x: null,
  }))

  const slots = compressed
    ? groups.map((group) =>
        Math.min(
          slotCount - 1,
          Math.max(0, Math.round(group.positionInMeasure * (slotCount - 1))),
        ),
      )
    : assignMonotonicSlots(groups, slotCount)

  groups.forEach((group, index) => {
    const slot = slots[index]
    const bucket = buckets[slot]
    bucket.notes.push(...group.notes)
    bucket.x = bucket.x == null ? group.notes[0]?.x ?? null : bucket.x
    bucket.positionInMeasure = Math.min(bucket.positionInMeasure, group.positionInMeasure)
  })

  const usedBuckets = buckets.filter((bucket) => bucket.notes.length > 0)
  const slotDuration = Math.max(1, Math.round(totalDivisions / slotCount))
  return {
    buckets: usedBuckets.map((bucket, index) => {
      const startDivision = Math.min(
        totalDivisions - 1,
        Math.round(bucket.slot * slotDuration),
      )
      const next = usedBuckets[index + 1]
      const nextStart = next
        ? Math.min(totalDivisions, Math.round(next.slot * slotDuration))
        : totalDivisions
      return {
        ...bucket,
        startDivision,
        durationDivisions: Math.max(1, nextStart - startDivision),
      }
    }),
    timingModel: {
      kind: 'tab-approximate-even',
      approximate: true,
      groupCount: groups.length,
      eventCount: usedBuckets.length,
      maxOnsets,
      slotCount,
      coalesced: groups.length > usedBuckets.length,
      compressed,
    },
  }
}

function groupContainsString(group, string) {
  return group.notes.some((note) => note.string === string)
}

function hasDuplicateTabNote(group, note) {
  return group.notes.some(
    (existing) =>
      existing.string === note.string &&
      existing.fret === note.fret &&
      Math.abs(existing.positionInMeasure - note.positionInMeasure) <= DUPLICATE_TAB_NOTE_EPSILON,
  )
}

function averagePosition(notes) {
  return notes.reduce((sum, note) => sum + note.positionInMeasure, 0) / notes.length
}

function tabTimingConfidence(timingModel, noteCount) {
  if (!noteCount) {
    return 0.52
  }
  let confidence = 0.6
  if (timingModel?.compressed) {
    confidence -= 0.1
  } else if (timingModel?.coalesced) {
    confidence -= 0.04
  }
  return Math.max(0.42, Math.min(0.62, confidence))
}

/**
 * Assemble tab notes for one measure into positional note events. Chord stacks
 * share an onset; repeated notes on the same string remain separate when their
 * x positions differ. Rhythm from TAB alone stays approximate.
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
        groupCount: 0,
        eventCount: 0,
        maxOnsets: 0,
        coalesced: false,
        compressed: false,
      },
      confidence: 0.52,
    }
  }

  const sorted = [...measureNotes].sort((left, right) => left.positionInMeasure - right.positionInMeasure)
  const groups = []
  for (const note of sorted) {
    const last = groups[groups.length - 1]
    if (last && hasDuplicateTabNote(last, note)) {
      continue
    }
    if (
      last &&
      note.positionInMeasure - last.positionInMeasure <= CHORD_X_EPSILON &&
      !groupContainsString(last, note.string)
    ) {
      last.notes.push(note)
      last.positionInMeasure = averagePosition(last.notes)
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
    confidence: tabTimingConfidence(timingModel, measureNotes.length),
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
 * Attach TAB positions to notation events (mixed notation+TAB systems).
 * Delegates to the multi-heuristic pairing engine in pairNotationTabEvents.js.
 */
export {
  attachTabPositionsToEvents,
  NOTATION_TAB_PAIRING_LOW_CONFIDENCE_MESSAGE,
  pairNotationTabEvents,
  pairNotationTabInMeasure,
} from './pairNotationTabEvents.js'
