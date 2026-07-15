/**
 * Evidence-based OMR failure attribution for benchmark reports.
 *
 * This module is diagnostic only. It maps evaluator and runtime evidence to
 * pipeline stages without changing transcription output or benchmark floors.
 */

export const OMR_PIPELINE_STAGE = {
  RASTERIZATION: 'page-rasterization',
  STAFF_SYSTEM: 'staff-system-detection',
  STAFF_CLASSIFICATION: 'notation-vs-tab-classification',
  MEASURE_SEGMENTATION: 'measure-barline-segmentation',
  SYMBOL_DETECTION: 'symbol-detection',
  PITCH_INFERENCE: 'pitch-inference',
  RHYTHM_INFERENCE: 'onset-rhythm-inference',
  VOICE_SERIALIZATION: 'voice-serialization',
  NOTATION_TAB_PAIRING: 'notation-tab-pairing',
  TIE_REPEAT: 'tie-repeat-handling',
  MUSICXML_SERIALIZATION: 'musicxml-serialization',
}

const STAGE_ORDER = Object.values(OMR_PIPELINE_STAGE)

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function sum(values) {
  return values.reduce((total, value) => total + finite(value), 0)
}

function stage(stage, errorCount, evidence = []) {
  return {
    stage,
    status: errorCount > 0 ? 'issue' : 'ok',
    errorCount,
    evidence: evidence.filter(Boolean),
  }
}

function categoryMatches(categories, pattern) {
  return (categories ?? []).some((category) => pattern.test(category))
}

function expectedScanned(categories) {
  return categoryMatches(categories, /scan/i)
}

function expectedTab(categories) {
  return categoryMatches(categories, /tab|paired-notation/i)
}

function expectedPairedTab(categories) {
  return categoryMatches(categories, /paired/i)
}

function expectedTieOrRepeat(categories) {
  return categoryMatches(categories, /tie|slur|repeat|volta|coda/i)
}

function rejectedOrphanCount(diagnostics) {
  return Object.values(diagnostics?.orphans?.rejectedOrphanReasons ?? {}).reduce(
    (total, count) => total + finite(count),
    0,
  )
}

function countIrregularMeasureGrids(entries = []) {
  return entries.filter((entry) => {
    const widths = entry?.spanWidthPercents ?? []
    if (widths.length < 2) return false
    const mean = sum(widths) / widths.length
    return widths.some((width) => width < mean * 0.58 || width > mean * 1.65)
  }).length
}

function perMeasureDiagnostics(report = {}) {
  return (report.perMeasure ?? []).map((measure) => {
    const counts = {
      [OMR_PIPELINE_STAGE.MEASURE_SEGMENTATION]:
        measure.truthNoteCount === 0 || measure.generatedNoteCount === 0
          ? finite(measure.missingNoteCount) + finite(measure.extraNoteCount)
          : 0,
      [OMR_PIPELINE_STAGE.SYMBOL_DETECTION]:
        finite(measure.missingNoteCount) + finite(measure.extraNoteCount),
      [OMR_PIPELINE_STAGE.PITCH_INFERENCE]: finite(measure.wrongPitchCount),
      [OMR_PIPELINE_STAGE.RHYTHM_INFERENCE]:
        finite(measure.wrongDurationCount) + finite(measure.wrongOnsetCount),
      [OMR_PIPELINE_STAGE.VOICE_SERIALIZATION]: finite(measure.chordMismatchCount),
    }
    const ranked = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .sort(
        (left, right) =>
          right[1] - left[1] || STAGE_ORDER.indexOf(left[0]) - STAGE_ORDER.indexOf(right[0]),
      )
    return {
      measureNumber: measure.measureNumber,
      truthNoteCount: finite(measure.truthNoteCount),
      generatedNoteCount: finite(measure.generatedNoteCount),
      errorCount: finite(measure.errorCount),
      primaryStage: ranked[0]?.[0] ?? null,
      stageErrorCounts: counts,
    }
  })
}

/** Build fixture- and measure-level attribution across every OMR pipeline stage. */
export function buildOmrPipelineStageDiagnostics(report = {}, { fixture = {} } = {}) {
  const totals = report.totals ?? {}
  const diagnostics = report.generatedOmrDiagnostics ?? {}
  const categories = fixture.categories ?? []
  const tab = diagnostics.tablature ?? {}
  const ties = diagnostics.ties ?? {}
  const parity = diagnostics.runtimeVsScoreGraph?.parity ?? {}
  const preprocess = diagnostics.preprocessLog ?? []
  const pages = finite(diagnostics.pages)
  const pagesWithSystems = finite(diagnostics.pagesWithSystems)
  const missingPages = Math.max(0, pages - pagesWithSystems)
  const measureDiff = Math.abs(finite(totals.measureCountDifference))
  const irregularGrids = countIrregularMeasureGrids(
    diagnostics.measureGridDiagnosticsEntries ?? [],
  )
  const missing = finite(totals.missingNoteCount)
  const extra = finite(totals.extraNoteCount)
  const scanMisclassified =
    expectedScanned(categories) && preprocess.length > 0
      ? preprocess.filter((entry) => !entry?.quality?.isLikelyScanned).length
      : 0
  const wantsTab = expectedTab(categories)
  const wantsPairing = expectedPairedTab(categories)
  const tabClassificationMiss = wantsTab && finite(tab.tabStaves) === 0 ? 1 : 0
  const tabPairingErrors = wantsPairing
    ? finite(tab.unpairedNotationNotes) +
      finite(tab.unusedTabDigits) +
      finite(tab.lowConfidenceMeasures) +
      tabClassificationMiss
    : 0
  const tieExpectedButMissing =
    expectedTieOrRepeat(categories) &&
    finite(ties.detectedTieCount) === 0 &&
    finite(ties.appliedTieCount) === 0
      ? 1
      : 0
  const serializationErrors = Number(parity.noteheads === false) + Number(parity.rests === false)

  const stages = [
    stage(OMR_PIPELINE_STAGE.RASTERIZATION, scanMisclassified, [
      expectedScanned(categories)
        ? `scanned fixture; ${scanMisclassified}/${preprocess.length} page(s) not classified as scanned`
        : `${preprocess.length || pages} page(s) rasterized`,
    ]),
    stage(
      OMR_PIPELINE_STAGE.STAFF_SYSTEM,
      missingPages + Number(Boolean(diagnostics.layoutConsistency?.inconsistent)),
      [
        `${finite(diagnostics.systems)} system(s) on ${pagesWithSystems}/${pages} page(s)`,
        diagnostics.layoutConsistency?.inconsistent ? 'cross-page layout inconsistency' : null,
      ],
    ),
    stage(OMR_PIPELINE_STAGE.STAFF_CLASSIFICATION, tabClassificationMiss, [
      wantsTab
        ? `${finite(tab.tabStaves)} TAB staff/staves detected; ${tabClassificationMiss ? 'TAB expected' : 'classification evidence present'}`
        : 'notation-only fixture',
    ]),
    stage(OMR_PIPELINE_STAGE.MEASURE_SEGMENTATION, measureDiff + irregularGrids, [
      `measure count ${finite(totals.generatedMeasureCount)}/${finite(totals.truthMeasureCount)} (Δ${finite(totals.measureCountDifference)})`,
      irregularGrids ? `${irregularGrids} irregular system grid(s)` : null,
    ]),
    stage(OMR_PIPELINE_STAGE.SYMBOL_DETECTION, missing + extra + rejectedOrphanCount(diagnostics), [
      `${missing} missing; ${extra} extra note(s)`,
      rejectedOrphanCount(diagnostics)
        ? `${rejectedOrphanCount(diagnostics)} rejected orphan candidate(s)`
        : null,
    ]),
    stage(OMR_PIPELINE_STAGE.PITCH_INFERENCE, finite(totals.wrongPitchCount), [
      `${finite(totals.wrongPitchCount)} wrong pitch match(es)`,
    ]),
    stage(
      OMR_PIPELINE_STAGE.RHYTHM_INFERENCE,
      finite(totals.wrongDurationCount) + finite(totals.wrongOnsetCount),
      [
        `${finite(totals.wrongDurationCount)} duration; ${finite(totals.wrongOnsetCount)} onset error(s)`,
      ],
    ),
    stage(OMR_PIPELINE_STAGE.VOICE_SERIALIZATION, finite(totals.chordMismatchCount), [
      `${finite(totals.chordMismatchCount)} chord/voice grouping mismatch(es)`,
      diagnostics.scoreGraph?.voiceBudgetDiagnostics?.measuresWithOverflow
        ? `${diagnostics.scoreGraph.voiceBudgetDiagnostics.measuresWithOverflow} measure(s) exceed voice budget`
        : null,
    ]),
    stage(OMR_PIPELINE_STAGE.NOTATION_TAB_PAIRING, tabPairingErrors, [
      wantsPairing
        ? `${finite(tab.attachedPositions)} attached position(s); ${finite(tab.unpairedNotationNotes)} unpaired notation note(s); ${finite(tab.unusedTabDigits)} unused TAB digit(s)`
        : 'not a paired notation+TAB fixture',
    ]),
    stage(OMR_PIPELINE_STAGE.TIE_REPEAT, tieExpectedButMissing, [
      expectedTieOrRepeat(categories)
        ? `${finite(ties.detectedTieCount)} tie candidate(s); ${finite(ties.appliedTieCount)} applied`
        : 'no tie/repeat coverage declared',
    ]),
    stage(OMR_PIPELINE_STAGE.MUSICXML_SERIALIZATION, serializationErrors, [
      `runtime/ScoreGraph note parity ${parity.noteheads == null ? 'n/a' : parity.noteheads ? 'ok' : 'mismatch'}; rest parity ${parity.rests == null ? 'n/a' : parity.rests ? 'ok' : 'mismatch'}`,
    ]),
  ]
  const rankedStages = stages
    .filter((entry) => entry.errorCount > 0)
    .sort(
      (left, right) =>
        right.errorCount - left.errorCount ||
        STAGE_ORDER.indexOf(left.stage) - STAGE_ORDER.indexOf(right.stage),
    )

  return {
    dominantStage: rankedStages[0]?.stage ?? null,
    rankedStages,
    stages,
    perMeasure: perMeasureDiagnostics(report),
  }
}

export function formatOmrPipelineStageDiagnosticsMarkdown(diagnostics, { maxMeasures = 8 } = {}) {
  if (!diagnostics) return ''
  const lines = [
    `Pipeline attribution: ${diagnostics.dominantStage ?? 'no attributed failures'}`,
  ]
  for (const entry of diagnostics.rankedStages.slice(0, 5)) {
    lines.push(`- ${entry.stage}: ${entry.errorCount} (${entry.evidence.join('; ')})`)
  }
  const hotspots = [...(diagnostics.perMeasure ?? [])]
    .filter((entry) => entry.errorCount > 0)
    .sort((left, right) => right.errorCount - left.errorCount)
    .slice(0, maxMeasures)
  if (hotspots.length) {
    lines.push(
      `- measure hotspots: ${hotspots
        .map((entry) => `m${entry.measureNumber} ${entry.primaryStage} (${entry.errorCount})`)
        .join(', ')}`,
    )
  }
  return `${lines.join('\n')}\n`
}
