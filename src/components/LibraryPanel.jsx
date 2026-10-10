import PieceRow from './collection/PieceRow.jsx'
import ImportScoreView from './library/ImportScoreView.jsx'
import CreateFromAudio from './audio-vision/CreateFromAudio.jsx'
import { getInstrument } from '../features/instruments/instruments.js'
import {
  DIFFICULTY_FILTERS,
  LIBRARY_TABS,
  filterLibraryItems,
  getBuiltInPracticePieces,
  groupPracticePiecesByDifficulty,
} from '../features/library/practiceLibrary.js'
import { useEffect, useMemo, useState } from 'react'

export default function LibraryPanel({
  className = '',
  activeTab = LIBRARY_TABS.PRACTICE,
  onTabChange,
  instrumentId,
  fileName,
  midiFileName,
  midiSource,
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
  pdfIdentity = null,
  practiceSessionEpoch = null,
  onOmrGenerated = null,
  autoOmrRequest = null,
  onAutoOmrRequestConsumed = null,
  sampleLoadLoading = false,
  sampleLoadError = null,
  importFeedback = null,
  uploadsDisabled = false,
  importOnly = false,
  onImportScore,
  onOpenScore,
  initialMode,
  onBack,
  onArrangementReady = null,
}) {
  const [difficultyFilter, setDifficultyFilter] = useState('all')
  const [practiceSearch, setPracticeSearch] = useState('')
  const [uploadsSearch, setUploadsSearch] = useState('')
  const [openingPieceId, setOpeningPieceId] = useState(null)
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

  function openPiece(id) {
    setOpeningPieceId(id)
    onLoadSampleFixtures?.(id)
  }

  function handleTabKeys(event) {
    const tabs = [LIBRARY_TABS.PRACTICE, LIBRARY_TABS.UPLOADS]
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : selectedTab === tabs[0] ? 1 : 0
    selectTab(tabs[index])
    event.currentTarget.querySelectorAll('[role="tab"]')[index]?.focus()
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

  if (importOnly) return <ImportScoreView
    key={`${pdfIdentity ?? 'empty'}:${pdfFileUrl ?? ''}`}
    {...{ fileName, pdfSource, pdfFileUrl, pdfIdentity, practiceSessionEpoch, musicXmlSource, midiFileName, midiSource,
      instrumentId, uploadsDisabled, onFileSelect, onMusicXmlSelect, onMidiSelect, onClassifiedUpload,
      onClearMusicXml, onClearMidi, onOmrGenerated, onImportFeedback, importFeedback,
      autoOmrRequest, onAutoOmrRequestConsumed, onOpenScore, initialMode, onBack }} />

  return (
    <div className={`library-panel ${className}`.trim()}>
      <header className="library-panel__hero">
        <span className="cz-edition-label">Corranzo / Library</span>
        <h1 className="library-panel__tagline">{selectedTab === LIBRARY_TABS.PRACTICE ? 'Repertoire.' : 'Your scores.'}</h1>
        <p className="library-panel__browser-hint" role="note">
          {selectedTab === LIBRARY_TABS.PRACTICE
            ? 'Studies, familiar pieces, and something to grow into.'
            : `Imported PDFs for ${activeInstrument.label.toLowerCase()}, kept on this device.`}
        </p>
      </header>

      <div className="library-panel__tabs" role="tablist" aria-label="Library sections" onKeyDown={handleTabKeys}>
        <button
          type="button"
          role="tab"
          id="library-tab-practice"
          aria-controls="library-panel-practice"
          tabIndex={selectedTab === LIBRARY_TABS.PRACTICE ? 0 : -1}
          aria-selected={selectedTab === LIBRARY_TABS.PRACTICE}
          className={`library-panel__tab${selectedTab === LIBRARY_TABS.PRACTICE ? ' library-panel__tab--active' : ''}`}
          onClick={() => selectTab(LIBRARY_TABS.PRACTICE)}
        >
          Practice Library
        </button>
        <button
          type="button"
          role="tab"
          id="library-tab-uploads"
          aria-controls="library-panel-uploads"
          tabIndex={selectedTab === LIBRARY_TABS.UPLOADS ? 0 : -1}
          aria-selected={selectedTab === LIBRARY_TABS.UPLOADS}
          className={`library-panel__tab${selectedTab === LIBRARY_TABS.UPLOADS ? ' library-panel__tab--active' : ''}`}
          onClick={() => selectTab(LIBRARY_TABS.UPLOADS)}
        >
          My Uploads
        </button>
      </div>

      {selectedTab === LIBRARY_TABS.PRACTICE ? (
        <section className="practice-library" id="library-panel-practice" role="tabpanel" aria-labelledby="library-tab-practice">
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

          {sampleLoadLoading && <p role="status" className="cz-collection-credit">Opening your score…</p>}
          {sampleLoadError && <p role="alert" className="cz-collection-error">{sampleLoadError} Open the piece again to retry.</p>}
          {practiceGroups.length > 0 ? (
            <div className="practice-library__groups">
              {practiceGroups.map((group) => (
                <section className="practice-library__group" key={group.difficulty}>
                  <h3 className="practice-library__group-title">{group.difficulty}</h3>
                  <div className="cz-piece-list">
                    {group.pieces.map((piece) => (
                      <PieceRow
                        key={piece.id}
                        piece={piece}
                        number={visiblePracticePieces.indexOf(piece) + 1}
                        onOpen={onLoadSampleFixtures ? openPiece : undefined}
                        disabled={sampleLoadLoading}
                        opening={sampleLoadLoading && openingPieceId === piece.id}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="practice-library__empty">
              No {activeInstrument.label.toLowerCase()} pieces match this search. Try another title or composer, or choose All levels.
            </p>
          )}
          <p className="cz-collection-credit">Public-domain scores · Composer credits are shown with every piece.</p>
        </section>
      ) : (
        <section className="library-panel__uploads" id="library-panel-uploads" role="tabpanel" aria-labelledby="library-tab-uploads">
          <div className="practice-library__header">
            <div>
              <p className="practice-library__eyebrow">Your music</p>
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
                <p className="practice-piece-card__meta">{activeInstrument.label} · PDF</p>
                <h3 className="practice-piece-card__title">Add to your repertoire.</h3>
                <p className="practice-piece-card__teaches">Choose a PDF. We’ll help you get it ready to play.</p>
              </div>
              <button className="cz-collection-button" onClick={onImportScore}>Import a score</button>
            </article>

            {visibleUploadedPieces.map((piece) => (
              <article
                className="practice-piece-card practice-piece-card--uploaded"
                key={piece.id}
              >
                <div className="practice-piece-card__main">
                  <p className="practice-piece-card__meta">
                    {piece.instrument} · {piece.approxDuration}
                  </p>
                  <h3 className="practice-piece-card__title">{piece.title}</h3>
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
                    aria-label={`${piece.ready ? 'Open score' : 'Continue import'}: ${piece.title}`}
                  >
                    {piece.ready ? 'Open score' : 'Continue import'}
                  </button>
                  <button
                    type="button"
                    className="practice-piece-card__remove"
                    disabled={!onDeleteUploadedPiece}
                    onClick={() => handleDeleteUploadedPiece(piece)}
                    aria-label={`Remove score: ${piece.title}`}
                  >
                    Remove
                  </button>
                  <p className="practice-piece-card__credit">{piece.attribution}</p>
                </div>
              </article>
            ))}
          </div>

          <p className="cz-collection-credit">Corranzo currently keeps one imported score per instrument on this device. Opening another score replaces it.</p>
          {onArrangementReady && (
            <CreateFromAudio onArrangementReady={onArrangementReady} uploadsDisabled={uploadsDisabled} />
          )}
          {importFeedback?.type === 'error' && <p className="cz-collection-error" role="alert">{importFeedback.message}</p>}
          {uploadedPieces.length === 0 && (
            <p className="practice-library__empty">
              No scores here yet. Import a score to begin.
            </p>
          )}


        </section>
      )}
    </div>
  )
}
