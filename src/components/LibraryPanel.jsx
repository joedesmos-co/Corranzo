import LibraryAccuracyGuide from './LibraryAccuracyGuide.jsx'
import MultiFileUpload from './MultiFileUpload.jsx'
import PdfOmrPlaybackPanel from './library/PdfOmrPlaybackPanel.jsx'
import {
  ACCEPT_ATTRIBUTES,
  isAcceptedScoreTimingFile,
  isMuseScoreSourceFile,
  MUSESCORE_PLANNED_MESSAGE,
} from '../features/import/sourceNotationFiles.js'
import { isAcceptedFileType } from '../features/import/fileImportLimits.js'
import {
  isLibraryScoreTimingReady,
  shouldShowLibraryOmrPanel,
} from '../features/import/musicXmlSource.js'
import { getInstrument } from '../features/instruments/instruments.js'
import {
  DIFFICULTY_FILTERS,
  LIBRARY_TABS,
  filterLibraryItems,
  getBuiltInPracticePieces,
  groupPracticePiecesByDifficulty,
} from '../features/library/practiceLibrary.js'
import { useEffect, useMemo, useState } from 'react'

function rejectMessage(kind) {
  if (kind === 'pdf') {
    return 'Not a PDF — choose a .pdf file.'
  }
  if (kind === 'midi') {
    return 'Not a MIDI file — choose .mid or .midi.'
  }
  return 'Unsupported — choose .mxl, .musicxml, or .xml.'
}

export default function LibraryPanel({
  className = '',
  activeTab = LIBRARY_TABS.PRACTICE,
  onTabChange,
  instrumentId,
  fileName,
  midiFileName,
  musicXmlFileName,
  musicXmlSource = null,
  onFileSelect,
  onMidiSelect,
  onMusicXmlSelect,
  onClearMidi,
  onClearMusicXml,
  onClassifiedUpload = null,
  onImportFeedback,
  onLoadSampleFixtures,
  uploadedPieces = [],
  onOpenUploadedPiece = null,
  onDeleteUploadedPiece = null,
  pdfSource = null,
  pdfFileUrl = null,
  onOmrGenerated = null,
  autoOmrRequest = null,
  onAutoOmrRequestConsumed = null,
  sampleLoadLoading = false,
  sampleLoadError = null,
  importFeedback = null,
  uploadsDisabled = false,
  fileHelpSignal = 0,
}) {
  const [difficultyFilter, setDifficultyFilter] = useState('all')
  const [practiceSearch, setPracticeSearch] = useState('')
  const [uploadsSearch, setUploadsSearch] = useState('')
  const hasPdf = Boolean(pdfFileUrl || pdfSource || fileName)
  const hasMusicXml = isLibraryScoreTimingReady(musicXmlSource)
  const hasMidi = Boolean(midiFileName)
  const showOmrPanel = shouldShowLibraryOmrPanel({ hasPdf, musicXmlSource })
  const autoOmrRequestForCurrentPdf =
    autoOmrRequest?.instrumentId === instrumentId &&
    autoOmrRequest?.pdfFileName === fileName
      ? autoOmrRequest
      : null
  const activeInstrument = getInstrument(instrumentId)
  const visiblePracticePieces = useMemo(
    () =>
      filterLibraryItems(
        getBuiltInPracticePieces({ instrumentId, difficulty: difficultyFilter }),
        practiceSearch,
      ),
    [instrumentId, difficultyFilter, practiceSearch],
  )
  const practiceGroups = useMemo(
    () => groupPracticePiecesByDifficulty(visiblePracticePieces),
    [visiblePracticePieces],
  )
  const visibleUploadedPieces = useMemo(
    () => filterLibraryItems(uploadedPieces, uploadsSearch),
    [uploadedPieces, uploadsSearch],
  )
  const selectedTab = activeTab === LIBRARY_TABS.UPLOADS ? LIBRARY_TABS.UPLOADS : LIBRARY_TABS.PRACTICE
  const selectTab = (tab) => {
    onTabChange?.(tab)
  }

  useEffect(() => {
    setDifficultyFilter('all')
    setPracticeSearch('')
  }, [instrumentId])

  function reportReject(kind) {
    onImportFeedback?.({ type: 'error', message: rejectMessage(kind) })
  }

  function handlePdfChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!isAcceptedFileType(file, 'pdf')) {
      reportReject('pdf')
      event.target.value = ''
      return
    }
    onFileSelect(file)
    event.target.value = ''
  }

  function handleMidiChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!isAcceptedFileType(file, 'midi')) {
      reportReject('midi')
      event.target.value = ''
      return
    }
    onMidiSelect(file)
    event.target.value = ''
  }

  function handleScoreTimingChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!isAcceptedScoreTimingFile(file)) {
      reportReject('scoreTiming')
      event.target.value = ''
      return
    }
    if (isMuseScoreSourceFile(file)) {
      onImportFeedback?.({ type: 'info', message: MUSESCORE_PLANNED_MESSAGE })
      event.target.value = ''
      return
    }
    onMusicXmlSelect(file)
    event.target.value = ''
  }

  function handleDeleteUploadedPiece(piece) {
    if (!onDeleteUploadedPiece) {
      return
    }
    const confirmed = window.confirm(
      `Remove "${piece.title}" from My Uploads? This will not affect built-in Practice Library pieces.`,
    )
    if (confirmed) {
      onDeleteUploadedPiece(piece)
    }
  }

  return (
    <aside className={`library-panel ${className}`.trim()}>
      <header className="library-panel__hero">
        <p className="library-panel__tagline">Start practicing</p>
        <p className="library-panel__browser-hint" role="note">
          Choose a built-in piece, or add your own files.
        </p>
      </header>

      <div className="library-panel__tabs" role="tablist" aria-label="Library sections">
        <button
          type="button"
          role="tab"
          aria-selected={selectedTab === LIBRARY_TABS.PRACTICE}
          className={`library-panel__tab${selectedTab === LIBRARY_TABS.PRACTICE ? ' library-panel__tab--active' : ''}`}
          onClick={() => selectTab(LIBRARY_TABS.PRACTICE)}
        >
          Practice Library
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedTab === LIBRARY_TABS.UPLOADS}
          className={`library-panel__tab${selectedTab === LIBRARY_TABS.UPLOADS ? ' library-panel__tab--active' : ''}`}
          onClick={() => selectTab(LIBRARY_TABS.UPLOADS)}
        >
          My Uploads
        </button>
      </div>

      {selectedTab === LIBRARY_TABS.PRACTICE ? (
        <section className="practice-library" aria-labelledby="practice-library-heading">
          <div className="practice-library__header">
            <div>
              <p className="practice-library__eyebrow">{activeInstrument.label}</p>
              <h2 id="practice-library-heading" className="practice-library__title">
                Practice Library
              </h2>
            </div>
            <div className="practice-library__tools">
              <label className="library-search">
                <span className="library-search__label">Search</span>
                <input
                  className="library-search__input"
                  type="search"
                  value={practiceSearch}
                  onChange={(event) => setPracticeSearch(event.target.value)}
                  placeholder={`Search ${activeInstrument.label} pieces`}
                />
              </label>
              <div className="practice-library__filters" aria-label="Difficulty filter">
                {DIFFICULTY_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={`practice-library__filter${difficultyFilter === filter.id ? ' practice-library__filter--active' : ''}`}
                    aria-pressed={difficultyFilter === filter.id}
                    onClick={() => setDifficultyFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {practiceGroups.length > 0 ? (
            <div className="practice-library__groups">
              {practiceGroups.map((group) => (
                <section className="practice-library__group" key={group.difficulty}>
                  <h3 className="practice-library__group-title">{group.difficulty}</h3>
                  <div className="practice-library__grid">
                    {group.pieces.map((piece) => (
                      <article className="practice-piece-card" key={piece.id}>
                        <div className="practice-piece-card__main">
                          <p className="practice-piece-card__meta">
                            {piece.instrument} - {piece.difficulty} - {piece.approxDuration}
                          </p>
                          <h4 className="practice-piece-card__title">{piece.title}</h4>
                          <p className="practice-piece-card__subtitle">{piece.subtitle}</p>
                          {piece.teaches ? (
                            <p className="practice-piece-card__teaches" title={piece.teaches}>
                              {piece.teaches}
                            </p>
                          ) : null}
                        </div>
                        <div className="practice-piece-card__action">
                          <button
                            type="button"
                            className="practice-piece-card__button"
                            disabled={sampleLoadLoading || !onLoadSampleFixtures}
                            onClick={() => onLoadSampleFixtures?.(piece.id)}
                            aria-label={`Start practice: ${piece.title}`}
                          >
                            {sampleLoadLoading ? 'Opening...' : 'Start Practice'}
                          </button>
                          <p className="practice-piece-card__credit">{piece.attribution}</p>
                        </div>
                        {sampleLoadError && (
                          <div className="practice-piece-card__error-block" role="alert">
                            <p className="practice-piece-card__error">{sampleLoadError}</p>
                            <button
                              type="button"
                              className="practice-piece-card__retry"
                              disabled={sampleLoadLoading || !onLoadSampleFixtures}
                              onClick={() => onLoadSampleFixtures?.(piece.id)}
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="practice-library__empty">
              No built-in {activeInstrument.label} pieces match this search.
            </p>
          )}
        </section>
      ) : (
        <section className="library-panel__uploads" aria-labelledby="library-uploads-heading">
          <div className="practice-library__header">
            <div>
              <p className="practice-library__eyebrow">Your files</p>
              <h2 id="library-uploads-heading" className="practice-library__title">
                My Uploads
              </h2>
            </div>
            <label className="library-search">
              <span className="library-search__label">Search</span>
              <input
                className="library-search__input"
                type="search"
                value={uploadsSearch}
                onChange={(event) => setUploadsSearch(event.target.value)}
                placeholder="Search uploads"
              />
            </label>
          </div>

          {uploadedPieces.length > 0 && visibleUploadedPieces.length === 0 && (
            <p className="practice-library__empty">No uploaded pieces match this search.</p>
          )}

          <div className="practice-library__grid library-panel__uploads-grid">
            <article className="practice-piece-card practice-piece-card--add-files">
              <div className="practice-piece-card__main">
                <p className="practice-piece-card__meta">Add files</p>
                <h4 className="practice-piece-card__title">Upload your own piece</h4>
                <p className="practice-piece-card__teaches">
                  PDF, timing, and optional MIDI.
                </p>
              </div>

              <MultiFileUpload
                hasPdf={hasPdf}
                hasMusicXml={hasMusicXml}
                hasMidi={hasMidi}
                onFileSelect={onFileSelect}
                onMusicXmlSelect={onMusicXmlSelect}
                onMidiSelect={onMidiSelect}
                onClearMusicXml={onClearMusicXml}
                onClearMidi={onClearMidi}
                onClassifiedUpload={onClassifiedUpload}
                disabled={uploadsDisabled}
              />

              {importFeedback?.message && (
                <p
                  className={`library-panel__feedback library-panel__feedback--${importFeedback.type ?? 'info'}`}
                  role={importFeedback.type === 'error' ? 'alert' : 'status'}
                >
                  {importFeedback.message}
                </p>
              )}

              {showOmrPanel && (
                <PdfOmrPlaybackPanel
                  key={`omr-panel-${fileName ?? 'score'}-${pdfFileUrl ?? 'no-url'}`}
                  pdfSource={pdfSource}
                  pdfFileUrl={pdfFileUrl}
                  pdfFileName={fileName}
                  disabled={uploadsDisabled}
                  onGenerated={onOmrGenerated}
                  onFeedback={onImportFeedback}
                  autoStartKey={autoOmrRequestForCurrentPdf?.key ?? null}
                  onAutoStartConsumed={onAutoOmrRequestConsumed}
                />
              )}

              {showOmrPanel && (
                <p className="library-panel__workflow library-panel__workflow-next" role="status">
                  Upload MusicXML/MXL anytime for the most accurate timing.
                </p>
              )}

              <details className="library-panel__advanced">
                <summary className="library-panel__advanced-summary">Upload one file at a time</summary>

                <div className="panel library-panel__upload-card">
                  <h2 className="panel__title practice-section__title--editorial">
                    <span className="panel__step-badge">1</span> Sheet music
                  </h2>
                  <p className="panel__hint">PDF - the score you read on screen.</p>

                  <label className={`upload-btn${uploadsDisabled ? ' upload-btn--disabled' : ''}`}>
                    Upload PDF
                    <input
                      type="file"
                      accept={ACCEPT_ATTRIBUTES.sheetMusic}
                      hidden
                      disabled={uploadsDisabled}
                      onChange={handlePdfChange}
                    />
                  </label>

                  {fileName ? (
                    <p className="library-panel__file" title={fileName}>
                      {fileName}
                    </p>
                  ) : (
                    <p className="library-panel__empty">Choose the score you want to read.</p>
                  )}
                </div>

                <div className="panel library-panel__upload-card library-panel__musicxml">
                  <h2 className="panel__title practice-section__title--editorial">
                    <span className="panel__step-badge">2</span> Timing file
                  </h2>
                  <p className="panel__hint">
                    Keeps Practice, loops, and Wait For You lined up with your score.
                  </p>

                  <label
                    className={`upload-btn upload-btn--musicxml${uploadsDisabled ? ' upload-btn--disabled' : ''}`}
                  >
                    Upload Timing File
                    <input
                      type="file"
                      accept={ACCEPT_ATTRIBUTES.scoreTiming}
                      hidden
                      disabled={uploadsDisabled}
                      onChange={handleScoreTimingChange}
                    />
                  </label>

                  {musicXmlFileName ? (
                    <div className="library-panel__loaded-file">
                      <p className="library-panel__file" title={musicXmlFileName}>
                        {musicXmlFileName}
                      </p>
                      {onClearMusicXml && (
                        <button
                          type="button"
                          className="library-panel__file-remove"
                          onClick={onClearMusicXml}
                          disabled={uploadsDisabled}
                        >
                          Remove Timing File
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="library-panel__empty">Usually MusicXML or MXL from your notation app.</p>
                  )}
                </div>

                <div className="panel library-panel__upload-card library-panel__midi">
                  <h2 className="panel__title practice-section__title--editorial">
                    <span className="panel__step-badge">3</span> Sound <span className="panel__optional">(optional)</span>
                  </h2>
                  <p className="panel__hint">MIDI - backing audio in Practice.</p>

                  <label
                    className={`upload-btn upload-btn--midi${uploadsDisabled ? ' upload-btn--disabled' : ''}`}
                  >
                    Upload MIDI
                    <input
                      type="file"
                      accept={ACCEPT_ATTRIBUTES.soundFile}
                      hidden
                      disabled={uploadsDisabled}
                      onChange={handleMidiChange}
                    />
                  </label>

                  {midiFileName ? (
                    <div className="library-panel__loaded-file">
                      <p className="library-panel__file" title={midiFileName}>
                        {midiFileName}
                      </p>
                      {onClearMidi && (
                        <button
                          type="button"
                          className="library-panel__file-remove"
                          onClick={onClearMidi}
                          disabled={uploadsDisabled}
                        >
                          Remove Sound File
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="library-panel__empty">Add MIDI only if you want backing playback.</p>
                  )}
                </div>
              </details>
            </article>

            {visibleUploadedPieces.map((piece) => (
              <article
                className="practice-piece-card practice-piece-card--uploaded"
                key={piece.id}
              >
                <div className="practice-piece-card__main">
                  <p className="practice-piece-card__meta">
                    {piece.instrument} - {piece.difficulty} - {piece.approxDuration}
                  </p>
                  <h4 className="practice-piece-card__title">{piece.title}</h4>
                  <p className="practice-piece-card__subtitle">{piece.subtitle}</p>
                  {piece.teaches ? (
                    <p className="practice-piece-card__teaches" title={piece.teaches}>
                      {piece.teaches}
                    </p>
                  ) : null}
                </div>
                <div className="practice-piece-card__action">
                  <button
                    type="button"
                    className="practice-piece-card__button"
                    disabled={!onOpenUploadedPiece}
                    onClick={() => onOpenUploadedPiece?.(piece.instrumentId)}
                    aria-label={`Open Practice: ${piece.title}`}
                  >
                    Start Practice
                  </button>
                  <button
                    type="button"
                    className="practice-piece-card__remove"
                    disabled={!onDeleteUploadedPiece}
                    onClick={() => handleDeleteUploadedPiece(piece)}
                    aria-label={`Remove upload: ${piece.title}`}
                  >
                    Remove
                  </button>
                  <p className="practice-piece-card__credit">{piece.attribution}</p>
                </div>
              </article>
            ))}
          </div>

          {uploadedPieces.length === 0 && (
            <p className="practice-library__empty">
              No uploads yet. Add files to create your first practice piece.
            </p>
          )}

          <LibraryAccuracyGuide
            hasPdf={hasPdf}
            hasMusicXml={hasMusicXml}
            openHelpSignal={fileHelpSignal}
          />
        </section>
      )}
    </aside>
  )
}
