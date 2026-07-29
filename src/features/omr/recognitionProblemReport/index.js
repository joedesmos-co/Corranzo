/**
 * Public API for privacy-safe recognition problem reports.
 */

export {
  RECOGNITION_PROBLEM_CATEGORIES,
  RECOGNITION_PROBLEM_CATEGORY_IDS,
  isRecognitionProblemCategory,
  labelForRecognitionProblemCategory,
} from './categories.js'

export {
  sanitizeReportFilename,
  sanitizeUserReportText,
  parseOptionalPositiveInt,
  buildRecognitionReportZipFilename,
} from './sanitize.js'

export {
  assertRecognitionReportOwnership,
  logRecognitionReportOwnershipMismatch,
} from './ownership.js'

export {
  collectRecognitionReportEnvironment,
  getBuildCommitIdentifier,
  detectBrowserNameVersion,
  detectOsCategory,
} from './environment.js'

export {
  RECOGNITION_REPORT_SCHEMA_VERSION,
  buildRecognitionReportJson,
} from './buildReportJson.js'

export {
  RECOGNITION_PROVENANCE_SAMPLE_LIMIT,
  buildRecognitionProvenanceJson,
} from './buildProvenanceJson.js'

export {
  GENERATED_SUMMARY_NOTE_SAMPLE_LIMIT,
  buildGeneratedSummaryJson,
} from './buildGeneratedSummary.js'

export { buildRecognitionReportReadme } from './buildReadme.js'

export {
  RECOGNITION_REPORT_MAX_JSON_BYTES,
  buildRecognitionReportPackage,
  zipRecognitionReportPackage,
  downloadRecognitionReportPackage,
  successMessageForRecognitionExport,
} from './buildPackage.js'
