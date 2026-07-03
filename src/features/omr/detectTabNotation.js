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

const DIGIT_RE = /^[0-9]$/

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
  if ((stave?.lineCount ?? 0) !== stringCount) {
    return null
  }
  const detectedLineYs = Array.isArray(stave.detectedLineYs) ? stave.detectedLineYs : null
  if (detectedLineYs?.length === stringCount) {
    return detectedLineYs
  }
  const lineYs = Array.isArray(stave.lineYs) ? stave.lineYs : null
  return lineYs?.length === stringCount ? lineYs : null
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
      if (previousIsNotation && gap >= 0 && gap <= previousHeight * 2.4) {
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
    if (!DIGIT_RE.test(glyph.text ?? '')) {
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
    const start = box.playableX0 ?? box.x0
    if (xNorm >= start && xNorm <= box.x1) {
      return box
    }
  }
  return null
}

function positionWithinBox(box, xNorm) {
  const start = box.playableX0 ?? box.x0
  const span = box.x1 - start
  if (span <= 0) {
    return 0
  }
  return Math.min(1, Math.max(0, (xNorm - start) / span))
}

/** Same-onset grouping tolerance as a fraction of the measure width. */
const CHORD_X_EPSILON = 0.045

/**
 * Assemble tab notes for one measure into positional note events (chords share
 * an onset). Durations are quarter-note placeholders on the beat-slot grid —
 * rhythm from tablature alone is inherently approximate, so measures built
 * this way are flagged `uncertain`.
 */
export function buildTabMeasureEvents(measureNotes, { beats = 4 } = {}) {
  if (!measureNotes?.length) {
    return { events: [], uncertain: true }
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

  const slotsPerMeasure = beats
  const usedSlots = new Set()
  const events = []
  for (const group of groups) {
    let slot = Math.min(
      slotsPerMeasure - 1,
      Math.round(group.positionInMeasure * slotsPerMeasure),
    )
    while (usedSlots.has(slot) && slot < slotsPerMeasure - 1) {
      slot += 1 // keep distinct onsets distinct when they round together
    }
    usedSlots.add(slot)
    events.push({
      type: 'note',
      startDivision: slot * OMR_DIVISIONS_PER_QUARTER,
      durationDivisions: OMR_DIVISIONS_PER_QUARTER,
      durationType: 'quarter',
      dotted: false,
      cx: group.notes[0].x,
      notes: group.notes.map((note) => ({
        midi: note.midi,
        string: note.string,
        fret: note.fret,
        soundingPitch: true,
        clef: 'treble',
        cx: note.x,
      })),
    })
  }

  return { events: mergeTabEventsWithSameStart(events), uncertain: true }
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
