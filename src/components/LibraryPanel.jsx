import LibraryAccuracyGuide from './LibraryAccuracyGuide.jsx'
import MultiFileUpload from './MultiFileUpload.jsx'
import DemoPieceCard from './DemoPieceCard.jsx'
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
  fileName,
  midiFileName,
  musicXmlFileName,
  musicXmlSource = null,
  onFileSelect,
  onMidiSelect,
  onMusicXmlSelect,
  onClassifiedUpload = null,
  onImportFeedback,
  onLoadSampleFixtures,
  onOpenPractice,
  pdfSource = null,
  pdfFileUrl = null,
  onOmrGenerated = null,
  sampleLoadLoading = false,
  sampleLoadError = null,
  importFeedback = null,
  uploadsDisabled = false,
  showDemo = true,
}) {
  const hasPdf = Boolean(pdfFileUrl || pdfSource || fileName)
  const hasMusicXml = isLibraryScoreTimingReady(musicXmlSource)
  const hasMidi = Boolean(midiFileName)
  const canOpenPractice = hasPdf && hasMusicXml
  const showOmrPanel = shouldShowLibraryOmrPanel({ hasPdf, musicXmlSource })

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

  return (
    <aside className={`library-panel ${className}`.trim()}>
      <header className="library-panel__hero">
        <p className="library-panel__tagline">Your practice library</p>
        <p className="library-panel__browser-hint" role="note">
          Add PDF + MusicXML. MIDI is optional.
        </p>
      </header>

      {showDemo && onLoadSampleFixtures && (
        <DemoPieceCard
          compact
          loading={sampleLoadLoading}
          error={sampleLoadError}
          onLoad={onLoadSampleFixtures}
          onRetry={onLoadSampleFixtures}
        />
      )}

      <MultiFileUpload
        hasPdf={hasPdf}
        hasMusicXml={hasMusicXml}
        hasMidi={hasMidi}
        onFileSelect={onFileSelect}
        onMusicXmlSelect={onMusicXmlSelect}
        onMidiSelect={onMidiSelect}
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
        />
      )}

      <LibraryAccuracyGuide hasPdf={hasPdf} hasMusicXml={hasMusicXml} />

      {canOpenPractice && onOpenPractice ? (
        <div className="library-panel__workflow library-panel__open-practice">
          <button type="button" className="upload-btn upload-btn--practice" onClick={onOpenPractice}>
            Open Practice
          </button>
          {!hasMidi && (
            <p className="library-panel__open-practice-text">Sound (MIDI) is optional.</p>
          )}
        </div>
      ) : showOmrPanel ? (
        <p className="library-panel__workflow library-panel__workflow-next" role="status">
          Or upload MusicXML/MXL for accurate Practice timing.
        </p>
      ) : null}

      <details className="library-panel__advanced">
        <summary className="library-panel__advanced-summary">Advanced upload (one file at a time)</summary>

      <div className="panel library-panel__upload-card">
        <h2 className="panel__title practice-section__title--editorial">
          <span className="panel__step-badge">1</span> Sheet music
        </h2>
        <p className="panel__hint">PDF — the score you read on screen.</p>

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
          <span className="panel__step-badge">2</span> Score timing
        </h2>
        <p className="panel__hint">
          MusicXML/MXL — required; powers Practice, loops &amp; Wait For You.
        </p>

        <label
          className={`upload-btn upload-btn--musicxml${uploadsDisabled ? ' upload-btn--disabled' : ''}`}
        >
          Upload MusicXML / MXL
          <input
            type="file"
            accept={ACCEPT_ATTRIBUTES.scoreTiming}
            hidden
            disabled={uploadsDisabled}
            onChange={handleScoreTimingChange}
          />
        </label>

        {musicXmlFileName ? (
          <p className="library-panel__file" title={musicXmlFileName}>
            {musicXmlFileName}
          </p>
        ) : (
          <p className="library-panel__empty">Export MusicXML or MXL from your notation app.</p>
        )}
      </div>

      <div className="panel library-panel__upload-card library-panel__midi">
        <h2 className="panel__title practice-section__title--editorial">
          <span className="panel__step-badge">3</span> Sound <span className="panel__optional">(optional)</span>
        </h2>
        <p className="panel__hint">MIDI — backing audio in Practice.</p>

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
          <p className="library-panel__file" title={midiFileName}>
            {midiFileName}
          </p>
        ) : (
          <p className="library-panel__empty">Add MIDI only if you want backing playback.</p>
        )}
      </div>
      </details>
    </aside>
  )
}
