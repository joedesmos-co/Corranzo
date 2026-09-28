import { useEffect, useState } from 'react'
import { Document, Page } from 'react-pdf'
import '../../pdf/setupPdfWorker.js'
import MultiFileUpload from '../MultiFileUpload.jsx'
import PdfOmrPlaybackPanel from './PdfOmrPlaybackPanel.jsx'
import Icon from '../../design/Icon.jsx'
import { getInstrument } from '../../features/instruments/instruments.js'
import useMusicXmlTiming from '../../features/musicxml/useMusicXmlTiming.js'
import { isLibraryScoreTimingReady, musicXmlSourceKey, shouldShowLibraryOmrPanel } from '../../features/import/musicXmlSource.js'
import { PRACTICE_MODE, PRACTICE_MODE_LABELS, normalizePracticeMode } from '../../features/practice/practiceMode.js'
import { IMPORT_MODE_HELP } from '../../features/import/importPresentation.js'
import useCompanionMidiCheck from '../../features/import/useCompanionMidiCheck.js'
import '../../styles/import.css'

const INTRO_KEY = 'corranzo-import-modes-seen-v1'
function firstImport() { try { return localStorage.getItem(INTRO_KEY) !== 'true' } catch { return true } }

export default function ImportScoreView({
  fileName, pdfSource, pdfFileUrl, pdfIdentity, practiceSessionEpoch, musicXmlSource, midiFileName, midiSource,
  instrumentId, uploadsDisabled, onFileSelect, onMusicXmlSelect, onMidiSelect, onClassifiedUpload,
  onClearMusicXml, onClearMidi, onOmrGenerated, onImportFeedback, importFeedback,
  autoOmrRequest, onAutoOmrRequestConsumed, onOpenScore, initialMode, onBack,
}) {
  const [pdfState, setPdfState] = useState('loading')
  const [pages, setPages] = useState(null)
  const [preview, setPreview] = useState(null)
  useEffect(() => {
    if (!pdfFileUrl) return
    const controller = new AbortController()
    // Complete the local fetch before PDF.js mounts. This keeps cancellation
    // from destroying an active PDF network reader during rapid navigation.
    fetch(pdfFileUrl, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('PDF unavailable')
      return response.arrayBuffer()
    }).then(data => {
      if (!controller.signal.aborted) setPreview({ file: pdfFileUrl, data })
    }).catch(() => { if (!controller.signal.aborted) setPdfState('error') })
    return () => controller.abort()
  }, [pdfFileUrl])
  const [showIntroduction] = useState(firstImport)
  const [mode, setMode] = useState(() => normalizePracticeMode(initialMode))
  const { checking: midiChecking, invalid: midiInvalid } = useCompanionMidiCheck(midiSource)
  const hasPdf = Boolean(pdfFileUrl)
  const timing = useMusicXmlTiming(musicXmlSource)
  const owned = !musicXmlSource?.ownerPdfIdentity || musicXmlSource.ownerPdfIdentity === pdfIdentity
  const sourceReady = owned && isLibraryScoreTimingReady(musicXmlSource)
  const mapReady = timing.timingMap?.sourceContentKey === musicXmlSourceKey(musicXmlSource)
  const ready = hasPdf && pdfState === 'ready' && sourceReady && mapReady && !timing.isLoading && !timing.error && timing.timingMap?.notes?.length > 0
  const emptyNotation = sourceReady && mapReady && !timing.isLoading && !timing.error && !timing.timingMap?.notes?.length
  const showOmrPanel = shouldShowLibraryOmrPanel({ hasPdf, musicXmlSource, pdfIdentity })
  const qualityWarning = musicXmlSource?.omrMeta?.quality?.acceptance === 'warning'
  const waitAvailable = musicXmlSource?.source !== 'omr' || musicXmlSource?.omrMeta?.sourceVisualMap?.anchorCount > 0
  const selectedMode = mode === PRACTICE_MODE.WAIT_FOR_YOU && !waitAvailable ? PRACTICE_MODE.PREVIEW : mode
  const autoOmrRequestForCurrentPdf = autoOmrRequest?.instrumentId === instrumentId && autoOmrRequest?.pdfFileName === fileName ? autoOmrRequest : null
  const pickerProps = { onFileSelect, onMusicXmlSelect, onMidiSelect, onClassifiedUpload, disabled: uploadsDisabled }
  function openScore() {
    if (!ready || midiInvalid || midiChecking) return
    try { localStorage.setItem(INTRO_KEY, 'true') } catch { /* Help remains available without storage. */ }
    onOpenScore?.(selectedMode)
  }
  function modeKeys(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const modes = Object.values(PRACTICE_MODE).filter(value => value !== PRACTICE_MODE.WAIT_FOR_YOU || waitAvailable)
    const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    const next = event.key === 'Home' ? modes[0] : event.key === 'End' ? modes.at(-1) : modes[(modes.indexOf(selectedMode) + offset + modes.length) % modes.length]
    setMode(next)
    event.currentTarget.querySelector(`[data-mode="${next}"]`)?.focus()
  }
  return <section className="score-import" aria-label="Import a score">
    <header className="score-import-heading">
      <button className="cz-text-link" onClick={onBack}><Icon name="prev" />Library</button>
      <p className="cz-edition-label">Corranzo / Your music</p>
      <h1>Bring your score.</h1>
      <p>From the page to your next practice.</p>
    </header>
    <div className={`score-import-layout${hasPdf ? ' score-import-layout--selected' : ''}`}>
      <div className="score-import-source">
        {hasPdf ? <>
          <div className="score-import-file"><Icon name="music" size={22} /><div><h2 title={fileName}>{fileName}</h2><p>{pages ? `${pages} ${pages === 1 ? 'page' : 'pages'} · PDF` : 'PDF selected'}</p></div></div>
          <figure className="score-import-preview" aria-label="First page of your score">
            {preview?.file === pdfFileUrl ? <Document file={preview.data} onLoadSuccess={({ numPages }) => { setPages(numPages); setPdfState('ready') }} onLoadError={() => setPdfState('error')}
              loading={<p>Opening your PDF…</p>} error={<p>This PDF could not be displayed. Choose a fresh copy.</p>}>
              <Page pageNumber={1} width={480} renderTextLayer={false} renderAnnotationLayer={false} loading={<p>Drawing the first page…</p>} />
            </Document> : <p>{pdfState === 'error' ? 'This PDF could not be displayed. Choose a fresh copy.' : 'Opening your PDF…'}</p>}
          </figure>
          <p className="score-import-caption">Your original page stays the reference.</p>
          <MultiFileUpload {...pickerProps} hasPdf />
          <p className="score-import-caption score-import-replacement-note">Another PDF replaces your saved {getInstrument(instrumentId).label.toLowerCase()} score. Keep your original files to return to it.</p>
        </> : <>
          <MultiFileUpload {...pickerProps} />
          <p className="score-import-format-note">A digital PDF or a clear scan works best. Have a photo? Save or print it as a PDF first.</p>
          <div className="score-import-how"><span>01</span><p><strong>Choose your sheet music</strong>A PDF is all you need to start.</p><span>02</span><p><strong>Let Corranzo read the page</strong>We’ll prepare playback and tell you if anything needs a closer look.</p><span>03</span><p><strong>Make it your own</strong>Choose how to begin, then open your score.</p></div>
        </>}
      </div>
      <div className="score-import-outcome">
        {!hasPdf && <div className="score-import-empty"><p className="cz-edition-label">A little care goes a long way</p><h2>A clear page.<br />A better start.</h2><p>Include the whole page, keep notes sharp, and avoid glare or shadows. For photos, keep the camera square to the music.</p><p>Your score is prepared in this browser.</p></div>}
        {hasPdf && showOmrPanel && <PdfOmrPlaybackPanel
          key={`omr-panel-${fileName ?? 'score'}-${pdfFileUrl ?? 'no-url'}`}
          pdfSource={pdfSource} pdfFileUrl={pdfFileUrl} pdfFileName={fileName} pdfIdentity={pdfIdentity} practiceSessionEpoch={practiceSessionEpoch}
          disabled={uploadsDisabled} onGenerated={onOmrGenerated} onFeedback={onImportFeedback}
          autoStartKey={autoOmrRequestForCurrentPdf?.key ?? null} onAutoStartConsumed={onAutoOmrRequestConsumed} />}
        {hasPdf && !showOmrPanel && !ready && <div className="score-import-message" role={timing.error || emptyNotation || pdfState === 'error' ? 'alert' : 'status'}>
          <h2>{timing.error || emptyNotation || pdfState === 'error' ? 'This score isn’t ready to open' : 'Checking your score'}</h2>
          <p>{pdfState === 'error' ? 'Choose a fresh PDF that opens in a PDF reader.' : timing.error || emptyNotation ? 'The optional notation file could not be read. Replace or remove it in Advanced to prepare from the PDF again.' : 'Making sure the page and playback are available.'}</p>
        </div>}
        {ready && <section className="score-import-ready" aria-label="Score ready">
          <p className="score-import-ready-label" role="status"><Icon name="check" size={20} />{midiInvalid ? 'Score prepared · accompaniment needs attention' : qualityWarning ? 'Ready for a closer look' : 'Your score is ready'}</p>
          {midiInvalid && <div className="score-import-warning" role="alert"><strong>The optional accompaniment couldn’t be read.</strong><p>Remove it to use the score’s own playback, or add another copy in Advanced.</p><button className="cz-text-link" onClick={onClearMidi}>Remove MIDI</button></div>}
          {qualityWarning && <div className="score-import-warning" role="note"><strong>Listen through before you practice.</strong><p>Some notes or rhythms may need a closer look. Compare playback with your original page.</p></div>}
          <h2>{showIntroduction ? 'How would you like to begin?' : 'Choose your starting mode.'}</h2>
          {showIntroduction && <p className="score-import-intro">Three ways to use your score. You can switch at any time.</p>}
          <div className="score-import-modes" role="radiogroup" aria-label="Starting mode" onKeyDown={modeKeys}>
            {Object.values(PRACTICE_MODE).map(value => <button key={value} data-mode={value} role="radio" aria-checked={selectedMode === value} tabIndex={selectedMode === value ? 0 : -1}
              disabled={value === PRACTICE_MODE.WAIT_FOR_YOU && !waitAvailable} onClick={() => setMode(value)}>
              <span className="score-import-mode-dot" aria-hidden="true" /><span><strong>{PRACTICE_MODE_LABELS[value]}</strong><span>{IMPORT_MODE_HELP[value]}</span></span>
            </button>)}
          </div>
          {!waitAvailable && <p className="score-import-capability">Wait For You needs reliable score following. Begin with Preview or Play Along; score-follow setup is available in workspace settings.</p>}
          <button className="cz-collection-button score-import-open" onClick={openScore} disabled={uploadsDisabled || midiInvalid || midiChecking}>Open score<Icon name="next" size={20} /></button>
          <p className="score-import-caption">{midiChecking ? 'Checking optional accompaniment…' : `Opens in ${PRACTICE_MODE_LABELS[selectedMode]}. No extra files needed.`}</p>
        </section>}
        {importFeedback?.type === 'error' && importFeedback.source !== 'preparation' && <div className="score-import-warning" role="alert"><strong>A file needs attention.</strong><p>{/MB.*limit|file.*too large/i.test(importFeedback.message ?? '') ? importFeedback.message : 'It could not be added. Try another copy, or check the details under Advanced.'}</p></div>}
        <details className="score-import-advanced">
          <summary>Advanced · optional files & details</summary>
          <p>Already have files from a notation app? Add matching MusicXML, XML or MXL for the written notes, and MIDI for accompaniment. The PDF remains the page you read.</p>
          {!hasPdf && <p>Add your PDF first to attach optional files.</p>}
          <MultiFileUpload {...pickerProps} advanced disabled={uploadsDisabled || !hasPdf} />
          {musicXmlSource?.fileName && <div className="score-import-attachment"><span>{musicXmlSource.fileName}</span><button onClick={onClearMusicXml} disabled={uploadsDisabled}>Remove notation file</button></div>}
          {midiFileName && <div className="score-import-attachment"><span>{midiFileName}</span><button onClick={onClearMidi} disabled={uploadsDisabled}>Remove MIDI</button></div>}
          {!hasPdf && (musicXmlSource || midiFileName) && <p role="status">Optional files are attached. Add the matching PDF to open a score.</p>}
          {timing.error && <p className="score-import-detail">{timing.error}</p>}
          {importFeedback?.message && <p className="score-import-detail">{importFeedback.message}</p>}
          <p>Native MuseScore files and direct image files aren’t supported here. Export your score to PDF or MusicXML first.</p>
        </details>
      </div>
    </div>
  </section>
}
