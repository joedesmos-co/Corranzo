import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  RECOGNITION_PROBLEM_CATEGORIES,
  buildRecognitionReportPackage,
  downloadRecognitionReportPackage,
  successMessageForRecognitionExport,
} from '../../features/omr/recognitionProblemReport/index.js'
import { focusFirstElement, handleFocusTrap } from '../../utils/focusTrap.js'
import '../../styles/recognitionProblemReport.css'

const PRIVACY_NOTE =
  'The original PDF is not included unless you explicitly choose to include it.'

/**
 * Local-only diagnostic export dialog for recognition problems.
 * Resets form state when ownerScoreId changes (score replacement).
 */
export default function RecognitionProblemReportDialog({
  open = false,
  onClose = null,
  ownerScoreId = null,
  mode = 'score', // 'score' | 'omr-failure'
  activeScore = null,
  musicXmlSource = null,
  pdfMeta = null,
  pdfBuffer = null,
  instrumentId = null,
  generation = null,
  timingMap = null,
  diagnostics = null,
  omrRunMeta = null,
  failure = null,
  defaultCategory = null,
  onExported = null,
}) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [trackedOwner, setTrackedOwner] = useState(ownerScoreId)
  const [category, setCategory] = useState(defaultCategory ?? 'other')
  const [description, setDescription] = useState('')
  const [pageNumber, setPageNumber] = useState('')
  const [measureNumber, setMeasureNumber] = useState('')
  const [includePdf, setIncludePdf] = useState(false)
  const [confirmPdf, setConfirmPdf] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)

  // Score replacement must wipe draft text / PDF inclusion choices.
  if (ownerScoreId !== trackedOwner) {
    setTrackedOwner(ownerScoreId)
    setCategory(defaultCategory ?? (mode === 'omr-failure' ? 'failed-to-generate' : 'other'))
    setDescription('')
    setPageNumber('')
    setMeasureNumber('')
    setIncludePdf(false)
    setConfirmPdf(false)
    setError(null)
    setStatus(null)
  }

  useEffect(() => {
    if (!open) {
      return undefined
    }
    previousFocusRef.current =
      typeof document !== 'undefined' ? document.activeElement : null
    const frame = requestAnimationFrame(() => {
      focusFirstElement(dialogRef.current)
    })
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
        return
      }
      handleFocusTrap(dialogRef.current, event)
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      const previous = previousFocusRef.current
      if (previous && typeof previous.focus === 'function') {
        previous.focus()
      }
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  const canExportPdf = Boolean(pdfBuffer && (pdfBuffer.byteLength ?? 0) > 0)
  const needsPdfConfirm = includePdf && canExportPdf

  const handleExport = async () => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      if (needsPdfConfirm && !confirmPdf) {
        setError('Confirm that you want to include the original PDF before exporting.')
        setBusy(false)
        return
      }
      const pkg = buildRecognitionReportPackage({
        category,
        description,
        pageNumber,
        measureNumber,
        includeOriginalPdf: includePdf && canExportPdf,
        pdfConfirmed: confirmPdf,
        activeScore,
        musicXmlSource,
        pdfMeta,
        pdfBuffer: includePdf && canExportPdf ? pdfBuffer : null,
        instrumentId,
        generation,
        timingMap,
        diagnostics,
        omrRunMeta,
        failure,
        mode,
      })
      if (!pkg.ok) {
        setError(pkg.ownership?.message ?? pkg.message ?? 'Could not build the report.')
        setBusy(false)
        return
      }
      const downloaded = await downloadRecognitionReportPackage(pkg)
      if (!downloaded.ok) {
        setError('Could not download the report in this environment.')
        setBusy(false)
        return
      }
      const message = successMessageForRecognitionExport({ pdfIncluded: pkg.pdfIncluded })
      setStatus(message)
      onExported?.({ message, pdfIncluded: pkg.pdfIncluded, filename: downloaded.filename })
    } catch (err) {
      setError(err?.message ?? 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="recognition-report-modal" data-testid="recognition-report-modal">
      <div
        className="recognition-report-modal__scrim"
        aria-hidden="true"
        onClick={() => onClose?.()}
      />
      <section
        ref={dialogRef}
        className="recognition-report-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="recognition-report-modal__header">
          <h2 id={titleId}>Report recognition problem</h2>
          <button
            type="button"
            className="recognition-report-modal__close"
            onClick={() => onClose?.()}
            aria-label="Close"
          >
            Close
          </button>
        </header>

        <p className="recognition-report-modal__lead">
          Export a local diagnostic package for this score. Nothing is uploaded.
        </p>
        <p className="recognition-report-modal__privacy">{PRIVACY_NOTE}</p>

        <label className="recognition-report-modal__field">
          <span>What went wrong?</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={busy}
          >
            {RECOGNITION_PROBLEM_CATEGORIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <div className="recognition-report-modal__row">
          <label className="recognition-report-modal__field">
            <span>Page (optional)</span>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={pageNumber}
              onChange={(event) => setPageNumber(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="recognition-report-modal__field">
            <span>Measure (optional)</span>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={measureNumber}
              onChange={(event) => setMeasureNumber(event.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        <label className="recognition-report-modal__field">
          <span>Short description (optional)</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            placeholder="Example: measure 12 chord looks wrong on the bass staff"
          />
        </label>

        <label className="recognition-report-modal__check">
          <input
            type="checkbox"
            checked={includePdf}
            disabled={busy || !canExportPdf}
            onChange={(event) => {
              setIncludePdf(event.target.checked)
              if (!event.target.checked) {
                setConfirmPdf(false)
              }
            }}
          />
          <span>Include original PDF</span>
        </label>
        {!canExportPdf && (
          <p className="recognition-report-modal__hint">
            Original PDF bytes are not available in memory for this score.
          </p>
        )}

        {needsPdfConfirm && (
          <label className="recognition-report-modal__check recognition-report-modal__check--confirm">
            <input
              type="checkbox"
              checked={confirmPdf}
              disabled={busy}
              onChange={(event) => setConfirmPdf(event.target.checked)}
            />
            <span>I understand the original PDF will be copied into the export ZIP.</span>
          </label>
        )}

        {error && (
          <p className="recognition-report-modal__error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="recognition-report-modal__status" role="status">
            {status}
          </p>
        )}

        <div className="recognition-report-modal__actions">
          <button
            type="button"
            className="recognition-report-modal__btn"
            onClick={() => onClose?.()}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="recognition-report-modal__btn recognition-report-modal__btn--primary"
            onClick={handleExport}
            disabled={busy || (needsPdfConfirm && !confirmPdf)}
          >
            {busy ? 'Exporting…' : 'Export report'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
