import { lazy, Suspense } from 'react'
import LibraryAccuracyGuide from './LibraryAccuracyGuide.jsx'
import {
  ACCEPT_ATTRIBUTES,
  isAcceptedScoreTimingFile,
  isMuseScoreSourceFile,
  MUSESCORE_PLANNED_MESSAGE,
} from '../features/import/sourceNotationFiles.js'
import { isAcceptedFileType } from '../features/import/fileImportLimits.js'
import { isDemoSampleEnabled } from '../features/demo/demoSampleAccess.js'

const DevSampleLoadPanel = isDemoSampleEnabled()
  ? lazy(() => import('../dev/DevSampleLoadPanel.jsx'))
  : null

function rejectMessage(kind) {
  if (kind === 'pdf') {
    return 'That file is not a PDF. Choose a .pdf sheet music export.'
  }
  if (kind === 'midi') {
    return 'That file is not MIDI. Choose a .mid or .midi sound export.'
  }
  return 'That file is not a supported score timing file. Choose .mxl, .musicxml, or .xml.'
}

export default function LibraryPanel({
  className = '',
  fileName,
  midiFileName,
  musicXmlFileName,
  onFileSelect,
  onMidiSelect,
  onMusicXmlSelect,
  onImportFeedback,
  onLoadSampleFixtures,
  showOpenPractice = false,
  onOpenPractice,
  sampleLoadLoading = false,
  sampleLoadError = null,
  importFeedback = null,
  uploadsDisabled = false,
}) {
  const hasPdf = Boolean(fileName)
  const hasMusicXml = Boolean(musicXmlFileName)
  const hasMidi = Boolean(midiFileName)
  const canOpenPractice = hasPdf && hasMusicXml

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
      {isDemoSampleEnabled() && onLoadSampleFixtures && DevSampleLoadPanel && (
        <Suspense fallback={null}>
          <DevSampleLoadPanel
            loading={sampleLoadLoading}
            error={sampleLoadError}
            onLoad={onLoadSampleFixtures}
          />
        </Suspense>
      )}

      <header className="library-panel__hero">
        <p className="library-panel__tagline">
          Upload your sheet music and practice interactively.
        </p>
        <p className="library-panel__hero-hint">
          PDF for reading · MusicXML/MXL for timing · MIDI optional for sound
        </p>
        <p className="library-panel__browser-hint" role="note">
          Best on Chrome or Edge (desktop) for playback and MIDI. Safari and tablets are great for
          reading, annotations, and Wait For You with Manual continue.
        </p>
      </header>

      {importFeedback?.message && (
        <p
          className={`library-panel__feedback library-panel__feedback--${importFeedback.type ?? 'info'}`}
          role={importFeedback.type === 'error' ? 'alert' : 'status'}
        >
          {importFeedback.message}
        </p>
      )}

      <LibraryAccuracyGuide hasPdf={hasPdf} hasMusicXml={hasMusicXml} />

      <div className="library-panel__workflow" aria-label="Quick start">
        <p className="library-panel__workflow-title">Quick start</p>
        <ol className="library-panel__workflow-steps">
          <li className={hasPdf ? 'library-panel__workflow-step--done' : ''}>
            <span className="library-panel__step-num">1</span>
            <span>
              <strong>Upload PDF</strong> — sheet music to read
            </span>
          </li>
          <li className={hasMusicXml ? 'library-panel__workflow-step--done' : ''}>
            <span className="library-panel__step-num">2</span>
            <span>
              <strong>Upload MusicXML/MXL</strong> — score timing (required for Practice)
            </span>
          </li>
          <li className={hasMidi ? 'library-panel__workflow-step--done' : ''}>
            <span className="library-panel__step-num">3</span>
            <span>
              <strong>Optional:</strong> upload MIDI for backing sound
            </span>
          </li>
          <li className={canOpenPractice ? 'library-panel__workflow-step--done' : ''}>
            <span className="library-panel__step-num">4</span>
            <span>
              <strong>Open Practice</strong> — play, loop, Wait For You
            </span>
          </li>
        </ol>

        {canOpenPractice && onOpenPractice && (
          <div className="library-panel__open-practice">
            <button type="button" className="upload-btn upload-btn--practice" onClick={onOpenPractice}>
              Open Practice
            </button>
            {!hasMidi && (
              <p className="library-panel__open-practice-text">
                Sound is optional — you can add MIDI anytime for backing audio.
              </p>
            )}
          </div>
        )}

        {hasPdf && !hasMusicXml && (
          <p className="library-panel__workflow-next" role="status">
            Next: add score timing (MusicXML/MXL) so Practice knows where each measure is.
          </p>
        )}
      </div>

      <div className="panel library-panel__upload-card">
        <h2 className="panel__title">
          <span className="panel__step-badge">1</span> Sheet music
        </h2>
        <p className="panel__hint">PDF — the score you see on screen. Does not provide note timing.</p>

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
          <p className="library-panel__empty">No PDF yet</p>
        )}
      </div>

      <div className="panel library-panel__upload-card library-panel__musicxml">
        <h2 className="panel__title">
          <span className="panel__step-badge">2</span> Score timing
        </h2>
        <p className="panel__hint">
          MusicXML or MXL from your notation app — powers Practice, loops, and Wait For You.
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
          <p className="library-panel__empty">Required before Practice — export from MuseScore, etc.</p>
        )}
      </div>

      <div className="panel library-panel__upload-card library-panel__midi">
        <h2 className="panel__title">
          <span className="panel__step-badge">3</span> Sound <span className="panel__optional">(optional)</span>
        </h2>
        <p className="panel__hint">
          MIDI backing audio in Practice. Not required for timing or Wait For You.
        </p>

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
          <p className="library-panel__empty">Skip if you only want to read and play along yourself</p>
        )}
      </div>
    </aside>
  )
}
