import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUILT_IN_PRACTICE_PIECES,
  LIBRARY_TABS,
  buildUploadedPracticePieces,
  filterLibraryItems,
  getBuiltInPracticePieces,
  groupPracticePiecesByDifficulty,
} from '../src/features/library/practiceLibrary.js'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('practice library pieces', () => {
  it('ships the current Piano and Guitar demos as built-in practice pieces', () => {
    expect(BUILT_IN_PRACTICE_PIECES).toHaveLength(14)
    expect(BUILT_IN_PRACTICE_PIECES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hungarian-dance-no5',
          title: 'Hungarian Dance No. 5',
          instrumentId: INSTRUMENT_IDS.PIANO,
          instrument: 'Piano',
          difficulty: 'Advanced',
          approxDuration: expect.any(String),
          teaches: expect.any(String),
        }),
        expect.objectContaining({
          id: 'guitar-ode-to-joy',
          title: 'Ode to Joy',
          instrumentId: INSTRUMENT_IDS.GUITAR,
          instrument: 'Guitar',
          difficulty: 'Beginner',
          approxDuration: expect.any(String),
          teaches: expect.any(String),
        }),
      ]),
    )
  })

  it('filters built-in pieces to the selected instrument', () => {
    const pianoPieces = getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.PIANO })
    const guitarPieces = getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.GUITAR })

    expect(pianoPieces.map((piece) => piece.title)).toEqual([
      'Ode to Joy',
      'Twinkle Twinkle Little Star',
      'Mary Had a Little Lamb',
      'Minuet in G',
      'Gymnopedie No. 1 excerpt',
      'Hungarian Dance No. 5',
      'Fur Elise excerpt',
    ])
    expect(guitarPieces.map((piece) => piece.title)).toEqual([
      'Ode to Joy',
      'Amazing Grace',
      'When the Saints Go Marching In',
      'Greensleeves',
      'Scarborough Fair',
      'Spanish Romance intro',
      'Carulli-style Etude',
    ])
    expect(pianoPieces.every((piece) => piece.instrumentId === INSTRUMENT_IDS.PIANO)).toBe(true)
    expect(guitarPieces.every((piece) => piece.instrumentId === INSTRUMENT_IDS.GUITAR)).toBe(true)
  })

  it('groups visible pieces by difficulty without showing empty levels', () => {
    const groups = groupPracticePiecesByDifficulty(
      getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.GUITAR }),
    )

    expect(groups.map((group) => [group.difficulty, group.pieces.length])).toEqual([
      ['Beginner', 3],
      ['Intermediate', 3],
      ['Advanced', 1],
    ])
    expect(groups[0].pieces.map((piece) => piece.title)).toContain('Ode to Joy')
    expect(groups[2].pieces[0].title).toBe('Carulli-style Etude')
  })

  it('filters library cards by searchable metadata', () => {
    const guitarPieces = getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.GUITAR })
    const pianoPieces = getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.PIANO })

    expect(filterLibraryItems(guitarPieces, 'arpeggio').map((piece) => piece.title)).toEqual([
      'Spanish Romance intro',
    ])
    expect(filterLibraryItems(pianoPieces, 'chromatic').map((piece) => piece.title)).toEqual([
      'Fur Elise excerpt',
    ])
    expect(filterLibraryItems(pianoPieces, 'guitar')).toEqual([])
  })

  it('builds uploaded practice cards from instrument bundles and excludes demos', () => {
    const pieces = buildUploadedPracticePieces(
      {
        [INSTRUMENT_IDS.PIANO]: {
          pdfMeta: { fileName: 'Bach Prelude.pdf' },
          musicXmlSource: {
            fileName: 'bach.musicxml',
            data: '<score-partwise />',
            omrMeta: { durationSeconds: 64 },
          },
          midiSource: { fileName: 'bach.mid', data: new ArrayBuffer(1) },
          demoPieceActive: false,
        },
        [INSTRUMENT_IDS.GUITAR]: {
          pdfMeta: { fileName: 'Ode to Joy.pdf' },
          musicXmlSource: { fileName: 'ode.musicxml', data: '<score-partwise />' },
          demoPieceActive: true,
        },
      },
      { activeInstrumentId: INSTRUMENT_IDS.PIANO },
    )

    expect(pieces).toEqual([
      expect.objectContaining({
        title: 'Bach Prelude',
        instrument: 'Piano',
        difficulty: 'Uploaded',
        approxDuration: '1m 5s',
        subtitle: 'Timing: bach.musicxml',
        attribution: 'Sound: bach.mid',
        ready: true,
        isActive: true,
      }),
    ])
    expect(filterLibraryItems(pieces, 'bach.mid')).toHaveLength(1)
  })
})

describe('library tab shell', () => {
  it('defaults the Library tab to Practice Library and routes file help to My Uploads', () => {
    const app = readSrc('App.jsx')

    expect(LIBRARY_TABS.PRACTICE).toBe('practice')
    expect(app).toContain('useState(LIBRARY_TABS.PRACTICE)')
    expect(app).toContain('<main className="library-main">')
    expect(app).toContain('uploadedPieces={uploadedPracticePieces}')
    expect(app).toContain('onOpenUploadedPiece={handleOpenUploadedPiece}')
    expect(app).toContain('setLibraryTab(LIBRARY_TABS.UPLOADS)')
  })

  it('keeps uploads and OMR controls inside the My Uploads panel', () => {
    const library = readSrc('components', 'LibraryPanel.jsx')

    expect(library).toContain('Practice Library')
    expect(library).toContain('My Uploads')
    expect(library).toContain('Search uploads')
    expect(library).toContain('Upload your own piece')
    expect(library).toContain('Start Practice')
    expect(library).toContain('MultiFileUpload')
    expect(library).toContain('PdfOmrPlaybackPanel')
    expect(library).toContain('Upload one file at a time')
    expect(library).toContain('onLoadSampleFixtures?.(piece.id)')
  })

  it('orders My Uploads as add-files first and user uploads second', () => {
    const library = readSrc('components', 'LibraryPanel.jsx')
    const addFilesIndex = library.indexOf('practice-piece-card practice-piece-card--add-files')
    const uploadedMapIndex = library.indexOf('visibleUploadedPieces.map')

    expect(addFilesIndex).toBeGreaterThan(-1)
    expect(uploadedMapIndex).toBeGreaterThan(-1)
    expect(addFilesIndex).toBeLessThan(uploadedMapIndex)
    expect(library).toContain('practice-piece-card practice-piece-card--uploaded')
    expect(library).not.toContain('visibleUploadDemoPieces')
    expect(library).not.toContain('practice-piece-card practice-piece-card--demo')
    expect(library).not.toContain('Demo Songs')
  })

  it('keeps built-in demos in Practice Library and out of My Uploads', () => {
    const library = readSrc('components', 'LibraryPanel.jsx')
    const practiceSectionIndex = library.indexOf('selectedTab === LIBRARY_TABS.PRACTICE')
    const uploadsSectionIndex = library.indexOf('library-panel__uploads')
    const builtInIndex = library.indexOf('getBuiltInPracticePieces({ instrumentId, difficulty: difficultyFilter })')
    const uploadedIndex = library.indexOf('visibleUploadedPieces.map')

    expect(practiceSectionIndex).toBeGreaterThan(-1)
    expect(uploadsSectionIndex).toBeGreaterThan(-1)
    expect(builtInIndex).toBeGreaterThan(-1)
    expect(uploadedIndex).toBeGreaterThan(-1)
    expect(builtInIndex).toBeLessThan(uploadsSectionIndex)
    expect(uploadedIndex).toBeGreaterThan(uploadsSectionIndex)
  })

  it('keeps uploaded cards readable with long filenames across responsive widths', () => {
    const css = readSrc('App.css')

    expect(css).toMatch(
      /\.library-panel__uploads-grid\s*\{[^}]*minmax\(min\(100%,\s*340px\),\s*1fr\)/,
    )
    expect(css).toMatch(
      /\.practice-piece-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(132px,\s*148px\)/,
    )
    expect(css).toMatch(
      /\.practice-piece-card__action\s*\{[^}]*max-width:\s*148px/,
    )
    expect(css).toMatch(
      /\.practice-piece-card--uploaded \.practice-piece-card__subtitle,[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/,
    )
    expect(css).toMatch(/\.practice-piece-card__button\s*\{[^}]*white-space:\s*nowrap/)
    expect(css).toMatch(
      /@media \(max-width: 800px\)[\s\S]*\.practice-piece-card__action\s*\{[^}]*max-width:\s*none/,
    )
  })
})
