import { useRef, useState } from 'react'
import { ACCEPT_ATTRIBUTES } from '../features/import/sourceNotationFiles.js'
import {
  applyClassifiedUploads,
  classifyUploadFiles,
} from '../features/import/classifyUploadFiles.js'

const ACCEPT_ALL = [
  ACCEPT_ATTRIBUTES.sheetMusic,
  ACCEPT_ATTRIBUTES.scoreTiming,
  ACCEPT_ATTRIBUTES.soundFile,
].join(',')

/**
 * One upload box for all score files: drag/drop or pick PDF + MusicXML/MXL +
 * optional MIDI at once. Each file is routed to the SAME import handler the
 * per-file cards use; this component adds no parsing.
 */
export default function MultiFileUpload({
  hasPdf = false,
  hasMusicXml = false,
  hasMidi = false,
  onFileSelect,
  onMusicXmlSelect,
  onMidiSelect,
  onClassifiedUpload = null,
  disabled = false,
}) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [notices, setNotices] = useState([])

  async function handleFiles(fileList) {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) {
      return
    }
    const classified = classifyUploadFiles(files)
    const messages = onClassifiedUpload
      ? await onClassifiedUpload(classified)
      : applyClassifiedUploads(classified, {
          onPdf: onFileSelect,
          onMusicXml: onMusicXmlSelect,
          onMidi: onMidiSelect,
        })
    setNotices(messages)
  }

  function openPicker() {
    if (!disabled) {
      inputRef.current?.click()
    }
  }

  function handleInputChange(event) {
    handleFiles(event.target.files)
    event.target.value = ''
  }

  function handleDrop(event) {
    event.preventDefault()
    setDragOver(false)
    if (disabled) {
      return
    }
    handleFiles(event.dataTransfer?.files)
  }

  function handleDragOver(event) {
    event.preventDefault()
    if (!disabled) {
      setDragOver(true)
    }
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  const statusClass = (ready) => (ready ? ' multi-upload__chip--ready' : '')

  return (
    <section className="multi-upload" aria-label="Upload score files" data-tour-id="library-upload">
      <button
        type="button"
        className={`multi-upload__dropzone${dragOver ? ' multi-upload__dropzone--over' : ''}`}
        onClick={openPicker}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        disabled={disabled}
      >
        <span className="multi-upload__title">Drop your score files here</span>
        <span className="multi-upload__hint">PDF + MusicXML/MXL + optional MIDI</span>
        <span className="multi-upload__cta" aria-hidden="true">
          Choose files
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ALL}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={handleInputChange}
      />

      <ul className="multi-upload__status" aria-label="Detected files">
        <li className={`multi-upload__chip${statusClass(hasPdf)}`}>
          PDF: {hasPdf ? 'ready' : 'missing'}
        </li>
        <li className={`multi-upload__chip${statusClass(hasMusicXml)}`}>
          Score: {hasMusicXml ? 'ready' : 'missing'}
        </li>
        <li className={`multi-upload__chip${statusClass(hasMidi)}`}>
          MIDI: {hasMidi ? 'ready' : 'optional'}
        </li>
      </ul>

      {notices.length > 0 && (
        <ul className="multi-upload__notices" role="status">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
