import { useCallback, useEffect, useRef, useState } from 'react'
import { runPdfOmrClient, cancelActiveOmrWorker } from '../../features/omr/runPdfOmrClient.js'
import { useInstrument } from '../../context/instrumentContext.js'
import { describePdfSourceType, isPdfBufferAttached } from '../../features/omr/omrPdfSource.js'
import { beginOmrUiBlock, endOmrUiBlock, releaseOmrUiLocks } from '../../features/omr/omrUiGuard.js'
import { OMR_STATUS, OMR_STATUS_LABEL, yieldToBrowser } from '../../features/omr/omrConstants.js'
import { nextOmrTraceRunId, omrTrace } from '../../features/omr/omrTrace.js'
import {
  buildOmrDiagnosticExport,
  copyOmrDiagnosticExport,
  describeOmrDevTools,
  toggleOmrDebug,
  toggleOmrTrace,
  toggleOmrV3Compare,
  toggleOmrV3Prefer,
} from '../../features/omr/omrDevTools.js'
import {
  getOmrDiagnosticFlags,
  resolveOmrV3DeveloperPipelineOptions,
} from '../../features/omr/omrDiagnosticFlags.js'
import { selectOmrDeveloperMusicXml } from '../../features/omr/v3/omrV3Diagnostics.js'

function resetOmrPanelState(setters) {
  setters.setIsGenerating(false)
  setters.setStatus(OMR_STATUS.IDLE)
  setters.setProgressLabel('')
}

function formatOmrFailureMessage(error) {
  const rawMessage = error?.message ?? ''
  if (/TAB staff lines were detected/i.test(rawMessage)) {
    return rawMessage
  }
  if (/too difficult|confidence|unsupported|failed/i.test(rawMessage)) {
    return 'We could not read enough of this PDF automatically. You can try again, or upload MusicXML/MXL for the most accurate timing.'
  }
  return 'We could not get timing ready from this PDF. You can try again, or upload MusicXML/MXL for the most accurate timing.'
}

export default function PdfOmrPlaybackPanel({
  pdfSource = null,
  pdfFileUrl = null,
  pdfFileName = null,
  disabled = false,
  onGenerated = null,
  onFeedback = null,
  autoStartKey = null,
  onAutoStartConsumed = null,
}) {
  const { instrumentId } = useInstrument()
  const [status, setStatus] = useState(OMR_STATUS.IDLE)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [progressLabel, setProgressLabel] = useState('')
  const [devFlags, setDevFlags] = useState(() => getOmrDiagnosticFlags())
  const [devCopyStatus, setDevCopyStatus] = useState('')
  const [hasDiagnostics, setHasDiagnostics] = useState(false)
  const abortRef = useRef(null)
  const activeRunRef = useRef(0)
  const completedRunRef = useRef(false)
  const lastDiagnosticsRef = useRef(null)
  const lastRunMetaRef = useRef(null)
  const autoStartedKeyRef = useRef(null)

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
    setHasDiagnostics(false)
    resetOmrPanelState({ setIsGenerating, setStatus, setProgressLabel })
    endOmrUiBlock()
    releaseOmrUiLocks()
    onFeedback?.(null)
  }, [onFeedback])

  const onGeneratedRef = useRef(onGenerated)
  onGeneratedRef.current = onGenerated
  const onFeedbackRef = useRef(onFeedback)
  onFeedbackRef.current = onFeedback

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
    setHasDiagnostics(false)
    setProgressLabel('Starting…')
    setIsGenerating(true)
    setStatus(OMR_STATUS.ANALYZING)
    beginOmrUiBlock(`run-${runId}`)

    let resetInFinally = true
    try {
      omrTrace('ui:handleGenerate:runPdfOmrClient:start', null, runId)
      const developerOptions = resolveOmrV3DeveloperPipelineOptions(getOmrDiagnosticFlags())
      const result = await runPdfOmrClient(pdfSource, {
        title: pdfFileName?.replace(/\.[^.]+$/, '') ?? 'PDF score',
        pdfFileUrl,
        instrumentId,
        omrV3Compare: developerOptions.omrV3Compare,
        omrV3Shadow: developerOptions.omrV3Shadow,
        onStatus: (nextStatus) => {
          if (activeRunRef.current !== runId || controller.signal.aborted) {
            return
          }
          omrTrace('ui:onStatus', { nextStatus }, runId)
          setStatus(nextStatus)
        },
        onProgress: (progress) => {
          if (activeRunRef.current !== runId || controller.signal.aborted) {
            return
          }
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

      if (developerOptions.logV3Telemetry && result.omrV3RuntimePromotion?.disagreement) {
        omrTrace('ui:omr-v3-disagreement', result.omrV3RuntimePromotion.disagreement, runId)
      }

      const selectedOutput = selectOmrDeveloperMusicXml(
        result,
        developerOptions.preferV3Output ? 'v3' : 'v2',
      )
      // Prefer-V3 is a developer evaluation toggle only. Comparison mode keeps
      // production MusicXml as V2; prefer may swap the accepted library payload
      // in non-PROD so engineers can audition V3 without arming promotions.
      const acceptedMusicXml = selectedOutput.musicXml

      omrTrace('ui:handleGenerate:success', {
        noteCount: result.noteCount,
        measureCount: result.measureCount,
        outputEngine: selectedOutput.engine,
        comparisonStatus: result.omrV3Comparison?.status ?? null,
      }, runId)

      lastDiagnosticsRef.current = {
        ...(result.diagnostics ?? {}),
        omrV3Comparison: result.omrV3Comparison ?? null,
        omrV3DeveloperDiagnostics: result.omrV3DeveloperDiagnostics ?? null,
        omrV3RuntimePromotion: result.omrV3RuntimePromotion ?? null,
      }
      setHasDiagnostics(Boolean(result.diagnostics || result.omrV3Comparison))
      lastRunMetaRef.current = {
        runId,
        noteCount: result.noteCount,
        measureCount: result.measureCount,
        uncertainMeasures: result.uncertainMeasures ?? null,
        overallConfidence: result.overallConfidence ?? null,
        outputEngine: selectedOutput.engine,
        comparisonStatus: result.omrV3Comparison?.status ?? null,
      }

      cancelActiveOmrWorker()
      endOmrUiBlock()

      await yieldToBrowser()
      const fileName = `${(pdfFileName ?? 'score.pdf').replace(/\.pdf$/i, '')}.omr.musicxml`
      const accepted = await onGeneratedRef.current?.({
        fileName,
        musicXml: acceptedMusicXml,
        noteCount: result.noteCount,
        measureCount: result.measureCount,
        diagnostics: lastDiagnosticsRef.current,
        warnings: result.warnings ?? [],
        measureGrid: result.measureGrid,
        sourcePdfFileName: pdfFileName ?? null,
        sourcePdfFileUrl: pdfFileUrl ?? null,
        sourceInstrumentId: instrumentId,
      })

      if (activeRunRef.current !== runId || controller.signal.aborted) {
        omrTrace('ui:handleGenerate:stale-run-after-onGenerated', null, runId)
        return
      }

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
      const tabApproximateHint = result.diagnostics?.tablature?.rhythmApproximate
        ? ' · TAB rhythm approximate'
        : ''
      setSummary(
        `${result.noteCount} notes · ${result.measureCount} measures${uncertainHint}${confidenceHint}${tabApproximateHint}`,
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
      const message = formatOmrFailureMessage(err)
      omrTrace('ui:setError', { message }, runId)
      setError(message)
      setSummary(null)
      setHasDiagnostics(false)
      setIsGenerating(false)
      setProgressLabel('')
      setStatus(OMR_STATUS.FAILED)
      omrTrace('ui:onFeedback:error', { message }, runId)
      onFeedbackRef.current?.({ type: 'error', message })
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
  }, [pdfSource, pdfFileUrl, pdfFileName, instrumentId, isGenerating, disabled])

  // Keep the latest start helpers in refs so this effect can stay Strict Mode
  // safe without re-arming whenever callback identities churn.
  const handleGenerateRef = useRef(handleGenerate)
  handleGenerateRef.current = handleGenerate
  const onAutoStartConsumedRef = useRef(onAutoStartConsumed)
  onAutoStartConsumedRef.current = onAutoStartConsumed

  useEffect(() => {
    if (!autoStartKey || autoStartedKeyRef.current === autoStartKey) {
      return undefined
    }
    if ((!pdfSource && !pdfFileUrl) || disabled || isGenerating) {
      return undefined
    }
    if (status === OMR_STATUS.READY || status === OMR_STATUS.FAILED) {
      return undefined
    }

    // Do NOT mark the key as started until the timeout fires. React Strict Mode
    // re-runs effects on the same fiber (refs persist); marking early + clearing
    // the timeout leaves preparation stuck in IDLE forever.
    const keyToStart = autoStartKey
    const autoRunTimer = setTimeout(() => {
      if (autoStartedKeyRef.current === keyToStart) {
        return
      }
      autoStartedKeyRef.current = keyToStart
      onAutoStartConsumedRef.current?.(keyToStart)
      handleGenerateRef.current()
    }, 0)
    return () => {
      clearTimeout(autoRunTimer)
    }
  }, [
    autoStartKey,
    pdfSource,
    pdfFileUrl,
    disabled,
    isGenerating,
    status,
  ])

  const handleCopyDiagnostics = useCallback(async () => {
    const bundle = buildOmrDiagnosticExport({
      diagnostics: lastDiagnosticsRef.current,
      runMeta: lastRunMetaRef.current,
    })
    const result = await copyOmrDiagnosticExport(bundle)
    setDevCopyStatus(result.ok ? 'Diagnostics copied.' : 'Copy failed — see console.')
    if (!result.ok) {
      console.info(describeOmrDevTools())
      console.info(result.text)
    }
  }, [])

  const handleToggleTrace = useCallback(() => {
    const next = toggleOmrTrace(!devFlags.trace)
    setDevFlags(next)
  }, [devFlags.trace])

  const handleToggleDebug = useCallback(() => {
    const next = toggleOmrDebug(!devFlags.debug)
    setDevFlags(next)
  }, [devFlags.debug])

  const handleToggleV3Compare = useCallback(() => {
    const next = toggleOmrV3Compare(!devFlags.v3Compare)
    setDevFlags(next)
  }, [devFlags.v3Compare])

  const handleToggleV3Prefer = useCallback(() => {
    const next = toggleOmrV3Prefer(!devFlags.v3Prefer)
    setDevFlags(next)
  }, [devFlags.v3Prefer])

  const pdfBytesAvailable = Boolean(pdfSource) || Boolean(pdfFileUrl)
  const showDevTools = import.meta.env.DEV
  const showRetry = !isGenerating && status === OMR_STATUS.FAILED
  const showPreparing =
    isGenerating || (Boolean(autoStartKey) && status === OMR_STATUS.IDLE)

  return (
    <section className="library-omr-panel" aria-label="Preparing score" aria-busy={isGenerating}>
      <div className="library-omr-panel__header">
        <h2 className="library-omr-panel__title practice-section__title--editorial">
          Preparing score
        </h2>
        <span className="library-omr-panel__badge">Local</span>
      </div>
      <p className="library-omr-panel__lede">
        {showRetry
          ? 'Something went wrong while preparing this PDF.'
          : 'This may take a moment.'}
      </p>
      <div className="library-omr-panel__actions">
        {showRetry && (
          <button
            type="button"
            className="upload-btn library-omr-panel__btn"
            disabled={disabled || !pdfBytesAvailable}
            onClick={handleGenerate}
          >
            Try again
          </button>
        )}
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
      {showPreparing && (
        <div className="library-omr-panel__progress" role="status" aria-live="polite">
          <span className="library-omr-panel__progress-bar" aria-hidden="true" />
          <p className="library-omr-panel__status">
            Preparing score… {isGenerating ? progressLabel || OMR_STATUS_LABEL[status] || '' : ''}
          </p>
        </div>
      )}
      {!isGenerating && status === OMR_STATUS.READY && summary && (
        <p className="library-omr-panel__status library-omr-panel__status--ready" role="status">
          Ready to practice — {summary}
        </p>
      )}
      {!isGenerating && status === OMR_STATUS.FAILED && error && (
        <p className="library-omr-panel__status library-omr-panel__status--error" role="alert">
          {error}
        </p>
      )}
      {showDevTools && (
        <div className="profile-dev-tools library-omr-panel__dev-tools" aria-label="OMR developer tools">
          <span className="profile-dev-tools__label">OMR diagnostics</span>
          <button
            type="button"
            className="profile-dev-tools__btn"
            onClick={handleCopyDiagnostics}
            disabled={!hasDiagnostics}
          >
            Copy diagnostic JSON
          </button>
          <button
            type="button"
            className={`profile-dev-tools__btn${devFlags.trace ? '' : ' profile-dev-tools__btn--muted'}`}
            onClick={handleToggleTrace}
            aria-pressed={devFlags.trace}
          >
            Trace {devFlags.trace ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className={`profile-dev-tools__btn${devFlags.debug ? '' : ' profile-dev-tools__btn--muted'}`}
            onClick={handleToggleDebug}
            aria-pressed={devFlags.debug}
          >
            Debug {devFlags.debug ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className={`profile-dev-tools__btn${devFlags.v3Compare ? '' : ' profile-dev-tools__btn--muted'}`}
            onClick={handleToggleV3Compare}
            aria-pressed={devFlags.v3Compare}
            title="Run V2 and V3 together; keep V2 user-visible; attach comparison report"
          >
            V3 compare {devFlags.v3Compare ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className={`profile-dev-tools__btn${devFlags.v3Prefer ? '' : ' profile-dev-tools__btn--muted'}`}
            onClick={handleToggleV3Prefer}
            aria-pressed={devFlags.v3Prefer}
            title="Developer-only: accept V3 MusicXML into the library instead of V2"
          >
            Prefer V3 {devFlags.v3Prefer ? 'on' : 'off'}
          </button>
          {devCopyStatus && (
            <span className="library-omr-panel__status" role="status">
              {devCopyStatus}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
