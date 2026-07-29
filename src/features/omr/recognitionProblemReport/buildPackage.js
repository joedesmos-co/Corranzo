/**
 * Assemble and download a privacy-safe recognition problem ZIP.
 */

import JSZip from 'jszip'
import { labelForRecognitionProblemCategory } from './categories.js'
import { buildGeneratedSummaryJson } from './buildGeneratedSummary.js'
import { buildRecognitionProvenanceJson } from './buildProvenanceJson.js'
import { buildRecognitionReportJson } from './buildReportJson.js'
import { buildRecognitionReportReadme } from './buildReadme.js'
import {
  assertRecognitionReportOwnership,
  logRecognitionReportOwnershipMismatch,
} from './ownership.js'
import {
  buildRecognitionReportZipFilename,
  sanitizeReportFilename,
} from './sanitize.js'

/** Soft bound for ZIP payload excluding optional PDF. */
export const RECOGNITION_REPORT_MAX_JSON_BYTES = 1_500_000

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(String(text)).byteLength
  }
  return String(text).length
}

function stringifyBounded(value) {
  return JSON.stringify(value, null, 2)
}

/**
 * Build in-memory package files. Does not download.
 */
export function buildRecognitionReportPackage({
  category = 'other',
  description = '',
  pageNumber = null,
  measureNumber = null,
  includeOriginalPdf = false,
  pdfConfirmed = false,
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
  mode = 'score',
  exportedAt = null,
} = {}) {
  const ownership = assertRecognitionReportOwnership({
    activeScoreId: activeScore?.scoreId ?? null,
    omrOwnerScoreId: musicXmlSource?.ownerScoreId ?? null,
    qualityOwnerScoreId: musicXmlSource?.omrMeta?.quality?.ownerScoreId ?? null,
    provenanceOwnerScoreId:
      diagnostics?.rhythmProvenance?.ownerScoreId ??
      musicXmlSource?.omrMeta?.quality?.ownerScoreId ??
      musicXmlSource?.ownerScoreId ??
      null,
    mode,
  })
  if (!ownership.ok) {
    logRecognitionReportOwnershipMismatch(ownership)
    return { ok: false, ownership, files: null, filename: null }
  }

  if (includeOriginalPdf && !pdfConfirmed) {
    return {
      ok: false,
      ownership,
      reason: 'pdf-confirmation-required',
      message: 'Including the original PDF requires an explicit confirmation.',
      files: null,
      filename: null,
    }
  }

  const stamp = exportedAt ?? new Date().toISOString()
  const report = buildRecognitionReportJson({
    category,
    description,
    pageNumber,
    measureNumber,
    includeOriginalPdf: Boolean(includeOriginalPdf && pdfConfirmed && pdfBuffer),
    activeScore,
    musicXmlSource,
    pdfMeta,
    pdfBuffer,
    instrumentId,
    generation,
    omrRunMeta,
    failure,
    exportedAt: stamp,
  })

  const provenance = buildRecognitionProvenanceJson({
    diagnostics,
    quality: musicXmlSource?.omrMeta?.quality ?? null,
    activeScoreId: activeScore?.scoreId ?? null,
    omrRunMeta,
    exportedAt: stamp,
  })
  report.runtime.provenanceAvailable = provenance.provenanceAvailable === true

  const generatedSummary = buildGeneratedSummaryJson({
    timingMap,
    omrMeta: musicXmlSource?.omrMeta ?? null,
    quality: musicXmlSource?.omrMeta?.quality ?? null,
    diagnostics,
    exportedAt: stamp,
  })

  const readme = buildRecognitionReportReadme({
    includeOriginalPdf: report.privacy.originalPdfIncluded,
    categoryLabel: labelForRecognitionProblemCategory(report.problem.category),
    exportedAt: stamp,
  })

  const files = {
    'report.json': stringifyBounded(report),
    'provenance.json': stringifyBounded(provenance),
    'generated-summary.json': stringifyBounded(generatedSummary),
    'README.txt': readme,
  }

  const jsonBytes =
    utf8Bytes(files['report.json']) +
    utf8Bytes(files['provenance.json']) +
    utf8Bytes(files['generated-summary.json']) +
    utf8Bytes(files['README.txt'])

  if (jsonBytes > RECOGNITION_REPORT_MAX_JSON_BYTES) {
    // Drop large provenance sample arrays and retry once.
    if (provenance.rhythmProvenance) {
      provenance.rhythmProvenance.noteDurations = []
      provenance.rhythmProvenance.dotCandidates = []
      provenance.rhythmProvenance.beamCandidates = []
      provenance.trimmedForSize = true
      files['provenance.json'] = stringifyBounded(provenance)
    }
  }

  if (includeOriginalPdf && pdfConfirmed && pdfBuffer) {
    const includedPdfBytes =
      pdfBuffer instanceof ArrayBuffer
        ? new Uint8Array(pdfBuffer.slice(0))
        : pdfBuffer instanceof Uint8Array
          ? new Uint8Array(pdfBuffer)
          : null
    if (includedPdfBytes) {
      files['original-score.pdf'] = includedPdfBytes
      report.privacy.originalPdfIncluded = true
      files['report.json'] = stringifyBounded(report)
      files['README.txt'] = buildRecognitionReportReadme({
        includeOriginalPdf: true,
        categoryLabel: labelForRecognitionProblemCategory(report.problem.category),
        exportedAt: stamp,
      })
    }
  }

  const filename = buildRecognitionReportZipFilename(new Date(stamp))

  return {
    ok: true,
    ownership,
    files,
    filename,
    report,
    provenance,
    generatedSummary,
    jsonBytes,
    pdfIncluded: Boolean(files['original-score.pdf']),
    sanitizedSourceFilename: sanitizeReportFilename(
      report.score.sanitizedSourceFilename,
    ),
  }
}

export async function zipRecognitionReportPackage(pkg) {
  if (!pkg?.ok || !pkg.files) {
    throw new Error(pkg?.message ?? 'Recognition report package is not ready.')
  }
  const zip = new JSZip()
  for (const [name, content] of Object.entries(pkg.files)) {
    zip.file(name, content)
  }
  const blob = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return blob
}

export async function downloadRecognitionReportPackage(pkg) {
  const bytes = await zipRecognitionReportPackage(pkg)
  const filename = pkg.filename || buildRecognitionReportZipFilename()
  if (typeof document === 'undefined') {
    return { ok: false, filename, blob: bytes, bytes: bytes?.byteLength ?? 0 }
  }
  const blob = new Blob([bytes], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  URL.revokeObjectURL(url)
  return {
    ok: true,
    filename,
    pdfIncluded: Boolean(pkg.pdfIncluded),
    bytes: bytes?.byteLength ?? blob.size ?? 0,
  }
}

export function successMessageForRecognitionExport({ pdfIncluded = false } = {}) {
  return pdfIncluded
    ? 'Diagnostic report exported with the original PDF.'
    : 'Diagnostic report exported. Your original PDF was not included.'
}
