import {
  DEFAULT_INSTRUMENT_ID,
  INSTRUMENT_IDS,
  normalizeInstrumentId,
} from '../features/instruments/instruments.js'
import practiceLibraryManifest from '../../public/fixtures/practice-library/manifest.json' with { type: 'json' }

function curatedPracticePaths(id) {
  return {
    pdf: `/fixtures/practice-library/${id}/${id}.pdf`,
    midi: `/fixtures/practice-library/${id}/${id}.mid`,
    musicXml: `/fixtures/practice-library/${id}/${id}.musicxml`,
  }
}

function curatedPracticeFilenames(title, instrumentLabel) {
  return {
    pdf: `${title} - ${instrumentLabel}.pdf`,
    midi: `${title} - ${instrumentLabel}.mid`,
    musicXml: `${title} - ${instrumentLabel}.musicxml`,
  }
}

function practiceFixture(piece) {
  const instrumentLabel = piece.instrumentId === INSTRUMENT_IDS.GUITAR ? 'Guitar' : 'Piano'
  return {
    id: piece.id,
    title: piece.title,
    subtitle: piece.subtitle,
    attribution: piece.attribution,
    instrumentId: piece.instrumentId,
    difficulty: piece.difficulty,
    approxDuration: piece.approxDuration,
    teaches: piece.teaches,
    tags: Array.isArray(piece.tags) ? piece.tags : [],
    license: piece.license ?? 'Public Domain',
    provenance: piece.provenance ?? '',
    sourceUrl: piece.sourceUrl ?? null,
    measureCount: piece.measureCount ?? null,
    pageCount: piece.pageCount ?? 1,
    paths: piece.paths ?? curatedPracticePaths(piece.id),
    fileNames:
      piece.fileNames ?? curatedPracticeFilenames(piece.title, instrumentLabel),
  }
}

/** Curated built-in Practice Library (Mutopia / redistributable PD editions). */
export const PRACTICE_LIBRARY_FIXTURES = practiceLibraryManifest.pieces.map(practiceFixture)

export const DEMO_PIECE =
  PRACTICE_LIBRARY_FIXTURES.find(
    (piece) => piece.id === 'hungarian-dance-no5' && piece.instrumentId === INSTRUMENT_IDS.PIANO,
  ) ?? PRACTICE_LIBRARY_FIXTURES.find((piece) => piece.instrumentId === INSTRUMENT_IDS.PIANO)

export const GUITAR_DEMO_PIECE =
  PRACTICE_LIBRARY_FIXTURES.find(
    (piece) => piece.id === 'guitar-aguado-op03-1' && piece.instrumentId === INSTRUMENT_IDS.GUITAR,
  ) ?? PRACTICE_LIBRARY_FIXTURES.find((piece) => piece.instrumentId === INSTRUMENT_IDS.GUITAR)

/**
 * Internal TAB/OMR regression fixture (not a Practice Library card).
 * Generated notation+TAB pair kept for pipeline tests.
 */
export const GUITAR_TAB_REGRESSION_PATHS = {
  pdf: '/fixtures/guitar-ode-to-joy/guitar-ode-to-joy.pdf',
  midi: '/fixtures/guitar-ode-to-joy/guitar-ode-to-joy.mid',
  musicXml: '/fixtures/guitar-ode-to-joy/guitar-ode-to-joy.musicxml',
}

export const GUITAR_TAB_REGRESSION_FILENAMES = {
  pdf: 'Guitar Demo - Ode to Joy.pdf',
  midi: 'Guitar Demo - Ode to Joy.mid',
  musicXml: 'Guitar Demo - Ode to Joy.musicxml',
}

export const DEMO_PIECES = {
  [INSTRUMENT_IDS.PIANO]: DEMO_PIECE,
  [INSTRUMENT_IDS.GUITAR]: GUITAR_DEMO_PIECE,
}

/** Built-in demo paths (Hungarian Dance). */
export const FIXTURE_PATHS = DEMO_PIECE.paths

export const GUITAR_FIXTURE_PATHS = GUITAR_DEMO_PIECE.paths

export const FIXTURE_PATHS_BY_INSTRUMENT = {
  [INSTRUMENT_IDS.PIANO]: FIXTURE_PATHS,
  [INSTRUMENT_IDS.GUITAR]: GUITAR_FIXTURE_PATHS,
}

export const FIXTURE_FILENAMES = DEMO_PIECE.fileNames

export const GUITAR_FIXTURE_FILENAMES = GUITAR_DEMO_PIECE.fileNames

export const FIXTURE_FILENAMES_BY_INSTRUMENT = {
  [INSTRUMENT_IDS.PIANO]: FIXTURE_FILENAMES,
  [INSTRUMENT_IDS.GUITAR]: GUITAR_FIXTURE_FILENAMES,
}

export function getDemoPieceForInstrument(instrumentId = DEFAULT_INSTRUMENT_ID) {
  return DEMO_PIECES[normalizeInstrumentId(instrumentId)] ?? DEMO_PIECE
}

export function getFixturePathsForInstrument(instrumentId = DEFAULT_INSTRUMENT_ID) {
  return FIXTURE_PATHS_BY_INSTRUMENT[normalizeInstrumentId(instrumentId)] ?? FIXTURE_PATHS
}

export function getFixtureFilenamesForInstrument(instrumentId = DEFAULT_INSTRUMENT_ID) {
  return FIXTURE_FILENAMES_BY_INSTRUMENT[normalizeInstrumentId(instrumentId)] ?? FIXTURE_FILENAMES
}

/** Internal regression fixture (Minuet in G). */
export const MINUET_FIXTURE_PATHS = {
  pdf: '/fixtures/demo-minuet-in-g.pdf',
  midi: '/fixtures/demo-minuet-in-g.mid',
  musicXml: '/fixtures/demo-minuet-in-g.musicxml',
  demoAnchors: '/fixtures/demo-minuet-in-g.anchors.json',
}

export const MINUET_FIXTURE_FILENAMES = {
  pdf: 'Minuet in G.pdf',
  midi: 'Minuet in G.mid',
  musicXml: 'Minuet in G.musicxml',
}

export function getPracticeLibraryFixture(pieceId, instrumentId = DEFAULT_INSTRUMENT_ID) {
  const normalizedInstrument = normalizeInstrumentId(instrumentId)
  if (pieceId) {
    const exact = PRACTICE_LIBRARY_FIXTURES.find(
      (piece) => piece.id === pieceId && piece.instrumentId === normalizedInstrument,
    )
    if (exact) {
      return exact
    }
  }
  const demo = getDemoPieceForInstrument(normalizedInstrument)
  return (
    PRACTICE_LIBRARY_FIXTURES.find(
      (piece) => piece.id === demo.id && piece.instrumentId === normalizedInstrument,
    ) ??
    PRACTICE_LIBRARY_FIXTURES.find((piece) => piece.instrumentId === normalizedInstrument) ??
    PRACTICE_LIBRARY_FIXTURES[0]
  )
}

export function getPracticeLibraryDifficultyCounts(instrumentId) {
  const pieces = PRACTICE_LIBRARY_FIXTURES.filter(
    (piece) => piece.instrumentId === normalizeInstrumentId(instrumentId),
  )
  return {
    Beginner: pieces.filter((piece) => piece.difficulty === 'Beginner').length,
    Intermediate: pieces.filter((piece) => piece.difficulty === 'Intermediate').length,
    Advanced: pieces.filter((piece) => piece.difficulty === 'Advanced').length,
    total: pieces.length,
  }
}
