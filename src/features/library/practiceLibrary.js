import { getInstrument, normalizeInstrumentId } from '../instruments/instruments.js'
import { PRACTICE_LIBRARY_FIXTURES } from '../../dev/fixturePaths.js'

export const LIBRARY_TABS = {
  PRACTICE: 'practice',
  UPLOADS: 'uploads',
}

export const DIFFICULTY_LEVELS = ['Beginner', 'Intermediate', 'Advanced']

export const DIFFICULTY_FILTERS = [
  { id: 'all', label: 'All levels' },
  ...DIFFICULTY_LEVELS.map((level) => ({ id: level.toLowerCase(), label: level })),
]

export const BUILT_IN_PRACTICE_PIECES = [
  ...PRACTICE_LIBRARY_FIXTURES.map((piece) => ({
    id: piece.id,
    title: piece.title,
    subtitle: piece.subtitle,
    attribution: piece.attribution,
    measureCount: piece.measureCount,
    pageCount: piece.pageCount,
    instrumentId: piece.instrumentId,
    instrument: getInstrument(piece.instrumentId).label,
    difficulty: piece.difficulty,
    approxDuration: piece.approxDuration,
    teaches: piece.teaches,
  })),
]

export function getBuiltInPracticePieces({
  instrumentId,
  difficulty = 'all',
} = {}) {
  const normalizedInstrument = normalizeInstrumentId(instrumentId)
  const normalizedDifficulty = String(difficulty ?? 'all').toLowerCase()
  return BUILT_IN_PRACTICE_PIECES.filter((piece) => {
    if (piece.instrumentId !== normalizedInstrument) {
      return false
    }
    if (normalizedDifficulty === 'all') {
      return true
    }
    return piece.difficulty.toLowerCase() === normalizedDifficulty
  })
}

export function groupPracticePiecesByDifficulty(pieces) {
  return DIFFICULTY_LEVELS.map((difficulty) => ({
    difficulty,
    pieces: pieces.filter((piece) => piece.difficulty === difficulty),
  })).filter((group) => group.pieces.length > 0)
}

function stripExtension(fileName = '') {
  return String(fileName).replace(/\.[^.]+$/, '')
}

function formatApproxDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  const rounded = Math.max(1, Math.round(value / 5) * 5)
  if (rounded < 60) {
    return `${rounded}s`
  }
  const minutes = Math.floor(rounded / 60)
  const remainingSeconds = rounded % 60
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

export function buildUploadedPracticePieces(bundles = {}, { activeInstrumentId = null } = {}) {
  return Object.entries(bundles)
    .map(([instrumentId, bundle]) => {
      const normalizedInstrument = normalizeInstrumentId(instrumentId)
      if (!bundle?.pdfMeta?.fileName || bundle.demoPieceActive) {
        return null
      }
      const instrument = getInstrument(normalizedInstrument)
      const hasTiming = Boolean(bundle.musicXmlSource?.data)
      const hasMidi = Boolean(bundle.midiSource?.data)
      const approxDuration = formatApproxDuration(bundle.musicXmlSource?.omrMeta?.durationSeconds)
      const title = stripExtension(bundle.pdfMeta.fileName) || 'Uploaded score'
      const description = hasTiming
        ? hasMidi
          ? 'PDF, timing, and sound are ready for practice.'
          : 'PDF and timing are ready. Sound is optional.'
        : 'PDF loaded. Add a timing file for Practice, loops, and Wait For You.'

      return {
        id: `upload:${normalizedInstrument}:${bundle.pdfMeta.fileName}`,
        instrumentId: normalizedInstrument,
        instrument: instrument.label,
        title,
        difficulty: 'Uploaded',
        approxDuration: approxDuration ?? (hasTiming ? 'Timing ready' : 'Needs timing'),
        teaches: description,
        subtitle: bundle.musicXmlSource?.fileName
          ? `Timing: ${bundle.musicXmlSource.fileName}`
          : 'Timing file not added yet',
        attribution: hasMidi ? `Sound: ${bundle.midiSource.fileName}` : 'MIDI optional',
        pdfFileName: bundle.pdfMeta.fileName,
        musicXmlFileName: bundle.musicXmlSource?.fileName ?? null,
        midiFileName: bundle.midiSource?.fileName ?? null,
        ready: hasTiming,
        isActive: normalizedInstrument === normalizeInstrumentId(activeInstrumentId),
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1
      }
      return left.title.localeCompare(right.title)
    })
}

export function filterLibraryItems(items, query = '') {
  const normalized = String(query ?? '').trim().toLowerCase()
  if (!normalized) {
    return items
  }
  return items.filter((item) => {
    const haystack = [
      item.title,
      item.instrument,
      item.difficulty,
      item.subtitle,
      item.teaches,
      item.attribution,
      item.description,
      item.pdfFileName,
      item.musicXmlFileName,
      item.midiFileName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalized)
  })
}
