import {
  DEFAULT_INSTRUMENT_ID,
  INSTRUMENT_IDS,
  normalizeInstrumentId,
} from '../features/instruments/instruments.js'

/** Public demo fixture URLs (served from /public/fixtures in dev). */
export const DEMO_PIECE = {
  id: 'hungarian-dance-no5',
  title: 'Hungarian Dance No. 5',
  subtitle: 'Demo score · WoO 1, No. 5 in F♯ minor (public domain)',
  attribution: 'Johannes Brahms · piano arrangement',
  measureCount: 104,
  pageCount: 4,
}

export const GUITAR_DEMO_PIECE = {
  id: 'guitar-ode-to-joy',
  title: 'Ode to Joy',
  subtitle: 'Guitar demo · beginner standard notation + TAB (public domain)',
  attribution: 'Ludwig van Beethoven · beginner guitar arrangement',
  measureCount: 7,
  pageCount: 1,
}

export const DEMO_PIECES = {
  [INSTRUMENT_IDS.PIANO]: DEMO_PIECE,
  [INSTRUMENT_IDS.GUITAR]: GUITAR_DEMO_PIECE,
}

/** Built-in demo paths (Hungarian Dance). */
export const FIXTURE_PATHS = {
  pdf: '/fixtures/hungarian-dance-no5/hungarian-dance-no5.pdf',
  midi: '/fixtures/hungarian-dance-no5/hungarian-dance-no5.mid',
  musicXml: '/fixtures/hungarian-dance-no5/hungarian-dance-no5.mxl',
  demoAnchors: '/fixtures/hungarian-dance-no5/hungarian-dance-no5.anchors.json',
}

export const GUITAR_FIXTURE_PATHS = {
  pdf: '/fixtures/guitar-ode-to-joy/guitar-ode-to-joy.pdf',
  midi: '/fixtures/guitar-ode-to-joy/guitar-ode-to-joy.mid',
  musicXml: '/fixtures/guitar-ode-to-joy/guitar-ode-to-joy.musicxml',
}

export const FIXTURE_PATHS_BY_INSTRUMENT = {
  [INSTRUMENT_IDS.PIANO]: FIXTURE_PATHS,
  [INSTRUMENT_IDS.GUITAR]: GUITAR_FIXTURE_PATHS,
}

export const FIXTURE_FILENAMES = {
  pdf: 'Hungarian Dance No. 5.pdf',
  midi: 'Hungarian Dance No. 5.mid',
  musicXml: 'Hungarian Dance No. 5.mxl',
}

export const GUITAR_FIXTURE_FILENAMES = {
  pdf: 'Guitar Demo - Ode to Joy.pdf',
  midi: 'Guitar Demo - Ode to Joy.mid',
  musicXml: 'Guitar Demo - Ode to Joy.musicxml',
}

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

/** Internal regression fixture (Minuet in G) — not the visible demo card. */
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

function generatedPracticePaths(id) {
  return {
    pdf: `/fixtures/practice-library/${id}/${id}.pdf`,
    midi: `/fixtures/practice-library/${id}/${id}.mid`,
    musicXml: `/fixtures/practice-library/${id}/${id}.musicxml`,
  }
}

function generatedPracticeFilenames(title, instrumentLabel) {
  return {
    pdf: `${title} - ${instrumentLabel}.pdf`,
    midi: `${title} - ${instrumentLabel}.mid`,
    musicXml: `${title} - ${instrumentLabel}.musicxml`,
  }
}

function practiceFixture({
  id,
  title,
  subtitle,
  attribution,
  instrumentId,
  difficulty,
  approxDuration,
  teaches,
  measureCount,
  pageCount = 1,
  paths = generatedPracticePaths(id),
  fileNames = generatedPracticeFilenames(title, instrumentId === INSTRUMENT_IDS.GUITAR ? 'Guitar' : 'Piano'),
}) {
  return {
    id,
    title,
    subtitle,
    attribution,
    instrumentId,
    difficulty,
    approxDuration,
    teaches,
    measureCount,
    pageCount,
    paths,
    fileNames,
  }
}

export const PRACTICE_LIBRARY_FIXTURES = [
  practiceFixture({
    id: 'demo-minuet-in-g',
    title: 'Minuet in G',
    subtitle: 'Public-domain baroque keyboard score',
    attribution: 'Christian Petzold / J.S. Bach Notebook',
    instrumentId: INSTRUMENT_IDS.PIANO,
    difficulty: 'Intermediate',
    approxDuration: '1 min',
    teaches: 'Minuet pulse, two-hand coordination, phrase balance, and score-follow practice on a complete typeset page.',
    measureCount: 32,
    paths: MINUET_FIXTURE_PATHS,
    fileNames: MINUET_FIXTURE_FILENAMES,
  }),
  practiceFixture({
    ...DEMO_PIECE,
    instrumentId: INSTRUMENT_IDS.PIANO,
    difficulty: 'Advanced',
    approxDuration: '3 min',
    subtitle: 'Advanced public-domain piano demo with verified score-follow anchors',
    teaches: 'Dense score reading, expressive phrase flow, left-hand accompaniment patterns, and confident page-follow practice.',
    paths: FIXTURE_PATHS,
    fileNames: FIXTURE_FILENAMES,
  }),
  practiceFixture({
    ...GUITAR_DEMO_PIECE,
    instrumentId: INSTRUMENT_IDS.GUITAR,
    difficulty: 'Beginner',
    approxDuration: '1 min',
    subtitle: 'Public-domain melody with standard notation and TAB',
    teaches: 'First-position melody reading, matching TAB string and fret positions, and clear visual target changes.',
    paths: GUITAR_FIXTURE_PATHS,
    fileNames: GUITAR_FIXTURE_FILENAMES,
  }),
  practiceFixture({
    id: 'guitar-amazing-grace',
    title: 'Amazing Grace',
    subtitle: 'Public-domain open-position melody',
    attribution: 'Traditional',
    instrumentId: INSTRUMENT_IDS.GUITAR,
    difficulty: 'Beginner',
    approxDuration: '45s',
    teaches: 'Slow melodic phrasing, simple string changes, and TAB-to-notation pairing for quiet practice.',
    measureCount: 4,
  }),
  practiceFixture({
    id: 'guitar-when-the-saints',
    title: 'When the Saints Go Marching In',
    subtitle: 'Public-domain first-position tune',
    attribution: 'Traditional',
    instrumentId: INSTRUMENT_IDS.GUITAR,
    difficulty: 'Beginner',
    approxDuration: '40s',
    teaches: 'Steady quarter-note rhythm, first-position frets, and repeated melodic patterns.',
    measureCount: 5,
  }),
]

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
