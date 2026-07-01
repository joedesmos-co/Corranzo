import {
  extractPdfPageText,
  getPdfPageCount,
  renderPdfPageImageData,
} from '../score-follow/pdfPageAnalysis.js'
import { buildOmrMusicXml } from './buildOmrMusicXml.js'
import { parseTempoFromTextItems } from './parseOmrTempoMarking.js'
import { buildOmrDiagnostics } from './buildOmrDiagnostics.js'
import { summarizeNoteMatchingReport } from './omrNoteMatchingDiagnostics.js'
import { summarizeOrphanDiagnostics } from './vectorOrphanNoteheads.js'
import { preprocessOmrPageImage } from './preprocessOmrPageImage.js'
import { processOmrPageAnalysis } from './processOmrPage.js'
import { assessOmrDifficulty, OMR_FAILURE_REASON } from './assessOmrDifficulty.js'
import { validateOmrMultiPageLayout } from './validateOmrMultiPage.js'
import { copyOmrPixels } from './omrPixelBuffer.js'
import { omrDebugStep } from './omrDebug.js'
import { omrTrace } from './omrTrace.js'
import { buildOmrMeasureGridMetadata } from './omrMeasureGridMeta.js'
import {
  formatOmrMeasureGridDiagnosticsReport,
  summarizeOmrMeasureGridDiagnostics,
} from './omrMeasureGridDiagnostics.js'
import {
  buildOmrMeasurePlaybackReport,
  formatOmrMeasurePlaybackReport,
} from './omrMeasurePlaybackReport.js'
import {
  applyInnerVoicePhaseCorrection,
  NARROW_MIN_STACK_NOTES,
} from './innerVoicePhaseCorrection.js'
import {
  applyPhantomColumnCorrection,
  DEFAULT_MIN_STACK_NOTES as PHANTOM_COLUMN_MIN_STACK_NOTES,
} from './phantomColumnSimulation.js'
import { applyTerminalSameClefChordQuarterDurations } from './processVectorOmrPage.js'
import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'
import {
  OMR_DEFAULT_TEMPO,
  OMR_PIANO_STAVES_PER_SYSTEM,
  OMR_STATUS,
  OMR_TOO_DIFFICULT_MESSAGE,
  omrPageProgressLabel,
  yieldToBrowser,
} from './omrConstants.js'
import {
  computeDocumentStaffGapReference,
  mergeStaffGapSamples,
} from './normalizeStaffLineGaps.js'

const DEFAULT_MAX_PAGES = 24

function throwIfCancelled(signal) {
  if (signal?.aborted) {
    throw new DOMException('OMR generation cancelled.', 'AbortError')
  }
}

/**
 * Local-only experimental OMR: PDF page images → musical events → MusicXML.
 */
export async function runPdfOmrPipeline(pdfSource, options = {}) {
  const {
    renderPage = renderPdfPageImageData,
    extractPageText = extractPdfPageText,
    analyzePage = null,
    onStatus = () => {},
    onProgress = null,
    signal = null,
    maxPages = DEFAULT_MAX_PAGES,
    numPages: numPagesOverride = null,
    stavesPerSystem = OMR_PIANO_STAVES_PER_SYSTEM,
    title = 'PDF OMR',
    preprocessPages = true,
    traceRunId = null,
  } = options

  omrTrace('pipeline:enter', { preprocessPages }, traceRunId)
  onStatus(OMR_STATUS.ANALYZING)

  omrTrace('pipeline:pdf-load-start', {
    sourceType: typeof pdfSource === 'string' ? 'url' : 'bytes',
  }, traceRunId)
  const totalPages =
    numPagesOverride ?? (await getPdfPageCount(pdfSource))
  omrTrace('pipeline:pdf-load-success', { totalPages }, traceRunId)
  throwIfCancelled(signal)

  const pageCount = Math.min(totalPages, maxPages)
  if (!pageCount) {
    const assessment = assessOmrDifficulty({ pageCount: 0 })
    throw new Error(assessment.message ?? 'Could not read any pages from the PDF.')
  }

  const measureRhythms = []
  const measureGridEntries = []
  const pageDiagnostics = []
  const preprocessLog = []
  let keySignature = { fifths: 0, mode: 'major', confidence: 0 }
  let timeSignature = { beats: 4, beatType: 4, confidence: 0 }
  let tempo = { bpm: OMR_DEFAULT_TEMPO, fromDefault: true, confidence: 0 }
  const diagnostics = {
    pages: pageCount,
    systems: 0,
    measures: 0,
    notes: 0,
    uncertainMeasures: 0,
    pagesWithSystems: 0,
    preprocessPages,
    ties: {
      detectedTieCount: 0,
      appliedTieCount: 0,
      appliedTiePairs: [],
      uncertainSlurCount: 0,
      tieControlGlyphCount: 0,
    },
    rests: {
      detectedRestGlyphCount: 0,
      appliedRestEventCount: 0,
      skippedMixedRestCount: 0,
      skippedReasons: {},
    },
    staccato: {
      detectedStaccatoCount: 0,
      appliedStaccatoCount: 0,
    },
    accent: {
      detectedAccentCount: 0,
      appliedAccentCount: 0,
    },
    orphans: {
      orphanNoteheadCount: 0,
      reassignedOrphanCount: 0,
      rejectedOrphanReasons: {},
    },
  }
  const orphanDiagnosticsPages = []
  const staffGapNormalizationPages = []
  let documentStaffGapSamples = { treble: [], bass: [] }

  let measureCounter = 1
  const measureGridDiagnosticsEntries = []

  for (let page = 1; page <= pageCount; page += 1) {
    omrTrace(`pipeline:page-${page}:loop-start`, null, traceRunId)
    throwIfCancelled(signal)
    onProgress?.({
      page,
      pageCount,
      phase: 'analyze',
      label: omrPageProgressLabel(page, pageCount, 'analyze'),
    })

    const rendered = await renderPage(pdfSource, page)
    throwIfCancelled(signal)
    await yieldToBrowser()

    const renderedImage = rendered?.imageData ?? rendered
    omrDebugStep(`pipeline:page-${page}:after-pdf-render`, renderedImage)

    let imageData = copyOmrPixels(renderedImage, `pipeline:page-${page}:after-render-copy`)
    omrDebugStep(`pipeline:page-${page}:owned-render-copy`, imageData)
    const shouldSkipDefaultTextExtraction =
      numPagesOverride != null && extractPageText === extractPdfPageText
    const pageText = shouldSkipDefaultTextExtraction
      ? []
      : await extractPageText(pdfSource, page).catch(() => [])

    const pageTempo = parseTempoFromTextItems(pageText, { pageNumber: page })
    const canReplaceTempo =
      (pageTempo.confidence ?? 0) > (tempo.confidence ?? 0) &&
      (page === 1 ||
        pageTempo.source === 'metronome-mark' ||
        pageTempo.source === 'bpm-text')
    if (canReplaceTempo) {
      tempo = pageTempo
    }

    if (preprocessPages) {
      onProgress?.({
        page,
        pageCount,
        phase: 'preprocess',
        label: omrPageProgressLabel(page, pageCount, 'preprocess'),
      })
      const preprocessed = preprocessOmrPageImage(imageData)
      imageData = preprocessed.imageData
      omrDebugStep(`pipeline:page-${page}:after-preprocess`, imageData, {
        applied: preprocessed.applied,
      })
      preprocessLog.push({ page, applied: preprocessed.applied, quality: preprocessed.quality })
    }

    onProgress?.({
      page,
      pageCount,
      phase: 'detect',
      label: omrPageProgressLabel(page, pageCount, 'detect'),
    })
    onStatus(OMR_STATUS.DETECTING_NOTES)

    omrDebugStep(`pipeline:page-${page}:before-analyze`, imageData)

    const documentStaffGapReference = computeDocumentStaffGapReference(documentStaffGapSamples)

    const pageResult = analyzePage
      ? await analyzePage(imageData, {
          page,
          measureNumberStart: measureCounter,
          pageText,
          stavesPerSystem,
          keySignature,
          timeSignature,
          documentStaffGapReference,
        })
      : processOmrPageAnalysis(imageData, {
          page,
          measureNumberStart: measureCounter,
          pageText,
          stavesPerSystem,
          keySignature,
          timeSignature,
          documentStaffGapReference,
        })

    omrDebugStep(`pipeline:page-${page}:after-analyze`, null, {
      notes: pageResult.stats?.notes ?? 0,
      systems: pageResult.stats?.systems ?? 0,
    })

    throwIfCancelled(signal)
    await yieldToBrowser()

    measureCounter = pageResult.nextMeasureNumber
    diagnostics.systems += pageResult.stats.systems
    diagnostics.measures += pageResult.stats.measures
    diagnostics.notes += pageResult.stats.notes
    diagnostics.uncertainMeasures += pageResult.stats.uncertainMeasures
    measureGridDiagnosticsEntries.push(...(pageResult.measureGridDiagnostics ?? []))
    if (pageResult.staffGapNormalization) {
      staffGapNormalizationPages.push(pageResult.staffGapNormalization)
      documentStaffGapSamples = mergeStaffGapSamples(
        documentStaffGapSamples,
        pageResult.staffGapNormalization.gapSamples,
      )
    }
    if (pageResult.stats.systems > 0) {
      diagnostics.pagesWithSystems += 1
    }

    const pageTies = pageResult.tieDiagnostics
    if (pageTies) {
      diagnostics.ties.detectedTieCount += pageTies.detectedTieCount ?? 0
      diagnostics.ties.appliedTieCount += pageTies.appliedTieCount ?? 0
      diagnostics.ties.uncertainSlurCount += pageTies.uncertainSlurCount ?? 0
      diagnostics.ties.tieControlGlyphCount += pageTies.tieControlGlyphCount ?? 0
      diagnostics.ties.appliedTiePairs.push(...(pageTies.appliedTiePairs ?? []))
    }

    const pageRests = pageResult.restDiagnostics
    if (pageRests) {
      diagnostics.rests.detectedRestGlyphCount += pageRests.detectedRestGlyphCount ?? 0
      diagnostics.rests.appliedRestEventCount += pageRests.appliedRestEventCount ?? 0
      diagnostics.rests.skippedMixedRestCount += pageRests.skippedMixedRestCount ?? 0
      for (const [reason, count] of Object.entries(pageRests.skippedReasons ?? {})) {
        diagnostics.rests.skippedReasons[reason] =
          (diagnostics.rests.skippedReasons[reason] ?? 0) + count
      }
    }

    const pageStaccato = pageResult.staccatoDiagnostics
    if (pageStaccato) {
      diagnostics.staccato.detectedStaccatoCount += pageStaccato.detectedStaccatoCount ?? 0
      diagnostics.staccato.appliedStaccatoCount += pageStaccato.appliedStaccatoCount ?? 0
    }

    const pageAccent = pageResult.accentDiagnostics
    if (pageAccent) {
      diagnostics.accent.detectedAccentCount += pageAccent.detectedAccentCount ?? 0
      diagnostics.accent.appliedAccentCount += pageAccent.appliedAccentCount ?? 0
    }

    const pageOrphans = pageResult.orphanDiagnostics
    if (pageOrphans) {
      orphanDiagnosticsPages.push(pageOrphans)
      const merged = summarizeOrphanDiagnostics([pageOrphans])
      diagnostics.orphans.orphanNoteheadCount += merged.orphanNoteheadCount
      diagnostics.orphans.reassignedOrphanCount += merged.reassignedOrphanCount
      for (const [reason, count] of Object.entries(merged.rejectedOrphanReasons)) {
        diagnostics.orphans.rejectedOrphanReasons[reason] =
          (diagnostics.orphans.rejectedOrphanReasons[reason] ?? 0) + count
      }
    }

    if ((pageResult.keySignature?.confidence ?? 0) > (keySignature.confidence ?? 0)) {
      keySignature = pageResult.keySignature
    }
    if ((pageResult.timeSignature?.confidence ?? 0) > (timeSignature.confidence ?? 0)) {
      timeSignature = pageResult.timeSignature
    }

    pageDiagnostics.push(pageResult.pageEntry)
    measureRhythms.push(...pageResult.measureRhythms)
    measureGridEntries.push(...(pageResult.measureGrid ?? []))
  }

  if (diagnostics.systems === 0) {
    const assessment = assessOmrDifficulty({
      overallConfidence: 0,
      pagesWithSystems: 0,
      pageCount,
      noteCount: 0,
      measureCount: 0,
    })
    throw new Error(
      assessment.message ??
        'No staff systems detected. Try a cleaner digital piano PDF.',
    )
  }

  if (!measureRhythms.length) {
    throw new Error(
      'No noteheads detected. Experimental OMR works best on clean engraved scores.',
    )
  }

  onStatus(OMR_STATUS.BUILDING_PLAYBACK)

  const musical = { keySignature, timeSignature, tempo }
  const layoutConsistency = validateOmrMultiPageLayout(pageDiagnostics)
  const richDiagnostics = buildOmrDiagnostics({
    pages: pageDiagnostics,
    musical,
    uncertainMeasures: diagnostics.uncertainMeasures,
    totalMeasures: diagnostics.measures,
  })

  const difficulty = assessOmrDifficulty({
    overallConfidence: richDiagnostics.overallConfidence,
    pagesWithSystems: diagnostics.pagesWithSystems,
    pageCount,
    noteCount: diagnostics.notes,
    measureCount: diagnostics.measures,
    uncertainMeasures: diagnostics.uncertainMeasures,
    layoutConsistency,
  })

  if (difficulty.tooDifficult) {
    const error = new Error(difficulty.message ?? OMR_TOO_DIFFICULT_MESSAGE)
    error.code = OMR_FAILURE_REASON.LOW_CONFIDENCE
    error.difficulty = difficulty
    error.diagnostics = {
      ...diagnostics,
      ...richDiagnostics,
      layoutConsistency,
      preprocessLog,
      difficulty,
    }
    throw error
  }

  const beats = timeSignature?.beats ?? 4
  const beatType = timeSignature?.beatType ?? 4
  const measureDivisions = Math.round(beats * OMR_DIVISIONS_PER_QUARTER * (4 / beatType))
  const innerVoicePhaseCorrection = applyInnerVoicePhaseCorrection(measureRhythms, {
    totalDivisions: measureDivisions,
    minStackNotes: NARROW_MIN_STACK_NOTES,
  })
  if (innerVoicePhaseCorrection.summary.appliedMeasures > 0) {
    for (let index = 0; index < measureRhythms.length; index += 1) {
      measureRhythms[index] = innerVoicePhaseCorrection.measures[index]
    }
    omrTrace('pipeline:inner-voice-phase-correction', {
      appliedMeasures: innerVoicePhaseCorrection.summary.appliedMeasures,
      minStackNotes: NARROW_MIN_STACK_NOTES,
      samples: innerVoicePhaseCorrection.summary.samples?.slice(0, 4) ?? [],
    }, traceRunId)
  }

  const phantomColumnCorrection = applyPhantomColumnCorrection(measureRhythms, {
    totalDivisions: measureDivisions,
    minStackNotes: PHANTOM_COLUMN_MIN_STACK_NOTES,
  })
  const phantomColumnCorrectionSummary = {
    ...phantomColumnCorrection.summary,
    promotedToRuntime: false,
  }
  if (
    phantomColumnCorrection.summary.appliedMeasures > 0 &&
    !phantomColumnCorrection.summary.noteCountChanged &&
    !phantomColumnCorrection.summary.measureCountChanged
  ) {
    for (let index = 0; index < measureRhythms.length; index += 1) {
      measureRhythms[index] = phantomColumnCorrection.measures[index]
    }
    phantomColumnCorrectionSummary.promotedToRuntime = true
    omrTrace('pipeline:phantom-column-correction', {
      appliedMeasures: phantomColumnCorrection.summary.appliedMeasures,
      minStackNotes: PHANTOM_COLUMN_MIN_STACK_NOTES,
      samples: phantomColumnCorrection.summary.samples?.slice(0, 4) ?? [],
    }, traceRunId)
  } else if (phantomColumnCorrection.summary.appliedMeasures > 0) {
    omrTrace('pipeline:phantom-column-correction-skipped', {
      noteCountChanged: phantomColumnCorrection.summary.noteCountChanged,
      measureCountChanged: phantomColumnCorrection.summary.measureCountChanged,
      appliedMeasures: phantomColumnCorrection.summary.appliedMeasures,
    }, traceRunId)
  }

  const terminalSameClefChordQuarterCorrection = {
    appliedMeasures: 0,
    appliedEvents: 0,
    samples: [],
  }
  for (let index = 0; index < measureRhythms.length; index += 1) {
    const measure = measureRhythms[index]
    const beforeEvents = measure.events ?? []
    const adjustedEvents = applyTerminalSameClefChordQuarterDurations(
      beforeEvents,
      measureDivisions,
    )
    if (adjustedEvents === beforeEvents) {
      continue
    }

    const newSamples = []
    for (let eventIndex = 0; eventIndex < adjustedEvents.length; eventIndex += 1) {
      const before = beforeEvents[eventIndex]
      const after = adjustedEvents[eventIndex]
      if (
        before?.terminalSameClefChordQuarterAdjusted ||
        !after?.terminalSameClefChordQuarterAdjusted
      ) {
        continue
      }
      newSamples.push({
        measureNumber: measure.measureNumber ?? null,
        startDivision: after.startDivision ?? null,
        clef: after.notes?.[0]?.clef ?? null,
        noteCount: after.notes?.length ?? 0,
        durationDivisions: after.durationDivisions ?? null,
      })
    }
    if (!newSamples.length) {
      continue
    }

    measureRhythms[index] = {
      ...measure,
      events: adjustedEvents,
    }
    terminalSameClefChordQuarterCorrection.appliedMeasures += 1
    terminalSameClefChordQuarterCorrection.appliedEvents += newSamples.length
    terminalSameClefChordQuarterCorrection.samples.push(
      ...newSamples.slice(
        0,
        Math.max(0, 12 - terminalSameClefChordQuarterCorrection.samples.length),
      ),
    )
  }
  if (terminalSameClefChordQuarterCorrection.appliedEvents > 0) {
    omrTrace('pipeline:terminal-same-clef-chord-quarter-correction', {
      appliedMeasures: terminalSameClefChordQuarterCorrection.appliedMeasures,
      appliedEvents: terminalSameClefChordQuarterCorrection.appliedEvents,
      samples: terminalSameClefChordQuarterCorrection.samples.slice(0, 4),
    }, traceRunId)
  }

  const musicXml = buildOmrMusicXml({
    title,
    measures: measureRhythms,
    musical,
    includeDisclaimer: true,
  })
  const measurePlaybackReport = buildOmrMeasurePlaybackReport({
    measures: measureRhythms,
    musical,
    musicXml,
  })
  if (measurePlaybackReport.firstBadMeasure != null) {
    omrTrace('pipeline:measure-playback-report', {
      firstBadMeasure: measurePlaybackReport.firstBadMeasure,
      flagged: measurePlaybackReport.flaggedMeasures.slice(0, 8),
    }, traceRunId)
  }
  const measureGrid = buildOmrMeasureGridMetadata(measureGridEntries, { source: 'omr' })
  const measureGridDiagnostics = summarizeOmrMeasureGridDiagnostics(measureGridDiagnosticsEntries)
  const measureGridDiagnosticsReport = formatOmrMeasureGridDiagnosticsReport(
    measureGridDiagnosticsEntries,
  )

  onStatus(OMR_STATUS.READY)

  const noteCount = measureRhythms.reduce(
    (sum, measure) =>
      sum +
      measure.events
        .filter((event) => event.type === 'note')
        .reduce((inner, event) => inner + (event.notes?.length ?? 0), 0),
    0,
  )

  const warnings = [...(richDiagnostics.warnings ?? [])]
  if (layoutConsistency.warning) {
    warnings.push(layoutConsistency.warning)
  }
  if (difficulty.reasons.length) {
    warnings.push(`Quality notes: ${difficulty.reasons.join(', ')}`)
  }

  omrTrace('pipeline:success', {
    noteCount,
    measureCount: diagnostics.measures,
  }, traceRunId)

  const noteMatching = summarizeNoteMatchingReport(measureRhythms)
  const orphanNoteheads = summarizeOrphanDiagnostics(orphanDiagnosticsPages)
  const staffGapNormalization = {
    documentReference: computeDocumentStaffGapReference(documentStaffGapSamples),
    pages: staffGapNormalizationPages,
    systemsNormalized: staffGapNormalizationPages.reduce(
      (sum, pageEntry) => sum + (pageEntry.systemsAffected?.length ?? 0),
      0,
    ),
  }

  return {
    musicXml,
    diagnostics: {
      ...diagnostics,
      ...richDiagnostics,
      noteMatching,
      orphanNoteheads,
      staffGapNormalization,
      layoutConsistency,
      preprocessLog,
      difficulty,
      failureReasons: difficulty.reasons,
      measureGrid,
      measureGridDiagnostics,
      measureGridDiagnosticsEntries,
      innerVoicePhaseCorrection: innerVoicePhaseCorrection.summary,
      phantomColumnCorrection: phantomColumnCorrectionSummary,
      terminalSameClefChordQuarterCorrection,
    },
    measureGrid,
    measureGridDiagnostics,
    measureGridDiagnosticsReport,
    musical,
    noteCount,
    measureCount: diagnostics.measures,
    rhythmicMeasureCount: measureRhythms.length,
    uncertainMeasures: diagnostics.uncertainMeasures,
    overallConfidence: richDiagnostics.overallConfidence,
    disclaimer: richDiagnostics.disclaimer,
    warnings,
    measurePlaybackReport,
    measurePlaybackReportText: formatOmrMeasurePlaybackReport(measurePlaybackReport),
  }
}
