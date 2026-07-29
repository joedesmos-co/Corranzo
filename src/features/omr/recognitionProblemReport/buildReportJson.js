/**
 * report.json builder for recognition problem exports.
 */

import { BETA_VERSION } from '../../beta/betaInfo.js'
import { isOmrProvenanceEnabled } from '../omrDiagnosticFlags.js'
import {
  isRecognitionProblemCategory,
  labelForRecognitionProblemCategory,
} from './categories.js'
import {
  collectRecognitionReportEnvironment,
  getBuildCommitIdentifier,
} from './environment.js'
import {
  parseOptionalPositiveInt,
  sanitizeReportFilename,
  sanitizeUserReportText,
} from './sanitize.js'

export const RECOGNITION_REPORT_SCHEMA_VERSION = 1

export function buildRecognitionReportJson({
  category = 'other',
  description = '',
  pageNumber = null,
  measureNumber = null,
  includeOriginalPdf = false,
  activeScore = null,
  musicXmlSource = null,
  pdfMeta = null,
  pdfBuffer = null,
  instrumentId = null,
  generation = null,
  omrRunMeta = null,
  failure = null,
  environment = null,
  appVersion = BETA_VERSION,
  exportedAt = null,
} = {}) {
  const resolvedCategory = isRecognitionProblemCategory(category) ? category : 'other'
  const quality = musicXmlSource?.omrMeta?.quality ?? null
  const omrMeta = musicXmlSource?.omrMeta ?? null
  const pdfByteLength =
    (pdfBuffer && Number.isFinite(pdfBuffer.byteLength) ? pdfBuffer.byteLength : null) ??
    (Number.isFinite(pdfMeta?.byteLength) ? pdfMeta.byteLength : null) ??
    (Number.isFinite(activeScore?.pdf?.meta?.byteLength)
      ? activeScore.pdf.meta.byteLength
      : null) ??
    null

  const env = environment ?? collectRecognitionReportEnvironment()
  const provenanceFlag = (() => {
    try {
      return isOmrProvenanceEnabled()
    } catch {
      return false
    }
  })()

  return {
    schema: 'corranzo-recognition-report',
    schemaVersion: RECOGNITION_REPORT_SCHEMA_VERSION,
    appVersion: appVersion ?? BETA_VERSION,
    buildCommit: getBuildCommitIdentifier(),
    exportedAt: exportedAt ?? new Date().toISOString(),
    problem: {
      category: resolvedCategory,
      categoryLabel: labelForRecognitionProblemCategory(resolvedCategory),
      description: sanitizeUserReportText(description),
      pageNumber: parseOptionalPositiveInt(pageNumber),
      measureNumber: parseOptionalPositiveInt(measureNumber),
    },
    score: {
      activeScoreId: activeScore?.scoreId ?? null,
      generation:
        generation ??
        activeScore?.generation ??
        null,
      sourceType: musicXmlSource?.source ?? activeScore?.musicXml?.sourceType ?? null,
      sanitizedSourceFilename: sanitizeReportFilename(
        pdfMeta?.fileName ??
          activeScore?.pdf?.fileName ??
          musicXmlSource?.omrMeta?.pdfFileName ??
          musicXmlSource?.fileName ??
          'score',
      ),
      instrumentMode: instrumentId ?? null,
      pdfPageCount: pdfMeta?.numPages ?? activeScore?.pdf?.meta?.numPages ?? null,
      pdfByteLength,
      pdfIdentity:
        activeScore?.pdf?.identity ??
        activeScore?.pdf?.metaIdentity ??
        quality?.sourceIdentity ??
        musicXmlSource?.ownerPdfIdentity ??
        null,
      pdfContentHash: activeScore?.pdf?.contentHash ?? null,
    },
    recognition: {
      acceptance: quality?.acceptance ?? failure?.acceptance ?? null,
      confidenceBand: quality?.confidenceBand ?? null,
      warningReasons: Array.isArray(quality?.warningReasons)
        ? quality.warningReasons.slice(0, 24)
        : [],
      rejectReasons: Array.isArray(quality?.rejectReasons)
        ? quality.rejectReasons.slice(0, 24)
        : [],
      overallConfidence:
        quality?.overallConfidence ??
        quality?.extractionSummary?.overallConfidence ??
        omrRunMeta?.overallConfidence ??
        null,
      omrRunId: omrRunMeta?.runId ?? activeScore?.activeOmrRunId ?? null,
      omrStage: failure?.stage ?? omrRunMeta?.stage ?? null,
      durationSeconds: omrMeta?.durationSeconds ?? null,
      measureCount:
        omrMeta?.measureCount ??
        quality?.extractionSummary?.measureCount ??
        omrRunMeta?.measureCount ??
        null,
      noteCount:
        omrMeta?.noteCount ??
        quality?.extractionSummary?.noteCount ??
        omrRunMeta?.noteCount ??
        null,
      playableEventCount:
        quality?.safetyChecks?.nonzeroPlayableEvents === true
          ? omrMeta?.noteCount ?? quality?.extractionSummary?.noteCount ?? null
          : quality?.extractionSummary?.noteCount ?? omrMeta?.noteCount ?? null,
      warnings: Array.isArray(omrMeta?.warnings) ? omrMeta.warnings.slice(0, 12) : [],
    },
    failure: failure
      ? {
          stage: failure.stage ?? null,
          exceptionName: failure.exceptionName ?? null,
          exceptionMessage: sanitizeUserReportText(failure.exceptionMessage ?? '', {
            maxLength: 800,
          }),
          exceptionStack: failure.exceptionStack ?? null,
          pageCount: failure.pageCount ?? null,
          perPageConfidence: Array.isArray(failure.perPageConfidence)
            ? failure.perPageConfidence.slice(0, 64)
            : [],
          acceptanceGate: failure.acceptanceGate ?? null,
          failedSafetyChecks: failure.failedSafetyChecks ?? null,
        }
      : null,
    runtime: {
      ...env,
      provenanceFlagEnabled: provenanceFlag,
      provenanceAvailable: null, // filled by package builder
    },
    privacy: {
      originalPdfIncluded: Boolean(includeOriginalPdf),
      fullMusicXmlIncluded: false,
      screenshotsIncluded: false,
      accountInfoIncluded: false,
      localStorageIncluded: false,
      indexedDbIncluded: false,
      absolutePathsIncluded: false,
    },
  }
}
