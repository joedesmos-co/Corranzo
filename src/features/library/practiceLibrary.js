import { INSTRUMENT_IDS, getInstrument, normalizeInstrumentId } from '../instruments/instruments.js'
import { DEMO_PIECE, GUITAR_DEMO_PIECE } from '../../dev/fixturePaths.js'

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
  {
    ...DEMO_PIECE,
    instrumentId: INSTRUMENT_IDS.PIANO,
    instrument: getInstrument(INSTRUMENT_IDS.PIANO).label,
    difficulty: 'Advanced',
    approxDuration: '3 min',
    teaches: 'Dense score reading, phrase flow, and confident page-follow practice.',
  },
  {
    ...GUITAR_DEMO_PIECE,
    instrumentId: INSTRUMENT_IDS.GUITAR,
    instrument: getInstrument(INSTRUMENT_IDS.GUITAR).label,
    difficulty: 'Beginner',
    approxDuration: '1 min',
    teaches: 'First-position melody reading with matching TAB string and fret positions.',
  },
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
