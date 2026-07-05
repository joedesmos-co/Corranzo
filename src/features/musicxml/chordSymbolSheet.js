export const CHORD_SHEET_DETECTED_WARNING =
  'Chord sheet detected — playback uses steady chord changes, not exact strumming rhythm.'

const CHORD_SYMBOL_TEXT =
  /\b(?:[A-G](?:#|b|♯|♭)?)(?:maj|min|m|M|dim|aug|sus|add|no|°|ø|\+)?(?:[0-9]{0,2}(?:sus[24]|add[0-9]+|maj[79]|min[79]|Maj7|Min7|m7|M7|6|9|11|13|7|5|2|4)?)?(?:\/[A-G](?:#|b|♯|♭)?)?\b/g

const ROOT_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function normalizeRootStep(step) {
  return String(step ?? 'C')
    .replace('♯', '#')
    .replace('♭', 'b')
    .trim()
    .toUpperCase()
    .charAt(0)
}

function parseAccidental(stepText) {
  const text = String(stepText ?? '')
  if (text.includes('#') || text.includes('♯')) return 1
  if (text.includes('b') || text.includes('♭')) return -1
  return 0
}

function rootMidiFromSymbol(symbol) {
  const match = String(symbol ?? '')
    .trim()
    .match(/^([A-Ga-g])([#b♯♭]?)/)
  if (!match) {
    return null
  }
  const step = normalizeRootStep(match[1])
  const base = ROOT_SEMITONE[step]
  if (base == null) {
    return null
  }
  const accidental = parseAccidental(match[2] ?? '')
  return base + accidental + 48
}

/** Simple triad/seventh spelling from a lead-sheet symbol (Am, G7, F#m, C/E). */
export function chordSymbolToMidis(symbol) {
  const text = String(symbol ?? '').trim()
  if (!text) {
    return []
  }
  const rootMidi = rootMidiFromSymbol(text)
  if (rootMidi == null) {
    return []
  }

  const quality = text.slice(text.match(/^([A-Ga-g][#b♯♭]?)/)?.[0]?.length ?? 0).toLowerCase()
  const isMinor = /^m(?!aj)/.test(quality) || quality.startsWith('min')
  const isDim = quality.includes('dim') || quality.includes('°')
  const isAug = quality.includes('aug') || quality.includes('+')
  const hasSeventh = /7|maj7|min7|m7|dim7|ø/.test(quality)

  const third = isMinor || isDim ? 3 : isAug ? 4 : 4
  const fifth = isDim ? 6 : isAug ? 8 : 7
  const midis = [rootMidi, rootMidi + third, rootMidi + fifth]
  if (hasSeventh) {
    midis.push(rootMidi + (isDim ? 9 : isMinor ? 10 : 11))
  }
  return [...new Set(midis)].sort((a, b) => a - b)
}

export function extractChordSymbolsFromText(text) {
  const symbols = []
  const seen = new Set()
  for (const match of String(text ?? '').matchAll(CHORD_SYMBOL_TEXT)) {
    const symbol = match[0]?.trim()
    if (!symbol || seen.has(symbol)) {
      continue
    }
    if (chordSymbolToMidis(symbol).length === 0) {
      continue
    }
    seen.add(symbol)
    symbols.push(symbol)
  }
  return symbols
}

export function analyzeChordSheetScore(timingMap) {
  const harmonyEvents = timingMap?.harmonyEvents ?? []
  const notes = (timingMap?.notes ?? []).filter((note) => !note.isRest && note.midi != null)
  const measureCount = timingMap?.measures?.length ?? 0
  const harmonyOnly =
    harmonyEvents.length > 0 &&
    notes.length <= Math.max(2, Math.ceil(measureCount * 0.35))

  const sparseWithSymbols =
    measureCount >= 2 &&
    notes.length <= Math.max(1, Math.ceil(measureCount * 0.25)) &&
    harmonyEvents.length >= Math.max(2, Math.ceil(measureCount * 0.4))

  const isChordSheet = harmonyOnly || sparseWithSymbols

  return {
    isChordSheet,
    harmonyEvents,
    warnings: isChordSheet ? [CHORD_SHEET_DETECTED_WARNING] : [],
  }
}

/**
 * Build steady one-chord-per-symbol note events when the score is harmony-first.
 * Does not alter global tempo math — callers attach these as ordinary notes.
 */
export function buildChordSheetNoteEvents({ harmonyEvents = [], measures = [], defaultBpm = 120 } = {}) {
  if (!harmonyEvents.length || !measures.length) {
    return []
  }

  const secondsPerMeasure =
    measures.length > 1
      ? Math.max(
          0.5,
          (measures[1].startTimeSeconds ?? 2) - (measures[0].startTimeSeconds ?? 0),
        )
      : 240 / defaultBpm * (measures[0]?.lengthQuarters ?? 4)

  return harmonyEvents.map((event, index) => {
    const midis = chordSymbolToMidis(event.symbol)
    const measure = measures.find((item) => item.number === event.measureNumber) ?? measures[index] ?? measures[0]
    const timeSeconds = measure?.startTimeSeconds ?? index * secondsPerMeasure
    const quarterTime = measure?.startQuarterTime ?? event.quarterTime ?? index * 4
    return {
      id: `chord-sheet-m${event.measureNumber ?? index + 1}-${index}`,
      partId: event.partId ?? 'chord-sheet',
      measureNumber: event.measureNumber ?? measure?.number ?? index + 1,
      quarterTime,
      timeSeconds,
      durationQuarters: measure?.lengthQuarters ?? 4,
      durationSeconds: secondsPerMeasure,
      midi: midis[0] ?? 60,
      label: event.symbol,
      chordSymbol: event.symbol,
      expectedMidis: midis,
      isRest: false,
      isChordSheetEvent: true,
      voice: 1,
    }
  })
}
