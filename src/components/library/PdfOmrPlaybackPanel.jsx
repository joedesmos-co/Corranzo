import { runScorePreparation } from '../../features/import/scorePreparationQueue.js'
import { describePreparation, describePreparationFailure } from '../../features/import/importPresentation.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { runPdfOmrClient, cancelActiveOmrWorker } from '../../features/omr/runPdfOmrClient.js'
import { useInstrument } from '../../context/instrumentContext.js'
import { describePdfSourceType, isPdfBufferAttached } from '../../features/omr/omrPdfSource.js'
import { beginOmrUiBlock, endOmrUiBlock, releaseOmrUiLocks } from '../../features/omr/omrUiGuard.js'
import { OMR_STATUS, yieldToBrowser } from '../../features/omr/omrConstants.js'
import { OMR_ACCEPTANCE, OMR_QUALITY_WARNING_MESSAGE } from '../../features/omr/assessOmrAcceptance.js'
import { nextOmrTraceRunId, omrTrace } from '../../features/omr/omrTrace.js'
import {
  buildOmrDiagnosticExport,
  buildOmrProvenancePackage,
  copyOmrDiagnosticExport,
  describeOmrDevTools,
  downloadOmrProvenancePackage,
  toggleOmrDebug,
  toggleOmrProvenance,
  toggleOmrTrace,
  toggleOmrV3Compare,
  toggleOmrV3Prefer,
} from '../../features/omr/omrDevTools.js'
import {
  getOmrDiagnosticFlags,
  resolveOmrV3DeveloperPipelineOptions,
} from '../../features/omr/omrDiagnosticFlags.js'
import { selectOmrDeveloperMusicXml } from '../../features/omr/v3/omrV3Diagnostics.js'
import {
  getActiveScoreSourceGeneration,
  noteOmrWorkerSettled,
  registerOmrRunStart,
} from '../../features/library/scoreSourceGenerationGate.js'
import RecognitionProblemReportDialog from '../omr/RecognitionProblemReportDialog.jsx'
import '../../styles/recognitionProblemReport.css'

function resetOmrPanelState(setters) {
  setters.setIsGenerating(false)
  setters.setStatus(OMR_STATUS.IDLE)
  setters.setProgressLabel('')
}

function pdfBytesFromOmrSource(pdfSource) {
  if (pdfSource instanceof ArrayBuffer) {
    return pdfSource
  }
  if (ArrayBuffer.isView(pdfSource)) {
    return pdfSource.buffer.slice(pdfSource.byteOffset, pdfSource.byteOffset + pdfSource.byteLength)
  }
  if (pdfSource && typeof pdfSource === 'object' && pdfSource.data != null) {
    return pdfBytesFromOmrSource(pdfSource.data)
  }
  return null
}

export default function PdfOmrPlaybackPanel({
  pdfSource = null,
  pdfFileUrl = null,
  pdfFileName = null,
  pdfIdentity = null,
  practiceSessionEpoch = null,
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
  const [progress, setProgress] = useState(null)
  const [failureCopy, setFailureCopy] = useState(null)
  const [cancelled, setCancelled] = useState(false)
  const [devFlags, setDevFlags] = useState(() => getOmrDiagnosticFlags())
  const [devCopyStatus, setDevCopyStatus] = useState('')
  const [hasDiagnostics, setHasDiagnostics] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [failureReport, setFailureReport] = useState(null)
  const [reportDiagnostics, setReportDiagnostics] = useState(null)
  const [reportRunMeta, setReportRunMeta] = useState(null)
  const abortRef = useRef(null)
  const activeRunRef = useRef(0)
  const completedRunRef = useRef(false)
  const lastDiagnosticsRef = useRef(null)
  const lastRunMetaRef = useRef(null)
  const autoStartedKeyRef = useRef(null)

  useEffect(() => () => {
    const runId = activeRunRef.current
    activeRunRef.current = nextOmrTraceRunId()
    const activeWorkerRun = getActiveScoreSourceGeneration().activeOmrRunId
    if (!completedRunRef.current) {
      abortRef.current?.abort()
      if (activeWorkerRun === runId) cancelActiveOmrWorker()
    }
    if (activeWorkerRun == null || activeWorkerRun === runId) releaseOmrUiLocks()
  }, [])

  // New PDF / session epoch must wipe prior panel UI. A discarded Piece-A
  // failure must never leave FAILED and block Piece-B auto-start.
  useEffect(() => {
    completedRunRef.current = false
    abortRef.current?.abort()
    activeRunRef.current = nextOmrTraceRunId()
    setError(null)
    setProgress(null)
    setFailureCopy(null)
    setCancelled(false)
    setSummary(null)
    setHasDiagnostics(false)
    setFailureReport(null)
    setReportDiagnostics(null)
    setReportRunMeta(null)
    setReportOpen(false)
    resetOmrPanelState({ setIsGenerating, setStatus, setProgressLabel })
    endOmrUiBlock()
    releaseOmrUiLocks()
    autoStartedKeyRef.current = null
  }, [pdfIdentity, practiceSessionEpoch])

  const handleCancel = useCallback(() => {
    omrTrace('ui:handleCancel')
    setCancelled(true)
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
    // Capture ownership at generate start — late callbacks must not apply to a
    // newer PDF/session after replacement.
    const runPdfIdentity = pdfIdentity
    const runPracticeSessionEpoch = practiceSessionEpoch
    const runScoreId =
      typeof window !== 'undefined'
        ? window.__SCOREFLOW_ACTIVE_SCORE__?.scoreId ??
          getActiveScoreSourceGeneration().activeScoreId
        : getActiveScoreSourceGeneration().activeScoreId

    omrTrace('ui:handleGenerate:enter', {
      pdfSource: Boolean(pdfSource),
      pdfFileUrl: Boolean(pdfFileUrl),
      isGenerating,
      disabled,
      pdfIdentity: runPdfIdentity,
      practiceSessionEpoch: runPracticeSessionEpoch,
      scoreId: runScoreId,
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

    const registered = registerOmrRunStart({
      runId,
      pdfIdentity: runPdfIdentity,
      epoch: runPracticeSessionEpoch,
      scoreId: runScoreId,
    })
    if (!registered.ok) {
      omrTrace('ui:handleGenerate:register-rejected', registered, runId)
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
    setFailureCopy(null)
    setProgress(null)
    setCancelled(false)
    onFeedbackRef.current?.(null)
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
      const result = await runScorePreparation(() => runPdfOmrClient(pdfSource, {
        title: pdfFileName?.replace(/\.[^.]+$/, '') ?? 'PDF score',
        pdfFileUrl,
        instrumentId,
        scoreId: runScoreId,
        generation: runPracticeSessionEpoch,
        pdfHash:
          typeof window !== 'undefined'
            ? window.__SCOREFLOW_ACTIVE_SCORE__?.pdfHash ?? null
            : null,
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
          setProgress(progress)
        },
        signal: controller.signal,
        useWorker: true,
        traceRunId: runId,
      }), controller.signal)

      noteOmrWorkerSettled({
        runId,
        pdfIdentity: runPdfIdentity,
        epoch: runPracticeSessionEpoch,
        outcome: 'resolved',
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
      setReportDiagnostics(lastDiagnosticsRef.current)
      lastRunMetaRef.current = {
        runId,
        noteCount: result.noteCount,
        measureCount: result.measureCount,
        uncertainMeasures: result.uncertainMeasures ?? null,
        overallConfidence: result.overallConfidence ?? null,
        outputEngine: selectedOutput.engine,
        comparisonStatus: result.omrV3Comparison?.status ?? null,
      }
      setReportRunMeta(lastRunMetaRef.current)

      cancelActiveOmrWorker()
      endOmrUiBlock()

      await yieldToBrowser()
      if (activeRunRef.current !== runId || controller.signal.aborted) {
        omrTrace('ui:handleGenerate:stale-run-before-onGenerated', null, runId)
        return
      }

      const fileName = `${(pdfFileName ?? 'score.pdf').replace(/\.pdf$/i, '')}.omr.musicxml`
      const accepted = await onGeneratedRef.current?.({
        fileName,
        musicXml: acceptedMusicXml,
        noteCount: result.noteCount,
        measureCount: result.measureCount,
        diagnostics: lastDiagnosticsRef.current,
        warnings: result.warnings ?? [],
        measureGrid: result.measureGrid,
        sourceVisualMap:
          selectedOutput.engine === 'v2' ? result.sourceVisualMap ?? null : null,
        acceptance: result.acceptance ?? null,
        quality: result.quality ?? null,
        overallConfidence: result.overallConfidence ?? null,
        sourcePdfFileName: pdfFileName ?? null,
        sourcePdfFileUrl: pdfFileUrl ?? null,
        sourceInstrumentId: instrumentId,
        sourcePdfIdentity: runPdfIdentity,
        sourcePracticeSessionEpoch: runPracticeSessionEpoch,
        sourceOmrRunId: runId,
        sourceScoreId: registered.scoreId ?? runScoreId,
      })

      // Stale / discarded results must not mutate panel UI (FAILED would block
      // the newer PDF's auto-start queue).
      if (activeRunRef.current !== runId || controller.signal.aborted) {
        omrTrace('ui:handleGenerate:stale-run-after-onGenerated', null, runId)
        return
      }
      if (accepted?.discarded) {
        omrTrace('ui:handleGenerate:discarded-zero-side-effects', {
          message: accepted?.message,
          reason: accepted?.reason,
        }, runId)
        return
      }

      completedRunRef.current = true
      resetInFinally = false

      if (accepted?.ok !== true) {
        const message = accepted?.message ?? 'Generated playback failed.'
        setError(message)
        setFailureCopy(describePreparationFailure({ message }))
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
      const qualityHint =
        result.acceptance === OMR_ACCEPTANCE.WARNING ? ' · lower confidence — compare with PDF' : ''
      setSummary(
        `${result.noteCount} notes · ${result.measureCount} measures${uncertainHint}${confidenceHint}${tabApproximateHint}${qualityHint}`,
      )
      setError(null)
      setIsGenerating(false)
      setProgressLabel('')
      setStatus(OMR_STATUS.READY)
      if (result.acceptance === OMR_ACCEPTANCE.WARNING) {
        onFeedbackRef.current?.({
          type: 'info',
          message: OMR_QUALITY_WARNING_MESSAGE,
        })
      }
    } catch (err) {
      noteOmrWorkerSettled({
        runId,
        pdfIdentity: runPdfIdentity,
        epoch: runPracticeSessionEpoch,
        outcome: 'rejected',
        errorName: err?.name ?? null,
      })

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
      const friendly = describePreparationFailure(err)
      setFailureCopy(friendly)
      const message = friendly.message
      omrTrace('ui:setError', { message }, runId)
      const failureDiagnostics = err?.diagnostics ?? null
      if (failureDiagnostics) {
        lastDiagnosticsRef.current = failureDiagnostics
      }
      lastRunMetaRef.current = {
        runId,
        stage: err?.code ?? err?.stage ?? err?.difficulty?.reasons?.[0] ?? null,
        scoreId: runScoreId,
        pdfIdentity: runPdfIdentity,
        practiceSessionEpoch: runPracticeSessionEpoch,
        pageCount: err?.pageCount ?? failureDiagnostics?.pages ?? null,
        overallConfidence: err?.overallConfidence ?? failureDiagnostics?.overallConfidence ?? null,
      }
      const failedSafety = err?.quality?.safetyChecks ?? err?.acceptance?.safetyChecks ?? null
      setFailureReport({
        stage: lastRunMetaRef.current.stage,
        exceptionName: err?.name ?? null,
        exceptionMessage: err?.message ?? null,
        exceptionStack: import.meta.env.DEV ? err?.stack ?? null : null,
        pageCount: lastRunMetaRef.current.pageCount,
        perPageConfidence: Array.isArray(failureDiagnostics?.pages)
          ? failureDiagnostics.pages.map((page) => ({
              page: page?.page ?? page?.pageNumber ?? null,
              confidence: page?.confidence ?? null,
            }))
          : [],
        acceptanceGate: err?.acceptance ?? err?.quality ?? null,
        failedSafetyChecks: failedSafety,
        acceptance: err?.acceptance?.acceptance ?? err?.quality?.acceptance ?? null,
      })
      setHasDiagnostics(Boolean(failureDiagnostics || lastRunMetaRef.current.stage))
      setReportDiagnostics(lastDiagnosticsRef.current)
      setReportRunMeta(lastRunMetaRef.current)
      setError(message)
      setSummary(null)
      setIsGenerating(false)
      setProgressLabel('')
      setStatus(OMR_STATUS.FAILED)
      omrTrace('ui:onFeedback:error', { message }, runId)
      onFeedbackRef.current?.({ type: 'error', message, source: 'preparation' })
    } finally {
      // An aborted PDF may settle after its replacement has started. Cleanup
      // must never terminate the newer score's worker or release its UI state.
      if (getActiveScoreSourceGeneration().activeOmrRunId === runId) {
        cancelActiveOmrWorker()
        endOmrUiBlock()
        releaseOmrUiLocks()
      }
      if (resetInFinally && activeRunRef.current === runId && !completedRunRef.current) {
        resetOmrPanelState({ setIsGenerating, setStatus, setProgressLabel })
      }
      omrTrace('ui:handleGenerate:finally', {
        runId,
        completed: completedRunRef.current,
      }, runId)
    }
  }, [pdfSource, pdfFileUrl, pdfFileName, pdfIdentity, practiceSessionEpoch, instrumentId, isGenerating, disabled])

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

  const handleDownloadProvenance = useCallback(() => {
    const activeScore =
      typeof window !== 'undefined' ? window.__SCOREFLOW_ACTIVE_SCORE__ : null
    const bundle = buildOmrProvenancePackage({
      diagnostics: lastDiagnosticsRef.current,
      runMeta: lastRunMetaRef.current,
      activeScore,
    })
    const result = downloadOmrProvenancePackage(bundle)
    setDevCopyStatus(
      result.ok
        ? `Provenance downloaded (${result.fileName}).`
        : 'Provenance export failed — see console.',
    )
    if (!result.ok) {
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

  const handleToggleProvenance = useCallback(() => {
    const next = toggleOmrProvenance(!devFlags.provenance)
    setDevFlags(next)
  }, [devFlags.provenance])

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

  const presentation = describePreparation(status, progress)
  return (
    <section className="library-omr-panel score-import-processing" aria-label="Preparing score" data-busy={showPreparing} data-state={status}>
      <p className="cz-edition-label">{showRetry ? 'Let’s try a different approach' : 'From page to playback'}</p>
      <div role={showRetry ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">
        <h2>{showRetry ? failureCopy?.title ?? 'We couldn’t prepare playback' : showPreparing ? presentation.title : status === OMR_STATUS.READY ? 'Checking your score' : cancelled ? 'Preparation paused' : 'Ready to prepare'}</h2>
        <p>{showRetry ? failureCopy?.message ?? 'Try again, or choose another copy of the score.' : showPreparing ? presentation.detail : status === OMR_STATUS.READY ? 'Making sure the page and playback are available.' : cancelled ? 'Your PDF is still here. Continue whenever you’re ready.' : 'Corranzo will read your PDF and prepare it for playback.'}</p>
      </div>
      {showPreparing && <ol className="score-import-stages" aria-label="Preparation stages">
        {['Read the page', 'Understand the notes', 'Prepare playback'].map((label, index) => <li key={label} data-state={index < presentation.step ? 'done' : index === presentation.step ? 'current' : 'pending'} aria-current={index === presentation.step ? 'step' : undefined}>
          <span aria-hidden="true">{index < presentation.step ? '✓' : `0${index + 1}`}</span>{label}
        </li>)}
      </ol>}
      <div className="score-import-processing-actions">
        {(showRetry || (!showPreparing && status === OMR_STATUS.IDLE)) && <button type="button" className="cz-collection-button" disabled={disabled || !pdfBytesAvailable} onClick={handleGenerate}>{showRetry ? 'Try again' : 'Prepare score'}</button>}
        {isGenerating && <button type="button" className="cz-text-link" onClick={handleCancel}>Cancel preparation</button>}
        {showRetry && (hasDiagnostics || failureReport) && <button type="button" className="cz-text-link" onClick={() => setReportOpen(true)}>Report a score problem</button>}
      </div>
      {showRetry && <p className="score-import-caption">You can also choose another PDF, or add a matching notation file in Advanced.</p>}
      <RecognitionProblemReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        ownerScoreId={
          (typeof window !== 'undefined'
            ? window.__SCOREFLOW_ACTIVE_SCORE__?.scoreId
            : null) ??
          getActiveScoreSourceGeneration().activeScoreId ??
          reportRunMeta?.scoreId ??
          null
        }
        mode="omr-failure"
        activeScore={
          typeof window !== 'undefined' ? window.__SCOREFLOW_ACTIVE_SCORE__ ?? null : null
        }
        musicXmlSource={null}
        pdfMeta={pdfFileName ? { fileName: pdfFileName } : null}
        pdfBuffer={pdfBytesFromOmrSource(pdfSource)}
        instrumentId={instrumentId}
        generation={practiceSessionEpoch}
        diagnostics={reportDiagnostics}
        omrRunMeta={reportRunMeta}
        failure={failureReport}
        defaultCategory="failed-to-generate"
      />
      {showDevTools && (
        <details className="score-import-diagnostics">
          <summary>Advanced diagnostics</summary>
          {error && <p>{failureReport?.exceptionMessage ?? error}</p>}
          {progressLabel && <p>{progressLabel}</p>}
          {summary && <p>{summary}</p>}
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
            className="profile-dev-tools__btn"
            onClick={handleDownloadProvenance}
            disabled={!hasDiagnostics}
            title="Download duration/dot/beam provenance package for the last OMR run"
          >
            Export provenance JSON
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
            className={`profile-dev-tools__btn${devFlags.provenance ? '' : ' profile-dev-tools__btn--muted'}`}
            onClick={handleToggleProvenance}
            aria-pressed={Boolean(devFlags.provenance)}
            title="Collect duration/dot/beam decision chains on the next OMR run (default off)"
          >
            Provenance {devFlags.provenance ? 'on' : 'off'}
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
        </details>
      )}
    </section>
  )
}
