import { useCallback, useEffect, useRef, useState } from 'react'
import { runPdfOmrClient, cancelActiveOmrWorker } from '../../features/omr/runPdfOmrClient.js'
import { describePdfSourceType, isPdfBufferAttached } from '../../features/omr/omrPdfSource.js'
import { beginOmrUiBlock, endOmrUiBlock, releaseOmrUiLocks } from '../../features/omr/omrUiGuard.js'
import { OMR_STATUS, OMR_STATUS_LABEL, yieldToBrowser } from '../../features/omr/omrConstants.js'
import { nextOmrTraceRunId, omrTrace } from '../../features/omr/omrTrace.js'

function resetOmrPanelState(setters) {
  setters.setIsGenerating(false)
  setters.setStatus(OMR_STATUS.IDLE)
  setters.setProgressLabel('')
}

export default function PdfOmrPlaybackPanel({
  pdfSource = null,
  pdfFileUrl = null,
  pdfFileName = null,
  disabled = false,
  onGenerated = null,
  onFeedback = null,
}) {
  const [status, setStatus] = useState(OMR_STATUS.IDLE)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [progressLabel, setProgressLabel] = useState('')
  const abortRef = useRef(null)
  const activeRunRef = useRef(0)
  const completedRunRef = useRef(false)

  useEffect(() => () => {
    if (!completedRunRef.current) {
      abortRef.current?.abort()
      cancelActiveOmrWorker()
    }
    releaseOmrUiLocks()
  }, [])

  const handleCancel = useCallback(() => {
    omrTrace('ui:handleCancel')
    completedRunRef.current = false
    abortRef.current?.abort()
    cancelActiveOmrWorker()
    setError(null)
    resetOmrPanelState({ setIsGenerating, setStatus, setProgressLabel })
    endOmrUiBlock()
    releaseOmrUiLocks()
    onFeedback?.(null)
  }, [onFeedback])

  const handleGenerate = useCallback(async () => {
    const runId = nextOmrTraceRunId()
    activeRunRef.current = runId
    completedRunRef.current = false

    omrTrace('ui:handleGenerate:enter', {
      pdfSource: Boolean(pdfSource),
      pdfFileUrl: Boolean(pdfFileUrl),
      isGenerating,
      disabled,
    }, runId)

    if ((!pdfSource && !pdfFileUrl) || isGenerating || disabled) {
      omrTrace('ui:handleGenerate:early-return', {
        reason: !pdfSource && !pdfFileUrl
          ? 'missing-pdf-bytes'
          : isGenerating
            ? 'busy'
            : 'disabled',
      }, runId)
      return
    }

    omrTrace(
      'ui:pdfSource-type',
      {
        type: describePdfSourceType(pdfSource),
        hasPdfFileUrl: typeof pdfFileUrl === 'string' && pdfFileUrl.length > 0,
      },
      runId,
    )
    if (pdfSource instanceof ArrayBuffer) {
      omrTrace(
        'ui:pdfSource-buffer-attached',
        { attached: isPdfBufferAttached(pdfSource), byteLength: pdfSource.byteLength },
        runId,
      )
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    omrTrace('ui:handleGenerate:clear-errors', null, runId)
    setError(null)
    onFeedback?.(null)
    setSummary(null)
    setProgressLabel('Starting…')
    setIsGenerating(true)
    setStatus(OMR_STATUS.ANALYZING)
    beginOmrUiBlock(`run-${runId}`)

    let resetInFinally = true
    try {
      omrTrace('ui:handleGenerate:runPdfOmrClient:start', null, runId)
      const result = await runPdfOmrClient(pdfSource, {
        title: pdfFileName?.replace(/\.[^.]+$/, '') ?? 'PDF score',
        pdfFileUrl,
        onStatus: (nextStatus) => {
          omrTrace('ui:onStatus', { nextStatus }, runId)
          setStatus(nextStatus)
        },
        onProgress: (progress) => {
          setProgressLabel(progress.label ?? '')
        },
        signal: controller.signal,
        useWorker: true,
        traceRunId: runId,
      })

      if (activeRunRef.current !== runId) {
        omrTrace('ui:handleGenerate:stale-run-after-resolve', null, runId)
        return
      }

      if (controller.signal.aborted) {
        omrTrace('ui:handleGenerate:aborted-after-resolve', null, runId)
        return
      }

      omrTrace('ui:handleGenerate:success', {
        noteCount: result.noteCount,
        measureCount: result.measureCount,
      }, runId)

      cancelActiveOmrWorker()
      endOmrUiBlock()

      await yieldToBrowser()
      const fileName = `${(pdfFileName ?? 'score.pdf').replace(/\.pdf$/i, '')}.omr.musicxml`
      const accepted = await onGenerated?.({
        fileName,
        musicXml: result.musicXml,
        noteCount: result.noteCount,
        measureCount: result.measureCount,
        diagnostics: result.diagnostics,
        measureGrid: result.measureGrid,
      })

      completedRunRef.current = true
      resetInFinally = false

      if (accepted?.ok === false) {
        const message = accepted.message ?? 'Generated playback failed.'
        setError(message)
        setSummary(null)
        setIsGenerating(false)
        setProgressLabel('')
        setStatus(OMR_STATUS.FAILED)
        return
      }

      const uncertainHint =
        result.uncertainMeasures > 0
          ? ` · ${result.uncertainMeasures} uncertain`
          : ''
      const confidenceHint =
        result.overallConfidence != null
          ? ` · ${Math.round(result.overallConfidence * 100)}% confidence`
          : ''
      setSummary(
        `${result.noteCount} notes · ${result.measureCount} measures${uncertainHint}${confidenceHint}`,
      )
      setError(null)
      setIsGenerating(false)
      setProgressLabel('')
      setStatus(OMR_STATUS.READY)
    } catch (err) {
      if (activeRunRef.current !== runId) {
        omrTrace('ui:handleGenerate:stale-run-catch-ignored', {
          message: err?.message,
        }, runId)
        return
      }

      omrTrace('ui:handleGenerate:catch', {
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
      }, runId)

      if (err?.name === 'AbortError') {
        return
      }
      resetInFinally = false
      const message = err?.message ?? 'Experimental PDF playback failed.'
      omrTrace('ui:setError', { message }, runId)
      setError(message)
      setSummary(null)
      setIsGenerating(false)
      setProgressLabel('')
      setStatus(OMR_STATUS.FAILED)
      omrTrace('ui:onFeedback:error', { message }, runId)
      onFeedback?.({ type: 'error', message })
    } finally {
      cancelActiveOmrWorker()
      endOmrUiBlock()
      releaseOmrUiLocks()
      if (resetInFinally && activeRunRef.current === runId && !completedRunRef.current) {
        resetOmrPanelState({ setIsGenerating, setStatus, setProgressLabel })
      }
      omrTrace('ui:handleGenerate:finally', {
        runId,
        completed: completedRunRef.current,
      }, runId)
    }
  }, [pdfSource, pdfFileUrl, pdfFileName, isGenerating, disabled, onGenerated, onFeedback])

  const pdfBytesAvailable = Boolean(pdfSource) || Boolean(pdfFileUrl)

  return (
    <section className="library-omr-panel" aria-label="Experimental PDF playback" aria-busy={isGenerating}>
      <div className="library-omr-panel__header">
        <h2 className="library-omr-panel__title practice-section__title--editorial">
          Experimental PDF playback
        </h2>
        <span className="library-omr-panel__badge">Beta</span>
      </div>
      <p className="library-omr-panel__lede">
        Have only a PDF? Corranzo can try to make playable timing locally. It is experimental;
        MusicXML/MXL is still best when you have it.
      </p>
      <div className="library-omr-panel__actions">
        <button
          type="button"
          className="upload-btn library-omr-panel__btn"
          disabled={disabled || isGenerating || !pdfBytesAvailable}
          onClick={handleGenerate}
        >
          {isGenerating ? OMR_STATUS_LABEL[status] || 'Analyzing PDF…' : 'Generate experimental playback from PDF'}
        </button>
        {!pdfBytesAvailable && !isGenerating && (
          <p className="library-omr-panel__status" role="status">
            PDF is still loading — try again in a moment.
          </p>
        )}
        {isGenerating && (
          <button
            type="button"
            className="upload-btn library-omr-panel__btn library-omr-panel__btn--cancel"
            onClick={handleCancel}
          >
            Cancel
          </button>
        )}
      </div>
      {isGenerating && (
        <div className="library-omr-panel__progress" role="status" aria-live="polite">
          <span className="library-omr-panel__progress-bar" aria-hidden="true" />
          <p className="library-omr-panel__status">
            {progressLabel || OMR_STATUS_LABEL[status] || 'Analyzing PDF…'}
          </p>
        </div>
      )}
      {!isGenerating && status === OMR_STATUS.READY && summary && (
        <p className="library-omr-panel__status library-omr-panel__status--ready" role="status">
          PDF playback ready — {summary}
        </p>
      )}
      {!isGenerating && status === OMR_STATUS.READY && (
        <p className="library-omr-panel__status library-omr-panel__disclaimer" role="note">
          Experimental PDF playback may be inaccurate. For accurate playback, upload MusicXML/MXL.
        </p>
      )}
      {!isGenerating && status === OMR_STATUS.FAILED && error && (
        <p className="library-omr-panel__status library-omr-panel__status--error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
