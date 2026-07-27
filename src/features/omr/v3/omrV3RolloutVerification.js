/**
 * Byte-identity verification for OMR V3 rollback / default-off paths.
 * Does not retain PDF bytes — only MusicXML string equality and status flags.
 */

import {
  assessOmrV3RuntimeCandidateReadiness,
  resolveOmrV3RolloutOptions,
} from './omrV3Rollout.js'

/**
 * @param {object} options
 * @param {Function} options.runPdfOmrPipeline
 * @param {Function} options.renderPage
 * @param {string} [options.title]
 */
export async function verifyOmrV3RollbackByteIdentity({
  runPdfOmrPipeline,
  renderPage,
  title = 'omr-v3-rollback-verify',
} = {}) {
  if (typeof runPdfOmrPipeline !== 'function') {
    throw new Error('verifyOmrV3RollbackByteIdentity requires runPdfOmrPipeline')
  }
  if (typeof renderPage !== 'function') {
    throw new Error('verifyOmrV3RollbackByteIdentity requires renderPage')
  }

  const base = {
    numPages: 1,
    preprocessPages: false,
    renderPage,
    title,
  }

  const production = await runPdfOmrPipeline('synthetic', base)
  const shadow = await runPdfOmrPipeline('synthetic', { ...base, omrV3Shadow: true })
  const rollback = await runPdfOmrPipeline('synthetic', {
    ...base,
    omrV3Shadow: true,
    omrV3RuntimeCandidate: true,
    omrV3Promotions: { fullV3: true },
    omrV3Rollback: true,
  })
  const candidateIdle = await runPdfOmrPipeline('synthetic', {
    ...base,
    omrV3RuntimeCandidate: true,
  })
  const promotionsWithoutCandidate = await runPdfOmrPipeline('synthetic', {
    ...base,
    omrV3Promotions: { fullV3: true },
  })

  const checks = {
    shadowPreservesProduction: shadow.musicXml === production.musicXml,
    rollbackPreservesProduction: rollback.musicXml === production.musicXml,
    runtimeCandidateIdlePreservesProduction: candidateIdle.musicXml === production.musicXml,
    promotionsWithoutCandidatePreserveProduction:
      promotionsWithoutCandidate.musicXml === production.musicXml,
    rollbackSuppressesShadow: rollback.omrV3Shadow?.status === 'disabled-by-rollback',
    rollbackSuppressesIndependent:
      rollback.omrV3IndependentShadow == null ||
      rollback.omrV3IndependentShadow?.status === 'disabled-by-rollback',
    candidateIdleDoesNotPromote:
      candidateIdle.omrV3RuntimePromotion?.promotedToRuntime !== true &&
      candidateIdle.omrV3IndependentShadow?.promotedToRuntime !== true,
  }

  const verified = Object.values(checks).every(Boolean)
  return {
    verified,
    checks,
    productionMusicXmlLength: production.musicXml?.length ?? 0,
  }
}

/**
 * Combine resolver readiness + live pipeline byte-identity into gate inputs.
 */
export async function assessOmrV3RolloutGateEvidence({
  runPdfOmrPipeline,
  renderPage,
} = {}) {
  const readiness = assessOmrV3RuntimeCandidateReadiness()
  const rollback = await verifyOmrV3RollbackByteIdentity({
    runPdfOmrPipeline,
    renderPage,
  })
  return {
    runtimeCandidateImplemented: readiness.implemented,
    rollbackVerified: rollback.verified,
    readiness,
    rollback,
    resolverProbe: resolveOmrV3RolloutOptions({
      runtimeCandidate: true,
      promotions: { fullV3: true },
    }),
  }
}
