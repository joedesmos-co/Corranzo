/**
 * DEV / E2E instrumentation for OMR job identity + page progress + failures.
 */

import { pushScoreSourceContentTrace } from '../library/scoreSourceContentIdentity.js'

export function logOmrJobStart({
  scoreId = null,
  generation = null,
  pdfHash = null,
  runId = null,
  pageCount = null,
  totalPages = null,
  cacheKey = null,
} = {}) {
  const payload = {
    scoreId,
    generation,
    pdfHash,
    runId,
    pageCount,
    totalPages,
    cacheKey,
    at: Date.now(),
  }
  pushScoreSourceContentTrace('omr-job-start', payload)
  if (typeof window !== 'undefined') {
    window.__SCOREFLOW_OMR_JOB__ = { ...payload, phase: 'start' }
    window.__SCOREFLOW_OMR_PROGRESS__ = []
  }
  const line = [
    'OMR JOB START:',
    `scoreId=${scoreId}`,
    `generation=${generation}`,
    `pdfHash=${pdfHash}`,
    `runId=${runId}`,
    `pageCount=${pageCount}`,
  ].join(' ')
  try {
    console.info(line, payload)
  } catch {
    // ignore
  }
  return payload
}

export function logOmrProgress({
  scoreId = null,
  runId = null,
  currentPage = null,
  totalPages = null,
  label = null,
} = {}) {
  const payload = {
    scoreId,
    runId,
    currentPage,
    totalPages,
    label,
    at: Date.now(),
  }
  pushScoreSourceContentTrace('omr-progress', payload)
  if (typeof window !== 'undefined') {
    const bag = window.__SCOREFLOW_OMR_PROGRESS__ ?? []
    bag.push(payload)
    window.__SCOREFLOW_OMR_PROGRESS__ = bag.slice(-40)
    window.__SCOREFLOW_OMR_JOB__ = {
      ...(window.__SCOREFLOW_OMR_JOB__ ?? {}),
      ...payload,
      phase: 'progress',
    }
  }
  const line = [
    'OMR PROGRESS:',
    `scoreId=${scoreId}`,
    `runId=${runId}`,
    `currentPage=${currentPage}`,
    `totalPages=${totalPages}`,
  ].join(' ')
  try {
    console.info(line)
  } catch {
    // ignore
  }
  return payload
}

export function logOmrFailure({
  scoreId = null,
  runId = null,
  pdfHash = null,
  pageCount = null,
  totalPages = null,
  stage = null,
  error = null,
  readablePages = null,
  analysisResultSummary = null,
} = {}) {
  const payload = {
    scoreId,
    runId,
    pdfHash,
    pageCount,
    totalPages,
    stage,
    errorName: error?.name ?? null,
    errorMessage: error?.message ?? (typeof error === 'string' ? error : null),
    errorCode: error?.code ?? null,
    stack: error?.stack ?? null,
    readablePages,
    analysisResultSummary,
    at: Date.now(),
  }
  pushScoreSourceContentTrace('omr-failure', payload)
  if (typeof window !== 'undefined') {
    window.__SCOREFLOW_OMR_FAILURE__ = payload
    window.__SCOREFLOW_OMR_JOB__ = {
      ...(window.__SCOREFLOW_OMR_JOB__ ?? {}),
      ...payload,
      phase: 'failure',
    }
  }
  const line = [
    'OMR FAILURE:',
    `scoreId=${payload.scoreId}`,
    `runId=${payload.runId}`,
    `pdfHash=${payload.pdfHash}`,
    `pageCount=${payload.pageCount}`,
    `stage=${payload.stage}`,
    `errorName=${payload.errorName}`,
    `errorMessage=${payload.errorMessage}`,
    `readablePages=${payload.readablePages}`,
    `totalPages=${payload.totalPages}`,
  ].join(' ')
  try {
    console.error(line, payload)
  } catch {
    // ignore
  }
  return payload
}
