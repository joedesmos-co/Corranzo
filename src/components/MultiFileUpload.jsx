import { useRef, useState } from 'react'
import Icon from '../design/Icon.jsx'
import { ACCEPT_ATTRIBUTES, isMuseScoreSourceFile, MUSESCORE_PLANNED_MESSAGE } from '../features/import/sourceNotationFiles.js'
import { applyClassifiedUploads, classifyUploadFiles } from '../features/import/classifyUploadFiles.js'
import { importFileNotice } from '../features/import/importPresentation.js'

/** Classifies inputs and delegates to the existing owned import handlers. */
export default function MultiFileUpload({ onFileSelect, onMusicXmlSelect, onMidiSelect, onClassifiedUpload = null, disabled = false, advanced = false, hasPdf = false }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [notices, setNotices] = useState([])
  const [busy, setBusy] = useState(false)
  async function handleFiles(fileList) {
    const files = Array.from(fileList ?? [])
    if (!files.length || disabled || busy) return
    const classified = classifyUploadFiles(files)
    const unsupported = classified.unsupported.map(importFileNotice)
    if (classified.musicXml.some(isMuseScoreSourceFile)) unsupported.push(MUSESCORE_PLANNED_MESSAGE)
    classified.musicXml = classified.musicXml.filter(file => !isMuseScoreSourceFile(file))
    if (!advanced && !classified.pdf.length && (classified.musicXml.length || classified.midi.length)) {
      setNotices(['Choose the PDF you want to read. Optional notation and accompaniment files belong under Advanced.'])
      return
    }
    setBusy(true)
    setNotices([])
    try {
      if (classified.pdf.length || classified.musicXml.length || classified.midi.length) {
        const messages = onClassifiedUpload
          ? await onClassifiedUpload(classified)
          : applyClassifiedUploads(classified, { onPdf: onFileSelect, onMusicXml: onMusicXmlSelect, onMidi: onMidiSelect })
        setNotices([...(messages ?? []).filter(message => !message.startsWith('Unsupported file skipped:')), ...unsupported])
      } else setNotices(unsupported)
    } catch {
      setNotices(['This file could not be opened. Choose it again, or try another copy.'])
    } finally { setBusy(false) }
  }
  return <section className="score-import-picker" aria-label={advanced ? 'Optional score files' : 'Choose a score file'} data-tour-id={advanced ? undefined : 'library-upload'}>
    <button type="button" className={`score-import-drop${dragOver ? ' score-import-drop--over' : ''}${hasPdf ? ' score-import-drop--replace' : ''}`}
      disabled={disabled || busy} onClick={() => inputRef.current?.click()}
      onDragOver={event => { event.preventDefault(); if (!disabled) setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={event => { event.preventDefault(); setDragOver(false); handleFiles(event.dataTransfer?.files) }}>
      <Icon name="import" size={advanced || hasPdf ? 20 : 30} />
      <span><strong>{busy ? 'Opening your file…' : advanced ? 'Add optional files' : hasPdf ? 'Choose another PDF' : 'Import a score'}</strong>
      {!hasPdf && <span>{advanced ? 'MusicXML, MXL or MIDI · matching PDFs also accepted' : 'Choose a PDF, or drop it here.'}</span>}</span>
      {!hasPdf && !advanced && <span className="score-import-drop__format">PDF · up to 80 MB</span>}
    </button>
    <input ref={inputRef} type="file" multiple={advanced} accept={advanced ? [ACCEPT_ATTRIBUTES.sheetMusic, '.musicxml,.xml,.mxl,.mid,.midi'].join(',') : ACCEPT_ATTRIBUTES.sheetMusic} hidden disabled={disabled || busy}
      aria-label={advanced ? 'Choose optional files' : 'Choose score PDF'}
      onChange={event => { handleFiles(event.target.files); event.target.value = '' }} />
    {notices.length > 0 && <ul className="score-import-notices" role="alert">{notices.map(notice => <li key={notice}>{notice}</li>)}</ul>}
  </section>
}
