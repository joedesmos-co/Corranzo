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
import { getPracticeLibraryDifficultyCounts } from '../src/dev/fixturePaths.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('practice library pieces', () => {
  it('ships the curated Piano and Guitar difficulty ladder', () => {
    expect(BUILT_IN_PRACTICE_PIECES).toHaveLength(26)
    expect(getPracticeLibraryDifficultyCounts(INSTRUMENT_IDS.PIANO)).toEqual({
      Beginner: 5,
      Intermediate: 5,
      Advanced: 3,
      total: 13,
    })
    expect(getPracticeLibraryDifficultyCounts(INSTRUMENT_IDS.GUITAR)).toEqual({
      Beginner: 5,
      Intermediate: 5,
      Advanced: 3,
      total: 13,
    })
    expect(BUILT_IN_PRACTICE_PIECES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hungarian-dance-no5',
          title: 'Hungarian Dance No. 5',
          instrumentId: INSTRUMENT_IDS.PIANO,
          difficulty: 'Advanced',
          license: expect.any(String),
          provenance: expect.any(String),
          tags: expect.any(Array),
        }),
        expect.objectContaining({
          id: 'guitar-aguado-op03-1',
          instrumentId: INSTRUMENT_IDS.GUITAR,
          difficulty: 'Beginner',
          license: expect.any(String),
          provenance: expect.stringMatching(/Mutopia/i),
        }),
      ]),
    )
  })

  it('filters built-in pieces to the selected instrument', () => {
    const pianoPieces = getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.PIANO })
    const guitarPieces = getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.GUITAR })

    expect(pianoPieces).toHaveLength(13)
    expect(guitarPieces).toHaveLength(13)
    expect(pianoPieces.every((piece) => piece.instrumentId === INSTRUMENT_IDS.PIANO)).toBe(true)
    expect(guitarPieces.every((piece) => piece.instrumentId === INSTRUMENT_IDS.GUITAR)).toBe(true)
    expect(pianoPieces.map((piece) => piece.title)).toContain('Minuet in G')
    expect(guitarPieces.map((piece) => piece.title)).toContain('Spanish Romance')
  })

  it('groups visible pieces by difficulty without showing empty levels', () => {
    const groups = groupPracticePiecesByDifficulty(
      getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.GUITAR }),
    )

    expect(groups.map((group) => [group.difficulty, group.pieces.length])).toEqual([
      ['Beginner', 5],
      ['Intermediate', 5],
      ['Advanced', 3],
    ])
  })

  it('keeps the visible built-in catalog curated and free of generator sketches', () => {
    const ids = BUILT_IN_PRACTICE_PIECES.map((piece) => piece.id)
    const searchableText = BUILT_IN_PRACTICE_PIECES.map((piece) =>
      [piece.id, piece.title, piece.subtitle, piece.attribution, piece.teaches, piece.provenance]
        .join(' ')
        .toLowerCase(),
    )

    expect(ids).not.toEqual(
      expect.arrayContaining([
        'guitar-greensleeves',
        'guitar-scarborough-fair',
        'guitar-spanish-romance-intro',
        'guitar-carulli-style-etude',
        'guitar-amazing-grace',
        'guitar-when-the-saints',
        'guitar-aura-lee',
        'guitar-ode-to-joy',
        'piano-fur-elise-excerpt',
        'piano-gymnopedie-no1-excerpt',
        'piano-mary-had-a-little-lamb',
        'piano-ode-to-joy',
        'piano-twinkle-twinkle',
      ]),
    )
    expect(searchableText.some((text) => /\bgenerated sketch\b|cc0 style study/.test(text))).toBe(
      false,
    )
    expect(BUILT_IN_PRACTICE_PIECES.every((piece) => piece.license && piece.provenance)).toBe(true)
  })

  it('filters library cards by searchable metadata including tags and license', () => {
    const guitarPieces = getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.GUITAR })
    const pianoPieces = getBuiltInPracticePieces({ instrumentId: INSTRUMENT_IDS.PIANO })

    expect(filterLibraryItems(guitarPieces, 'aguado').length).toBeGreaterThanOrEqual(5)
    expect(filterLibraryItems(pianoPieces, 'minuet').map((piece) => piece.title)).toContain(
      'Minuet in G',
    )
    expect(filterLibraryItems(pianoPieces, 'public domain').length).toBeGreaterThan(0)
    expect(filterLibraryItems(guitarPieces, 'classical-guitar').length).toBeGreaterThan(0)
    expect(filterLibraryItems(pianoPieces, 'guitar')).toEqual([])
  })

  it('builds uploaded practice cards from instrument bundles and excludes demos', () => {
    const bundles = {
      [INSTRUMENT_IDS.PIANO]: {
        instrumentId: INSTRUMENT_IDS.PIANO,
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
        instrumentId: INSTRUMENT_IDS.GUITAR,
        pdfMeta: { fileName: 'Etude in E.pdf' },
        musicXmlSource: { fileName: 'etude.musicxml', data: '<score-partwise />' },
        demoPieceActive: false,
      },
      'legacy-upload': {
        pdfMeta: { fileName: 'Old Piano Upload.pdf' },
        musicXmlSource: { fileName: 'old.musicxml', data: '<score-partwise />' },
        demoPieceActive: false,
      },
      demo: {
        instrumentId: INSTRUMENT_IDS.PIANO,
        pdfMeta: { fileName: 'Demo.pdf' },
        musicXmlSource: { fileName: 'demo.musicxml', data: '<score-partwise />' },
        demoPieceActive: true,
      },
    }

    const pianoPieces = buildUploadedPracticePieces(bundles, {
      activeInstrumentId: INSTRUMENT_IDS.PIANO,
    })
    const guitarPieces = buildUploadedPracticePieces(bundles, {
      activeInstrumentId: INSTRUMENT_IDS.GUITAR,
    })

    expect(pianoPieces).toEqual([
      expect.objectContaining({
        title: 'Bach Prelude',
        instrument: 'Piano',
        instrumentId: INSTRUMENT_IDS.PIANO,
        difficulty: 'Uploaded',
        approxDuration: '1m 5s',
        subtitle: 'Timing: bach.musicxml',
        attribution: 'Sound: bach.mid',
        ready: true,
        isActive: true,
      }),
      expect.objectContaining({
        title: 'Old Piano Upload',
        instrumentId: INSTRUMENT_IDS.PIANO,
        instrument: 'Piano (legacy upload)',
        legacyInstrument: true,
      }),
    ])
    expect(pianoPieces.map((piece) => piece.title)).not.toContain('Etude in E')
    expect(guitarPieces.map((piece) => piece.title)).toEqual(['Etude in E'])
    expect(guitarPieces[0].instrumentId).toBe(INSTRUMENT_IDS.GUITAR)
    expect(filterLibraryItems(pianoPieces, 'bach.mid')).toHaveLength(1)
    expect(filterLibraryItems(guitarPieces, 'bach')).toEqual([])
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
    const app = readSrc('App.jsx')

    expect(library).toContain('Practice Library')
    expect(library).toContain('My Uploads')
    expect(library).toContain('Search uploads')
    expect(library).toContain('Upload your own piece')
    expect(library).toContain('Start Practice')
    expect(library).toContain('onDeleteUploadedPiece')
    expect(library).toContain('window.confirm')
    expect(library).toContain('className="practice-piece-card__remove"')
    expect(app).toContain('onDeleteUploadedPiece={handleDeleteUploadedPiece}')
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

  it('keeps delete scoped to uploaded pieces and preserves built-in practice cards', () => {
    const library = readSrc('components', 'LibraryPanel.jsx')
    const practiceSectionIndex = library.indexOf('selectedTab === LIBRARY_TABS.PRACTICE')
    const uploadsSectionIndex = library.indexOf('library-panel__uploads')
    const removeIndex = library.indexOf('practice-piece-card__remove')

    expect(removeIndex).toBeGreaterThan(uploadsSectionIndex)
    expect(removeIndex).toBeGreaterThan(practiceSectionIndex)
    expect(library).toContain('This will not affect built-in Practice Library pieces.')
  })

  it('deleting the active uploaded piece clears Practice and returns to Library safely', () => {
    const app = readSrc('App.jsx')

    expect(app).toContain('const handleDeleteUploadedPiece = useCallback')
    expect(app).toContain('store.clear(targetInstrument)')
    expect(app).toContain('URL.revokeObjectURL(storedBundle.pdfFile)')
    expect(app).toMatch(
      /if \(deletingActive\) \{[\s\S]*applyInstrumentBundle\(createEmptyInstrumentBundle\(\)\)[\s\S]*setLibraryTab\(LIBRARY_TABS\.UPLOADS\)[\s\S]*navigateToView\('library'\)/,
    )
    expect(app).toContain('persistUploadBundlesNow')
    expect(app).toContain('clearSessionStorage()')
  })

  it('keeps instrument-scoped uploads when generated timing is saved', () => {
    const app = readSrc('App.jsx')

    expect(app).toContain('const activeBundleForPersistence = snapshotInstrumentBundle')
    expect(app).toContain('persistedInstrumentBundles[currentInstrument] = activeBundleForPersistence')
    expect(app).toContain('instrumentBundles: persistedInstrumentBundles')
    expect(app).toContain('instrumentFiles: Object.fromEntries')
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
